import { Hono, type Context, type Next } from "hono";
import { CLAIM, MESSAGE_TYPE, canGrade } from "./lti/claims.js";
import { LaunchError, initiateLogin, validateLaunch } from "./lti/launch.js";
import { ensureKey, publicJwks } from "./lti/keys.js";
import { ServiceError, ensureLineItem, fetchMembership, nextTimestamp, submitScore } from "./lti/services.js";
import { CHALLENGES, MAX_SCORE, scoreSubmission } from "./activity/definition.js";
import { activityHtml } from "./ui/activity.js";
import { adminHtml } from "./ui/admin.js";
import { SignJWT } from "jose";
import type { AppEnv, Bindings } from "./types.js";

const app = new Hono<AppEnv>();
const iso = () => new Date().toISOString();

app.get("/health", (c) => c.json({ status: "ok", service: "lti-launch" }));

/**
 * Tool configuration, for an administrator registering this tool by hand.
 * Every platform asks for the same five things and phrases them differently.
 */
app.get("/.well-known/lti-configuration", (c) => {
  const base = new URL(c.req.url).origin;
  return c.json({
    title: "Slope and Intercept",
    description: "An accessible interactive activity with LTI Advantage grade passback.",
    oidc_initiation_url: `${base}/lti/login`,
    target_link_uri: `${base}/lti/launch`,
    public_jwk_url: `${base}/.well-known/jwks.json`,
    scopes: [
      "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
      "https://purl.imsglobal.org/spec/lti-ags/scope/score",
      "https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly",
    ],
    extensions: [
      {
        platform: "canvas.instructure.com",
        privacy_level: "public",
        settings: {
          placements: [
            { placement: "course_navigation", message_type: "LtiResourceLinkRequest" },
            { placement: "assignment_selection", message_type: "LtiDeepLinkingRequest" },
          ],
        },
      },
    ],
  });
});

app.get("/.well-known/jwks.json", async (c) => {
  await ensureKey(c.env);
  return c.json(await publicJwks(c.env));
});

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

/** Step 1. The platform sends the browser here. Accepts GET and POST; platforms differ. */
async function login(c: Context<AppEnv>) {
  const params =
    c.req.method === "POST"
      ? Object.fromEntries((await c.req.formData()) as unknown as Iterable<[string, string]>)
      : Object.fromEntries(new URL(c.req.url).searchParams);
  const base = new URL(c.req.url).origin;
  try {
    const redirect = await initiateLogin(
      c.env,
      {
        iss: String(params["iss"] ?? ""),
        login_hint: String(params["login_hint"] ?? ""),
        target_link_uri: String(params["target_link_uri"] ?? ""),
        lti_message_hint: params["lti_message_hint"] ? String(params["lti_message_hint"]) : undefined,
        client_id: params["client_id"] ? String(params["client_id"]) : undefined,
      },
      `${base}/lti/launch`,
    );
    return c.redirect(redirect, 302);
  } catch (error) {
    return renderError(c, error);
  }
}
app.get("/lti/login", login);
app.post("/lti/login", login);

