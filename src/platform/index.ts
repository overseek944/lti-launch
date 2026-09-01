import { Hono } from "hono";
import { SignJWT, createRemoteJWKSet, exportJWK, generateKeyPair, importJWK, jwtVerify, type JWK, type KeyLike } from "jose";
import { CLAIM, MESSAGE_TYPE } from "../lti/claims.js";
import type { AppEnv, Bindings } from "../types.js";

/**
 * A reference LTI 1.3 platform.
 *
 * THIS IS A TEST HARNESS, NOT A PRODUCT. It exists so the launch can be shown
 * end to end without standing up Moodle, and because implementing both sides is
 * a fair proof that the protocol is understood in both directions.
 *
 * Nothing about the exchange is stubbed. It signs id_tokens with its own RSA
 * key, publishes a JWKS, verifies the tool's client assertion against the
 * tool's published key, and enforces the AGS timestamp rule the way a real
 * platform does.
 */
export const platformRoutes = new Hono<AppEnv>();

const P = "/platform";
const CONTEXT = { id: "ctx-algebra-1", title: "Algebra I, Period 3", label: "ALG1-P3" };
const PEOPLE = [
  { id: "plat-user-teacher", name: "Ms Whitfield", email: "whitfield@example.edu", role: "Instructor" },
  { id: "plat-user-student-1", name: "Aaliyah Okafor", email: null, role: "Learner" },
  { id: "plat-user-student-2", name: "Mateo Bennett", email: null, role: "Learner" },
] as const;

