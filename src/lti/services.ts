import { SignJWT } from "jose";
import { SCOPE, type ActivityProgress, type GradingProgress } from "./claims.js";
import { ensureKey } from "./keys.js";
import type { Registration } from "./launch.js";
import type { Bindings } from "../types.js";

/**
 * LTI Advantage services: Names and Role Provisioning, and Assignment and Grade
 * Services.
 *
 * Both authenticate the same way, and it is not a shared secret. The tool signs
 * a short-lived JWT with its own private key and presents it as a client
 * assertion; the platform verifies it against the JWKS the tool publishes.
 */

export class ServiceError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message);
    this.name = "ServiceError";
  }
}

/**
 * client_credentials with a private_key_jwt assertion.
 *
 * The audience of the assertion is the platform's token endpoint, not the tool
 * and not the issuer. Getting that wrong produces an invalid_client that is
 * hard to distinguish from a key problem.
 */
async function accessToken(
  env: Bindings,
  registration: Registration,
  scopes: string[],
): Promise<{ token: string; granted: string[] }> {
  const key = await ensureKey(env);
  const now = Math.floor(Date.now() / 1000);

  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: key.kid, typ: "JWT" })
    .setIssuer(registration.clientId)
    .setSubject(registration.clientId)
    .setAudience(registration.authTokenUrl)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .setJti(crypto.randomUUID())
    .sign(key.privateKey);

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
    scope: scopes.join(" "),
  });

  const response = await fetch(registration.authTokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new ServiceError(`token endpoint returned ${response.status}`, response.status, text);
  }
  const parsed = JSON.parse(text) as { access_token: string; scope?: string };
  return {
    token: parsed.access_token,
    // Read the granted scopes back rather than assuming the request was
    // honoured; the server is permitted to narrow the grant.
    granted: parsed.scope ? parsed.scope.split(" ").filter(Boolean) : scopes,
  };
}

// ---------------------------------------------------------------------------
// Names and Role Provisioning
// ---------------------------------------------------------------------------

export interface Member {
  userId: string;
  name: string | null;
  email: string | null;
  roles: string[];
  status: string;
}

/**
 * The freshest roster data available anywhere, because it is generated at the
 * moment of the request rather than at 02:00. It is also the narrowest: you
 * learn about a course when somebody from it launches, and never learn about a
 * course nobody opened.
 */
export async function fetchMembership(
  env: Bindings,
  registration: Registration,
  membershipsUrl: string,
): Promise<{ members: Member[]; contextTitle: string | null }> {
  const { token } = await accessToken(env, registration, [SCOPE.contextMembershipReadonly]);

  const members: Member[] = [];
  let url: string | null = membershipsUrl;
  let contextTitle: string | null = null;
  let pages = 0;

  while (url && pages++ < 20) {
    const response: Response = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.ims.lti-nrps.v2.membershipcontainer+json",
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new ServiceError(`membership returned ${response.status}`, response.status, text);
    }
    const body = JSON.parse(text) as {
      context?: { title?: string };
      members?: Record<string, unknown>[];
    };
    contextTitle = body.context?.title ?? contextTitle;

    for (const member of body.members ?? []) {
      members.push({
        userId: String(member["user_id"] ?? ""),
        name: member["name"] ? String(member["name"]) : null,
        email: member["email"] ? String(member["email"]) : null,
        roles: Array.isArray(member["roles"]) ? (member["roles"] as string[]) : [],
        status: String(member["status"] ?? "Active"),
      });
    }

    // Pagination is in a Link header, not the body.
    const link = response.headers.get("link");
    const next = link?.split(",").find((part) => part.includes('rel="next"'));
    url = next ? (next.match(/<([^>]+)>/)?.[1] ?? null) : null;
  }

  return { members, contextTitle };
}

// ---------------------------------------------------------------------------
// Assignment and Grade Services
// ---------------------------------------------------------------------------

