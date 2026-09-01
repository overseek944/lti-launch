import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { CLAIM, MESSAGE_TYPE, resolveRole, type Role } from "./claims.js";
import type { Bindings } from "../types.js";

/**
 * OIDC third-party initiated login, and launch validation.
 *
 * The flow, in the order it actually happens:
 *
 *   1. The platform sends the browser to our login endpoint with `iss`,
 *      `login_hint`, `target_link_uri` and usually `lti_message_hint`.
 *   2. We generate state and nonce, store them, and redirect back to the
 *      platform's authorisation endpoint.
 *   3. The platform POSTs an `id_token` (a JWT) to our launch endpoint.
 *   4. We verify it against the platform's published JWKS and check that this
 *      exact launch has not been seen before.
 *
 * Step 4 is where implementations get lazy. Verifying the signature proves the
 * platform issued the token; checking the nonce proves this launch is happening
 * now and once. Both are required.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

export class LaunchError extends Error {
  constructor(message: string, readonly reason: string) {
    super(message);
    this.name = "LaunchError";
  }
}

export interface Registration {
  id: string;
  issuer: string;
  clientId: string;
  deploymentId: string;
  label: string;
  authLoginUrl: string;
  authTokenUrl: string;
  jwksUrl: string;
}

function toRegistration(row: Record<string, unknown>): Registration {
  return {
    id: String(row["id"]),
    issuer: String(row["issuer"]),
    clientId: String(row["client_id"]),
    deploymentId: String(row["deployment_id"]),
    label: String(row["label"]),
    authLoginUrl: String(row["auth_login_url"]),
    authTokenUrl: String(row["auth_token_url"]),
    jwksUrl: String(row["jwks_url"]),
  };
}

/**
 * Finds the registration for a login request.
 *
 * At this point only the issuer (and possibly client_id) is known; the
 * deployment is not, because it arrives in the id_token. Where one issuer has
 * several registrations and the platform did not send client_id, this is
 * genuinely ambiguous and says so rather than picking one.
 */
export async function findRegistrationForLogin(
  env: Bindings,
  issuer: string,
  clientId: string | null,
): Promise<Registration> {
  const rows = clientId
    ? await env.DB.prepare("SELECT * FROM registrations WHERE issuer = ? AND client_id = ?")
        .bind(issuer, clientId).all<Record<string, unknown>>()
    : await env.DB.prepare("SELECT * FROM registrations WHERE issuer = ?")
        .bind(issuer).all<Record<string, unknown>>();

  const found = rows.results ?? [];
  if (found.length === 0) {
    throw new LaunchError(`no registration for issuer ${issuer}`, "unknown_issuer");
  }
  const distinctClients = new Set(found.map((row) => String(row["client_id"])));
  if (!clientId && distinctClients.size > 1) {
    throw new LaunchError(
      `issuer ${issuer} has several registrations and the login did not include client_id`,
      "ambiguous_registration",
    );
  }
  return toRegistration(found[0] as Record<string, unknown>);
}

export interface LoginRequest {
  iss: string;
  login_hint: string;
  target_link_uri: string;
  lti_message_hint?: string | undefined;
  client_id?: string | undefined;
  lti_deployment_id?: string | undefined;
}