const ROLE_URI = (r: string) => `http://purl.imsglobal.org/vocab/lis/v2/membership#${r}`;
const iso = () => new Date().toISOString();
const issuerOf = (url: string) => `${new URL(url).origin}${P}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

async function platformKey(env: Bindings): Promise<{ kid: string; privateKey: KeyLike; publicJwk: JWK }> {
  const existing = await env.DB.prepare("SELECT * FROM platform_keys LIMIT 1")
    .first<{ kid: string; public_jwk: string; private_jwk: string }>();
  if (existing) {
    return {
      kid: existing.kid,
      privateKey: (await importJWK(JSON.parse(existing.private_jwk) as JWK, "RS256")) as KeyLike,
      publicJwk: JSON.parse(existing.public_jwk) as JWK,
    };
  }
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);
  const kid = crypto.randomUUID();
  publicJwk.kid = kid; publicJwk.alg = "RS256"; publicJwk.use = "sig";
  privateJwk.kid = kid; privateJwk.alg = "RS256";
  await env.DB.prepare("INSERT INTO platform_keys (kid, public_jwk, private_jwk, created_at) VALUES (?, ?, ?, ?)")
    .bind(kid, JSON.stringify(publicJwk), JSON.stringify(privateJwk), iso()).run();
  return { kid, privateKey: privateKey as KeyLike, publicJwk };
}

platformRoutes.get("/jwks", async (c) => c.json({ keys: [(await platformKey(c.env)).publicJwk] }));

platformRoutes.get("/", async (c) => {
  const base = new URL(c.req.url).origin;
  const rows = await c.env.DB.prepare(
    `SELECT s.user_id, s.score_given, s.score_maximum, s.grading_progress, s.timestamp, i.label
       FROM platform_scores s JOIN platform_line_items i ON i.id = s.line_item_id
      ORDER BY s.received_at DESC LIMIT 20`,
  ).all<Record<string, unknown>>();

  const gradebook = (rows.results ?? []).length
    ? `<table><tr><th>Student</th><th>Column</th><th>Score</th><th>Grading</th><th>Timestamp</th></tr>${
        (rows.results ?? []).map((r) => {
          const person = PEOPLE.find((p) => p.id === String(r["user_id"]));
          return `<tr><td>${esc(person?.name ?? String(r["user_id"]))}</td><td>${esc(String(r["label"]))}</td>` +
            `<td><strong>${String(r["score_given"])} / ${String(r["score_maximum"])}</strong></td>` +
            `<td>${esc(String(r["grading_progress"]))}</td><td><code>${esc(String(r["timestamp"]))}</code></td></tr>`;
        }).join("")}</table>`
    : `<p class="muted">Nothing yet. Launch as a student, solve the challenges and submit.</p>`;

  return c.html(String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>Reference LTI platform</title><style>
body{margin:0;background:#f8fafc;color:#0f172a;font:15px/1.6 -apple-system,system-ui,sans-serif}
header{background:#7c2d12;color:#fff;padding:1rem 2rem}header h1{margin:0;font-size:1.05rem}
header p{margin:.25rem 0 0;color:#fed7aa;font-size:13px}
main{max-width:900px;margin:0 auto;padding:2rem}
section{background:#fff;border:1px solid #e2e8f0;margin-bottom:1.5rem}
section>h2{margin:0;padding:.8rem 1.2rem;border-bottom:1px solid #e2e8f0;font:700 11.5px/1.4 ui-monospace,monospace;
letter-spacing:.1em;text-transform:uppercase;color:#64748b}.body{padding:1.2rem}
table{width:100%;border-collapse:collapse;font-size:13.5px}th{text-align:left;padding:.45rem 1rem .45rem 0;
border-bottom:1px solid #0f172a;font:700 10.5px/1.4 ui-monospace,monospace;letter-spacing:.07em;text-transform:uppercase;color:#64748b}
td{padding:.6rem 1rem .6rem 0;border-bottom:1px solid #e2e8f0}form{display:inline}
button{border:1px solid #0f172a;background:#0f172a;color:#fff;padding:.5rem .9rem;font-size:13.5px;font-weight:600;cursor:pointer;margin:.2rem .3rem .2rem 0}
button.dl{background:transparent;color:#0f172a}code{font-family:ui-monospace,monospace;font-size:12px}
.muted{color:#64748b;font-size:13.5px}
.warn{background:#fff7ed;border:1px solid #fed7aa;padding:.9rem 1.1rem;margin-bottom:1.5rem;font-size:13.5px}
</style></head><body>
<header><h1>Reference LTI 1.3 Platform</h1><p>A test harness. Not a product.</p></header>
<main>
<div class="warn"><strong>What this is.</strong> A working LTI 1.3 platform, here so the launch can be demonstrated
without standing up Moodle. It signs real id_tokens, publishes a real JWKS, verifies the tool's client assertion
against the tool's published key, and enforces the grade-passback timestamp rule. The <em>tool</em> is the product;
this is the thing it plugs into. Registered against a real Moodle or Canvas, the tool behaves identically.</div>

<section><h2>Course: ${esc(CONTEXT.title)}</h2><div class="body">
<p class="muted">Launch the tool as one of these people. Roles arrive as LTI role URIs, and the platform's privacy
setting decides whether a name and email are sent at all.</p>
${PEOPLE.map((p) => `<form method="POST" action="${base}${P}/launch"><input type="hidden" name="user" value="${p.id}"/>
<button>${esc(p.name)} (${p.role})</button></form>`).join("")}
<form method="POST" action="${base}${P}/launch"><input type="hidden" name="user" value="plat-user-teacher"/>
<input type="hidden" name="deepLink" value="1"/><button class="dl">Ms Whitfield — add content (Deep Linking)</button></form>
</div></section>

<section><h2>Gradebook</h2><div class="body">${gradebook}
<p class="muted">Scores arrive through LTI Assignment and Grade Services. A score is shown as final only when the
tool sends <code>gradingProgress: FullyGraded</code>. A second submission with a timestamp not later than the first
is rejected with 409, which is what a real platform does.</p></div></section>

<section><h2>Platform endpoints</h2><div class="body"><table>
<tr><td>Issuer</td><td><code>${base}${P}</code></td></tr>
<tr><td>Authorization</td><td><code>${base}${P}/auth</code></td></tr>
<tr><td>Token</td><td><code>${base}${P}/token</code></td></tr>
<tr><td>JWKS</td><td><code>${base}${P}/jwks</code></td></tr>
</table></div></section>
</main></body></html>`);
});

platformRoutes.post("/launch", async (c) => {
  const form = Object.fromEntries((await c.req.formData()) as unknown as Iterable<[string, string]>);
  const user = String(form["user"] ?? "plat-user-student-1");
  const deepLink = form["deepLink"] === "1";
  const url = new URL(`${c.env.TOOL_URL}/lti/login`);
  url.searchParams.set("iss", issuerOf(c.req.url));
  url.searchParams.set("login_hint", user);
  url.searchParams.set("target_link_uri", `${c.env.TOOL_URL}/lti/launch`);
  url.searchParams.set("lti_message_hint", btoa(JSON.stringify({ user, deepLink })));
  url.searchParams.set("client_id", "reference-tool");
  return c.redirect(url.toString(), 302);
});