/** Step 2. The platform POSTs the signed id_token here. */
app.post("/lti/launch", async (c) => {
  const form = Object.fromEntries((await c.req.formData()) as unknown as Iterable<[string, string]>);
  try {
    const launch = await validateLaunch(
      c.env,
      String(form["id_token"] ?? ""),
      form["state"] ? String(form["state"]) : null,
    );

    const userId = `usr_${launch.registration.id}_${await shortHash(launch.subject)}`;
    await c.env.DB.prepare(
      `INSERT INTO launch_users (id, registration_id, subject, name, email, role, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(registration_id, subject) DO UPDATE SET
         name = excluded.name, email = excluded.email, role = excluded.role, last_seen = excluded.last_seen`,
    )
      .bind(userId, launch.registration.id, launch.subject, launch.name, launch.email, launch.role, iso(), iso())
      .run();

    const launchId = `lch_${crypto.randomUUID().slice(0, 12)}`;
    await c.env.DB.prepare(
      `INSERT INTO launches (id, registration_id, user_id, message_type, context_id, context_title,
        resource_link_id, activity_id, roles_json, ags_json, nrps_url, deep_link_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        launchId, launch.registration.id, userId, launch.messageType,
        launch.contextId, launch.contextTitle, launch.resourceLinkId, "slope-intercept",
        JSON.stringify(launch.roles),
        launch.ags ? JSON.stringify(launch.ags) : null,
        launch.nrpsUrl,
        launch.deepLinkSettings ? JSON.stringify(launch.deepLinkSettings) : null,
        iso(),
      )
      .run();

    if (launch.messageType === MESSAGE_TYPE.deepLinking) {
      return c.html(deepLinkingPicker(launchId));
    }
    return c.html(activityHtml(launchId, canGrade(launch.role), launch.name));
  } catch (error) {
    return renderError(c, error);
  }
});

/**
 * Deep Linking response.
 *
 * The tool signs a JWT back to the platform describing the content the teacher
 * chose. It is auto-submitted because the specification requires a form POST
 * to the platform's return URL.
 */
app.post("/lti/deep-link", async (c) => {
  const body = (await c.req.json()) as { launchId: string; challengeId: string };
  const launch = await c.env.DB.prepare("SELECT * FROM launches WHERE id = ?")
    .bind(body.launchId).first<Record<string, unknown>>();
  if (!launch) return c.json({ error: "unknown launch" }, 404);

  const registration = await c.env.DB.prepare("SELECT * FROM registrations WHERE id = ?")
    .bind(String(launch["registration_id"])).first<Record<string, unknown>>();
  if (!registration) return c.json({ error: "unknown registration" }, 404);

  const settings = JSON.parse(String(launch["deep_link_json"] ?? "{}")) as Record<string, unknown>;
  const key = await ensureKey(c.env);
  const base = new URL(c.req.url).origin;
  const now = Math.floor(Date.now() / 1000);

  const jwt = await new SignJWT({
    [CLAIM.messageType]: MESSAGE_TYPE.deepLinkingResponse,
    [CLAIM.version]: "1.3.0",
    [CLAIM.deploymentId]: String(registration["deployment_id"]),
    [CLAIM.contentItems]: [
      {
        type: "ltiResourceLink",
        title: `Slope and Intercept — ${body.challengeId}`,
        url: `${base}/lti/launch`,
        custom: { challenge: body.challengeId },
        // Declaring the line item here means the platform creates the gradebook
        // column bound to this resource link, which is what puts our score in
        // the column the teacher is looking at.
        lineItem: { scoreMaximum: MAX_SCORE, label: "Slope and Intercept" },
      },
    ],
    ...(settings["data"] ? { [CLAIM.data]: settings["data"] } : {}),
  })
    .setProtectedHeader({ alg: "RS256", kid: key.kid, typ: "JWT" })
    .setIssuer(String(registration["client_id"]))
    .setAudience(String(registration["issuer"]))
    .setIssuedAt(now)
    .setExpirationTime(now + 600)
    .setSubject(String(registration["client_id"]))
    .setJti(crypto.randomUUID())
    .sign(key.privateKey);

  return c.json({ jwt, returnUrl: String(settings["deep_link_return_url"] ?? "") });
});

// ---------------------------------------------------------------------------
// Attempt and grade passback
// ---------------------------------------------------------------------------

app.post("/attempt", async (c) => {
  const body = (await c.req.json()) as {
    launchId: string;
    answers: { challengeId: string; m: number; b: number }[];
  };

  const launch = await c.env.DB.prepare("SELECT * FROM launches WHERE id = ?")
    .bind(body.launchId).first<Record<string, unknown>>();
  if (!launch) return c.json({ error: "unknown launch" }, 404);

  // Scored here, never from anything the client claims.
  const { score, detail } = scoreSubmission(body.answers ?? []);
  const attemptId = `att_${crypto.randomUUID().slice(0, 12)}`;

  // The evidence lives here. Passback is a copy for the teacher's convenience,
  // so a platform being unreachable must never lose a student's work.
  await c.env.DB.prepare(
    `INSERT INTO attempts (id, launch_id, user_id, registration_id, resource_link_id, activity_id,
       score, max_score, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(attemptId, body.launchId, String(launch["user_id"]), String(launch["registration_id"]),
      launch["resource_link_id"] ?? null, "slope-intercept", score, MAX_SCORE,
      JSON.stringify(detail), iso())
    .run();

  const ags = launch["ags_json"] ? (JSON.parse(String(launch["ags_json"])) as {
    lineItem: string | null; lineItems: string | null; scopes: string[];
  }) : null;

  if (!ags || (!ags.lineItem && !ags.lineItems)) {
    return c.json({
      score, maxScore: MAX_SCORE, detail,
      passback: { attempted: false, message: "The launch carried no gradebook endpoint, so nothing was sent." },
    });
  }

  const registrationRow = await c.env.DB.prepare("SELECT * FROM registrations WHERE id = ?")
    .bind(String(launch["registration_id"])).first<Record<string, unknown>>();
  const registration = {
    id: String(registrationRow?.["id"]), issuer: String(registrationRow?.["issuer"]),
    clientId: String(registrationRow?.["client_id"]), deploymentId: String(registrationRow?.["deployment_id"]),
    label: String(registrationRow?.["label"]), authLoginUrl: String(registrationRow?.["auth_login_url"]),
    authTokenUrl: String(registrationRow?.["auth_token_url"]), jwksUrl: String(registrationRow?.["jwks_url"]),
  };

  const userRow = await c.env.DB.prepare("SELECT subject FROM launch_users WHERE id = ?")
    .bind(String(launch["user_id"])).first<{ subject: string }>();

  try {
    // Prefer the line item the platform named. That is the platform telling us
    // exactly which column it wants; creating our own puts the score beside it.
    const lineItemUrl = ags.lineItem
      ?? (await ensureLineItem(c.env, registration, ags.lineItems as string,
            String(launch["resource_link_id"] ?? body.launchId), "Slope and Intercept", MAX_SCORE));

    const previous = await c.env.DB.prepare(
      `SELECT sent_timestamp FROM score_deliveries d
        JOIN attempts a ON a.id = d.attempt_id
       WHERE a.user_id = ? AND d.line_item_url = ?
       ORDER BY d.created_at DESC LIMIT 1`,
    ).bind(String(launch["user_id"]), lineItemUrl).first<{ sent_timestamp: string | null }>();

    const timestamp = nextTimestamp(previous?.sent_timestamp ?? null);
    const deliveryId = `dlv_${crypto.randomUUID().slice(0, 12)}`;

    const result = await submitScore(c.env, registration, {
      lineItemUrl,
      userId: String(userRow?.subject ?? ""),
      scoreGiven: score,
      scoreMaximum: MAX_SCORE,
      activityProgress: "Completed",
      // Final, deliberately. Anything else lets the platform hold the score and
      // produces the classic "it succeeded and nothing appeared".
      gradingProgress: "FullyGraded",
      timestamp,
    });

    await c.env.DB.prepare(
      `INSERT INTO score_deliveries (id, attempt_id, line_item_url, state, attempts_count,
         sent_timestamp, http_status, response_body, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    ).bind(deliveryId, attemptId, lineItemUrl,
      result.ok ? (result.supersededByNewer ? "superseded" : "accepted") : "rejected",
      timestamp, result.status, result.body, iso(), iso()).run();

    return c.json({
      score, maxScore: MAX_SCORE, detail,
      passback: {
        attempted: true, accepted: result.ok, status: result.status, lineItemUrl, timestamp,
        message: result.supersededByNewer
          ? "The gradebook already holds this score or a newer one."
          : result.ok
            ? `Sent to the gradebook and accepted (HTTP ${result.status}).`
            : `The gradebook rejected the score (HTTP ${result.status}). Your work is saved here and can be resent.`,
      },
    });
  } catch (error) {
    const message = error instanceof ServiceError ? `${error.message}: ${error.body.slice(0, 200)}` : String(error);
    return c.json({
      score, maxScore: MAX_SCORE, detail,
      passback: { attempted: true, accepted: false, message: `Passback failed: ${message}. Your work is saved here.` },
    });
  }
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

async function requireAdmin(c: Context<AppEnv>, next: Next) {
  if (c.req.header("x-admin-key") !== c.env.ADMIN_KEY) return c.json({ error: "unauthorised" }, 401);
  await next();
}

app.get("/admin", (c) => c.html(adminHtml()));
app.use("/api/*", requireAdmin);

app.get("/api/registrations", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM registrations ORDER BY created_at DESC").all<Record<string, unknown>>();
  return c.json({ registrations: rows.results ?? [] });
});

app.post("/api/registrations", async (c) => {
  const body = (await c.req.json()) as Record<string, string>;
  const id = `reg_${crypto.randomUUID().slice(0, 8)}`;
  await c.env.DB.prepare(
    `INSERT INTO registrations (id, issuer, client_id, deployment_id, label, auth_login_url, auth_token_url, jwks_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, body["issuer"], body["clientId"], body["deploymentId"], body["label"] ?? "platform",
    body["authLoginUrl"], body["authTokenUrl"], body["jwksUrl"], iso()).run();
  return c.json({ id }, 201);
});

app.get("/api/launches", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT l.id, l.message_type, l.context_title, l.resource_link_id, l.created_at,
            u.name, u.role, u.subject
       FROM launches l JOIN launch_users u ON u.id = l.user_id
      ORDER BY l.created_at DESC LIMIT 40`,
  ).all<Record<string, unknown>>();
  return c.json({ launches: rows.results ?? [] });
});

app.get("/api/deliveries", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT d.id, d.state, d.http_status, d.sent_timestamp, d.line_item_url, d.created_at,
            a.score, a.max_score, u.name, u.subject
       FROM score_deliveries d
       JOIN attempts a ON a.id = d.attempt_id
       JOIN launch_users u ON u.id = a.user_id
      ORDER BY d.created_at DESC LIMIT 40`,
  ).all<Record<string, unknown>>();
  return c.json({ deliveries: rows.results ?? [] });
});

/** Fetches the course roster from the platform, on demand. */
app.post("/api/launches/:id/roster", async (c) => {
  const launch = await c.env.DB.prepare("SELECT * FROM launches WHERE id = ?")
    .bind(c.req.param("id")).first<Record<string, unknown>>();
  if (!launch?.["nrps_url"]) return c.json({ error: "this launch carried no membership service" }, 400);
  const row = await c.env.DB.prepare("SELECT * FROM registrations WHERE id = ?")
    .bind(String(launch["registration_id"])).first<Record<string, unknown>>();
  if (!row) return c.json({ error: "unknown registration" }, 404);
  try {
    const result = await fetchMembership(c.env, {
      id: String(row["id"]), issuer: String(row["issuer"]), clientId: String(row["client_id"]),
      deploymentId: String(row["deployment_id"]), label: String(row["label"]),
      authLoginUrl: String(row["auth_login_url"]), authTokenUrl: String(row["auth_token_url"]),
      jwksUrl: String(row["jwks_url"]),
    }, String(launch["nrps_url"]));
    return c.json(result);
  } catch (error) {
    return c.json({ error: error instanceof ServiceError ? error.message : String(error) }, 502);
  }
});

app.get("/api/challenges", (c) => c.json({ challenges: CHALLENGES, maxScore: MAX_SCORE }));

// ---------------------------------------------------------------------------

function deepLinkingPicker(launchId: string): string {
  const options = CHALLENGES.map(
    (c, i) => `<li><button data-c="${c.id}">Challenge ${i + 1}: ${c.prompt}</button></li>`,
  ).join("");
  return String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<title>Choose an activity</title><style>
body{font:16px/1.6 -apple-system,system-ui,sans-serif;margin:0;background:#f8fafc;color:#0f172a}
.wrap{max-width:640px;margin:0 auto;padding:2rem}ul{list-style:none;padding:0}
button{width:100%;text-align:left;padding:.9rem 1.1rem;margin-bottom:.6rem;border:1px solid #e2e8f0;
background:#fff;font-size:15px;cursor:pointer}button:hover{border-color:#2563eb}
button:focus-visible{outline:3px solid #2563eb;outline-offset:2px}</style></head><body>
<div class="wrap"><h1>Choose an activity</h1>
<p>The activity you pick is added to your course and given a gradebook column.</p>
<ul>${options}</ul></div>
<script>
document.querySelectorAll("[data-c]").forEach(b=>b.addEventListener("click",async()=>{
  const r=await fetch("/lti/deep-link",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({launchId:${JSON.stringify(launchId)},challengeId:b.dataset.c})});
  const {jwt,returnUrl}=await r.json();
  const f=document.createElement("form");f.method="POST";f.action=returnUrl;
  const i=document.createElement("input");i.type="hidden";i.name="JWT";i.value=jwt;
  f.appendChild(i);document.body.appendChild(f);f.submit();
}));
</script></body></html>`;
}

async function shortHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

function renderError(c: Context<AppEnv>, error: unknown) {
  const reason = error instanceof LaunchError ? error.reason : "internal_error";
  const message = error instanceof Error ? error.message : String(error);
  console.error("launch failed", reason, message);
  // An explanation aimed at the administrator who has to fix it, not a stack
  // trace and not a blank page.
  return c.html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>Launch failed</title>
     <style>body{font:16px/1.6 system-ui,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1.5rem;color:#0f172a}
     code{background:#eff6ff;padding:.15em .4em;font-family:ui-monospace,monospace}</style></head><body>
     <h1>This launch could not be completed</h1>
     <p><strong>Reason:</strong> <code>${reason}</code></p>
     <p>${message.replace(/</g, "&lt;")}</p>
     <h2>For the administrator</h2>
     <p>Check that this tool is registered with the exact issuer, client ID and deployment ID
     the platform is sending, and that the redirect URI registered on the platform matches
     <code>${new URL(c.req.url).origin}/lti/launch</code> exactly. Redirect URIs are compared as
     literal strings: a trailing slash is a different URI.</p>
     </body></html>`,
    400,
  );
}

app.onError((error, c) => renderError(c, error));

export default { fetch: app.fetch } satisfies ExportedHandler<Bindings>;