export interface ScoreSubmission {
  lineItemUrl: string;
  userId: string;
  scoreGiven: number;
  scoreMaximum: number;
  activityProgress: ActivityProgress;
  gradingProgress: GradingProgress;
  comment?: string | undefined;
  /** Strictly monotonic per (user, line item). See below. */
  timestamp: string;
}

export interface ScoreResult {
  ok: boolean;
  status: number;
  body: string;
  /**
   * True when the platform reports it already holds this score or a newer one.
   * That is a success condition for our purposes, not an error to retry into.
   */
  supersededByNewer: boolean;
}

export async function submitScore(
  env: Bindings,
  registration: Registration,
  submission: ScoreSubmission,
): Promise<ScoreResult> {
  const { token } = await accessToken(env, registration, [SCOPE.score]);

  // The scores collection hangs off the line item URL, preserving any query
  // string the platform put there.
  const url = new URL(submission.lineItemUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/scores`;

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/vnd.ims.lis.v1.score+json",
    },
    body: JSON.stringify({
      userId: submission.userId,
      scoreGiven: submission.scoreGiven,
      scoreMaximum: submission.scoreMaximum,
      // A score is only displayed as final when this is FullyGraded. Sending
      // Pending, or omitting it, is the single most common cause of "the
      // request succeeded and the grade never appeared".
      activityProgress: submission.activityProgress,
      gradingProgress: submission.gradingProgress,
      timestamp: submission.timestamp,
      ...(submission.comment ? { comment: submission.comment } : {}),
    }),
  });

  const body = await response.text();

  // A 409 means the platform already holds a score with an equal or later
  // timestamp. Treating it as failure produces a retry loop that can never
  // succeed, because the timestamp will never get older.
  const superseded = response.status === 409;

  return {
    ok: response.ok || superseded,
    status: response.status,
    body: body.slice(0, 2000),
    supersededByNewer: superseded,
  };
}

/**
 * Finds or creates the line item for a resource link.
 *
 * Binding to the resource link is what puts the score in the column the teacher
 * created. A line item created independently lands in a new column next to the
 * one they are staring at, and creating one per launch fills the gradebook with
 * a column per session inside a week.
 */
export async function ensureLineItem(
  env: Bindings,
  registration: Registration,
  lineItemsUrl: string,
  resourceLinkId: string,
  label: string,
  scoreMaximum: number,
): Promise<string> {
  const { token } = await accessToken(env, registration, [SCOPE.lineItem]);

  const findUrl = new URL(lineItemsUrl);
  findUrl.searchParams.set("resource_link_id", resourceLinkId);
  const existing = await fetch(findUrl.toString(), {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.ims.lis.v2.lineitemcontainer+json",
    },
  });

  if (existing.ok) {
    const items = (await existing.json()) as { id?: string }[];
    const first = Array.isArray(items) ? items[0] : undefined;
    if (first?.id) return first.id;
  }

  const created = await fetch(lineItemsUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/vnd.ims.lis.v2.lineitem+json",
    },
    body: JSON.stringify({
      scoreMaximum,
      label,
      // Idempotency: a stable tag means a repeated create finds the same item
      // rather than adding another column.
      resourceId: `lti-launch:${resourceLinkId}`,
      resourceLinkId,
    }),
  });

  const text = await created.text();
  if (!created.ok) {
    throw new ServiceError(`line item creation returned ${created.status}`, created.status, text);
  }
  return String((JSON.parse(text) as { id: string }).id);
}

/**
 * Timestamps must be strictly increasing per (user, line item).
 *
 * The failure this prevents is subtle: a retry that reuses the original
 * timestamp is rejected as stale, so the retry can never succeed. Generating at
 * send time and nudging past the last one sent makes retries work.
 */
export function nextTimestamp(previous: string | null): string {
  const now = Date.now();
  const last = previous ? new Date(previous).getTime() : 0;
  return new Date(Math.max(now, last + 1000)).toISOString();
}