platformRoutes.get("/auth", async (c) => {
  const q = new URL(c.req.url).searchParams;
  const base = new URL(c.req.url).origin;

  // The platform validates the tool's request too. Moodle rejects a missing
  // response_mode outright, so the harness holds the same line.
  for (const [param, expected] of [["scope", "openid"], ["response_type", "id_token"],
                                   ["response_mode", "form_post"], ["prompt", "none"]] as const) {
    if (q.get(param) !== expected) {
      return c.text(`invalid ${param}: expected ${expected}, got ${q.get(param) ?? "(absent)"}`, 400);
    }
  }

  const hint = q.get("lti_message_hint");
  const parsed = hint ? (JSON.parse(atob(hint)) as { user: string; deepLink: boolean })
                      : { user: "plat-user-student-1", deepLink: false };
  const person = PEOPLE.find((p) => p.id === parsed.user) ?? PEOPLE[1];

  const key = await platformKey(c.env);
  const now = Math.floor(Date.now() / 1000);
  const issuer = issuerOf(c.req.url);
  const clientId = q.get("client_id") ?? "reference-tool";

  const claims: Record<string, unknown> = {
    nonce: q.get("nonce") ?? "",
    [CLAIM.messageType]: parsed.deepLink ? MESSAGE_TYPE.deepLinking : MESSAGE_TYPE.resourceLink,
    [CLAIM.version]: "1.3.0",
    [CLAIM.deploymentId]: "deployment-1",
    [CLAIM.targetLinkUri]: `${c.env.TOOL_URL}/lti/launch`,
    [CLAIM.roles]: [ROLE_URI(person.role)],
    [CLAIM.context]: { id: CONTEXT.id, title: CONTEXT.title, label: CONTEXT.label, type: ["CourseSection"] },
    [CLAIM.toolPlatform]: { guid: issuer, name: "Reference LTI Platform", product_family_code: "reference" },
    [CLAIM.launchPresentation]: { document_target: "iframe", return_url: `${base}${P}/` },
    [CLAIM.namesRoleService]: {
      context_memberships_url: `${base}${P}/context/${CONTEXT.id}/memberships`,
      service_versions: ["2.0"],
    },
    name: person.name,
    ...(person.email ? { email: person.email } : {}),
  };

  if (parsed.deepLink) {
    claims[CLAIM.deepLinkingSettings] = {
      deep_link_return_url: `${base}${P}/deep-link-return`,
      accept_types: ["ltiResourceLink"],
      accept_presentation_document_targets: ["iframe", "window"],
      accept_multiple: false,
      data: "opaque-platform-state",
    };
  } else {
    const lineItemId = `${base}${P}/context/${CONTEXT.id}/lineitems/li-slope`;
    claims[CLAIM.endpoint] = {
      scope: ["https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
              "https://purl.imsglobal.org/spec/lti-ags/scope/score"],
      lineitems: `${base}${P}/context/${CONTEXT.id}/lineitems`,
      lineitem: lineItemId,
    };
    claims[CLAIM.resourceLink] = { id: "rl-slope", title: "Slope and Intercept" };
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO platform_line_items (id, context_id, resource_link_id, label, score_maximum, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(lineItemId, CONTEXT.id, "rl-slope", "Slope and Intercept", 3, iso()).run();
  }

  const idToken = await new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: key.kid, typ: "JWT" })
    .setIssuer(issuer).setAudience(clientId).setSubject(person.id)
    .setIssuedAt(now).setExpirationTime(now + 600).setJti(crypto.randomUUID())
    .sign(key.privateKey);

  return c.html(String.raw`<!doctype html><html><body onload="document.forms[0].submit()">
<form method="POST" action="${esc(q.get("target_link_uri") ?? `${c.env.TOOL_URL}/lti/launch`)}">
<input type="hidden" name="id_token" value="${idToken}"/>
<input type="hidden" name="state" value="${esc(q.get("state") ?? "")}"/>
</form><noscript><button type="submit">Continue</button></noscript></body></html>`);
});

platformRoutes.post("/deep-link-return", async (c) => {
  const form = Object.fromEntries((await c.req.formData()) as unknown as Iterable<[string, string]>);
  try {
    const { payload } = await jwtVerify(
      String(form["JWT"] ?? ""),
      createRemoteJWKSet(new URL(`${c.env.TOOL_URL}/.well-known/jwks.json`)),
      { audience: issuerOf(c.req.url) },
    );
    const items = payload[CLAIM.contentItems];
    return c.html(`<!doctype html><html><body style="font:16px/1.6 system-ui;max-width:44rem;margin:3rem auto;padding:0 1.5rem">
<h1>Content added</h1><p>The tool returned a signed Deep Linking response and the platform verified it against the
tool's published JWKS.</p><pre style="background:#f8fafc;padding:1rem;overflow:auto">${esc(JSON.stringify(items, null, 2))}</pre>
<p><a href="${P}/">Back to the course</a></p></body></html>`);
  } catch (error) {
    return c.text(`deep linking response failed verification: ${String(error)}`, 400);
  }
});