export async function initiateLogin(
  env: Bindings,
  request: LoginRequest,
  redirectUri: string,
): Promise<string> {
  if (!request.iss) throw new LaunchError("iss is required", "missing_iss");
  if (!request.login_hint) throw new LaunchError("login_hint is required", "missing_login_hint");

  const registration = await findRegistrationForLogin(env, request.iss, request.client_id ?? null);

  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();

  await env.DB.prepare(
    "INSERT INTO login_states (state, nonce, issuer, client_id, target_link, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(state, nonce, request.iss, registration.clientId, request.target_link_uri ?? null, new Date().toISOString())
    .run();

  const url = new URL(registration.authLoginUrl);
  // Every one of these is required by the specification, and Moodle rejects the
  // request outright if response_mode is missing, with a generic error page
  // rather than an OIDC error redirect.
  url.searchParams.set("scope", "openid");
  url.searchParams.set("response_type", "id_token");
  url.searchParams.set("response_mode", "form_post");
  url.searchParams.set("prompt", "none");
  url.searchParams.set("client_id", registration.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("login_hint", request.login_hint);
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  if (request.lti_message_hint) url.searchParams.set("lti_message_hint", request.lti_message_hint);

  return url.toString();
}

export interface ValidatedLaunch {
  registration: Registration;
  claims: JWTPayload & Record<string, unknown>;
  subject: string;
  name: string | null;
  email: string | null;
  role: Role;
  roles: string[];
  messageType: string;
  contextId: string | null;
  contextTitle: string | null;
  resourceLinkId: string | null;
  custom: Record<string, unknown>;
  ags: {
    lineItem: string | null;
    lineItems: string | null;
    scopes: string[];
  } | null;
  nrpsUrl: string | null;
  deepLinkSettings: Record<string, unknown> | null;
  returnUrl: string | null;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwks(url: string) {
  let set = jwksCache.get(url);
  if (!set) {
    // Cached per isolate. The platform rotates keys and jose refetches on an
    // unknown kid, so a rotation costs one extra request rather than an outage.
    set = createRemoteJWKSet(new URL(url), { cacheMaxAge: 10 * 60 * 1000 });
    jwksCache.set(url, set);
  }
  return set;
}

export async function validateLaunch(
  env: Bindings,
  idToken: string,
  state: string | null,
): Promise<ValidatedLaunch> {
  if (!idToken) throw new LaunchError("id_token missing", "missing_id_token");
  if (!state) throw new LaunchError("state missing", "missing_state");

  const stored = await env.DB.prepare("SELECT * FROM login_states WHERE state = ?")
    .bind(state)
    .first<Record<string, unknown>>();
  if (!stored) throw new LaunchError("unknown state", "unknown_state");
  if (stored["consumed_at"]) throw new LaunchError("state already used", "state_replay");

  const age = Date.now() - new Date(String(stored["created_at"])).getTime();
  if (age > STATE_TTL_MS) throw new LaunchError("state expired", "state_expired");

  // Decode without trusting it, only to find which registration signed it. The
  // deployment_id is what completes the tenancy key and it lives in the body.
  const unverified = decodeSegment(idToken, 1);
  const issuer = String(unverified["iss"] ?? "");
  const deploymentId = String(unverified[CLAIM.deploymentId] ?? "");
  const audience = Array.isArray(unverified["aud"])
    ? String((unverified["aud"] as unknown[])[0])
    : String(unverified["aud"] ?? "");

  const row = await env.DB.prepare(
    "SELECT * FROM registrations WHERE issuer = ? AND client_id = ? AND deployment_id = ?",
  )
    .bind(issuer, audience, deploymentId)
    .first<Record<string, unknown>>();
  if (!row) {
    throw new LaunchError(
      `no registration for issuer=${issuer} client_id=${audience} deployment_id=${deploymentId}`,
      "unknown_deployment",
    );
  }
  const registration = toRegistration(row);

  const { payload } = await jwtVerify(idToken, jwks(registration.jwksUrl), {
    issuer: registration.issuer,
    audience: registration.clientId,
    clockTolerance: 60,
  });

  if (payload["nonce"] !== stored["nonce"]) {
    throw new LaunchError("nonce mismatch", "nonce_mismatch");
  }
  if (payload[CLAIM.version] !== "1.3.0") {
    throw new LaunchError(`unsupported LTI version ${String(payload[CLAIM.version])}`, "bad_version");
  }

  // Single use. Consuming the state here is what actually prevents replay; the
  // signature alone would happily verify the same token twice.
  await env.DB.prepare("UPDATE login_states SET consumed_at = ? WHERE state = ?")
    .bind(new Date().toISOString(), state)
    .run();

  const claims = payload as JWTPayload & Record<string, unknown>;
  const messageType = String(claims[CLAIM.messageType] ?? "");
  if (messageType !== MESSAGE_TYPE.resourceLink && messageType !== MESSAGE_TYPE.deepLinking) {
    throw new LaunchError(`unsupported message type ${messageType}`, "bad_message_type");
  }

  const context = (claims[CLAIM.context] as Record<string, unknown> | undefined) ?? null;
  const resourceLink = (claims[CLAIM.resourceLink] as Record<string, unknown> | undefined) ?? null;
  const endpoint = (claims[CLAIM.endpoint] as Record<string, unknown> | undefined) ?? null;
  const nrps = (claims[CLAIM.namesRoleService] as Record<string, unknown> | undefined) ?? null;
  const presentation = (claims[CLAIM.launchPresentation] as Record<string, unknown> | undefined) ?? null;
  const roles = Array.isArray(claims[CLAIM.roles]) ? (claims[CLAIM.roles] as string[]) : [];

  return {
    registration,
    claims,
    subject: String(claims["sub"] ?? ""),
    // Absent whenever the platform's privacy level says so, which is the
    // default in Moodle. The tool works without them.
    name: claims["name"] ? String(claims["name"]) : null,
    email: claims["email"] ? String(claims["email"]) : null,
    role: resolveRole(roles),
    roles,
    messageType,
    contextId: context?.["id"] ? String(context["id"]) : null,
    contextTitle: context?.["title"] ? String(context["title"]) : null,
    resourceLinkId: resourceLink?.["id"] ? String(resourceLink["id"]) : null,
    custom: (claims[CLAIM.custom] as Record<string, unknown> | undefined) ?? {},
    ags: endpoint
      ? {
          lineItem: endpoint["lineitem"] ? String(endpoint["lineitem"]) : null,
          lineItems: endpoint["lineitems"] ? String(endpoint["lineitems"]) : null,
          scopes: Array.isArray(endpoint["scope"]) ? (endpoint["scope"] as string[]) : [],
        }
      : null,
    nrpsUrl: nrps?.["context_memberships_url"] ? String(nrps["context_memberships_url"]) : null,
    deepLinkSettings: (claims[CLAIM.deepLinkingSettings] as Record<string, unknown> | undefined) ?? null,
    returnUrl: presentation?.["return_url"] ? String(presentation["return_url"]) : null,
  };
}

function decodeSegment(jwt: string, index: number): Record<string, unknown> {
  const parts = jwt.split(".");
  const segment = parts[index];
  if (!segment) throw new LaunchError("malformed id_token", "malformed_token");
  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    throw new LaunchError("malformed id_token", "malformed_token");
  }
}