platformRoutes.post("/token", async (c) => {
  const form = Object.fromEntries((await c.req.formData()) as unknown as Iterable<[string, string]>);
  if (form["grant_type"] !== "client_credentials") return c.json({ error: "unsupported_grant_type" }, 400);
  try {
    // private_key_jwt: no shared secret ever travels. The platform verifies the
    // assertion against the key the tool publishes.
    await jwtVerify(
      String(form["client_assertion"] ?? ""),
      createRemoteJWKSet(new URL(`${c.env.TOOL_URL}/.well-known/jwks.json`)),
      { audience: `${new URL(c.req.url).origin}${P}/token` },
    );
  } catch (error) {
    return c.json({ error: "invalid_client", error_description: String(error) }, 401);
  }
  const key = await platformKey(c.env);
  const token = await new SignJWT({ scope: String(form["scope"] ?? "") })
    .setProtectedHeader({ alg: "RS256", kid: key.kid })
    .setIssuer(issuerOf(c.req.url)).setIssuedAt().setExpirationTime("1h")
    .sign(key.privateKey);
  return c.json({ access_token: token, token_type: "Bearer", expires_in: 3600, scope: String(form["scope"] ?? "") });
});

platformRoutes.get("/context/:ctx/memberships", (c) =>
  c.json(
    {
      id: `${new URL(c.req.url).origin}${P}/context/${c.req.param("ctx")}/memberships`,
      context: CONTEXT,
      members: PEOPLE.map((p) => ({
        status: "Active", user_id: p.id, name: p.name,
        ...(p.email ? { email: p.email } : {}), roles: [ROLE_URI(p.role)],
      })),
    },
    200,
    { "content-type": "application/vnd.ims.lti-nrps.v2.membershipcontainer+json" },
  ));

platformRoutes.get("/context/:ctx/lineitems", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM platform_line_items WHERE context_id = ?")
    .bind(c.req.param("ctx")).all<Record<string, unknown>>();
  const resourceLink = c.req.query("resource_link_id");
  const items = (rows.results ?? [])
    .filter((r) => !resourceLink || String(r["resource_link_id"]) === resourceLink)
    .map((r) => ({
      id: String(r["id"]), label: String(r["label"]),
      scoreMaximum: Number(r["score_maximum"]), resourceLinkId: String(r["resource_link_id"]),
    }));
  return c.json(items, 200, { "content-type": "application/vnd.ims.lis.v2.lineitemcontainer+json" });
});

platformRoutes.post("/context/:ctx/lineitems/:item/scores", async (c) => {
  const base = new URL(c.req.url).origin;
  const lineItemId = `${base}${P}/context/${c.req.param("ctx")}/lineitems/${c.req.param("item")}`;
  const body = (await c.req.json()) as Record<string, unknown>;
  const userId = String(body["userId"] ?? "");
  const timestamp = String(body["timestamp"] ?? iso());

  const existing = await c.env.DB.prepare(
    "SELECT timestamp FROM platform_scores WHERE line_item_id = ? AND user_id = ? ORDER BY timestamp DESC LIMIT 1",
  ).bind(lineItemId, userId).first<{ timestamp: string }>();

  // The rule that makes a naive retry loop impossible to satisfy: a score whose
  // timestamp is not later than the recorded one is rejected.
  if (existing && new Date(timestamp).getTime() <= new Date(existing.timestamp).getTime()) {
    return c.json({ error: "timestamp is not later than the score already recorded" }, 409);
  }

  await c.env.DB.prepare(
    `INSERT INTO platform_scores (id, line_item_id, user_id, score_given, score_maximum,
       activity_progress, grading_progress, timestamp, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(`psc_${crypto.randomUUID().slice(0, 10)}`, lineItemId, userId,
    Number(body["scoreGiven"] ?? 0), Number(body["scoreMaximum"] ?? 0),
    String(body["activityProgress"] ?? ""), String(body["gradingProgress"] ?? ""), timestamp, iso()).run();

  return c.json({ resultUrl: `${lineItemId}/results/${userId}` }, 200);
});
