# lti-launch

A conformant **LTI 1.3 Advantage tool**: OIDC launch, Deep Linking, Names and
Role Provisioning, and grade passback that actually lands, with an accessible
interactive activity behind it.

- Tool: <https://lti-launch.pretoni.com>
- Admin: <https://lti-launch.pretoni.com/admin>
- Reference platform (a test harness): <https://lti-platform.pretoni.com/platform>

## Try it

Open the reference platform, click a student, solve the challenges, submit. The
score appears in the platform's gradebook, having travelled the whole LTI
Advantage path: OIDC login, a signed `id_token` verified against a published
JWKS, then a `client_credentials` token obtained with a `private_key_jwt`
assertion, then a score POST that the platform accepts.

Nothing in that exchange is stubbed. The two services sign with real RSA keys
and verify each other against real JWKS endpoints.

## The four things that go wrong

This tool exists to get them right.

### 1. Tenancy keyed on the issuer alone

The key is **`iss` + `client_id` + `deployment_id`**, together. One platform
issuer can host many deployments: several districts on one regional Canvas
instance, or several sub-accounts in one district. Keying on the issuer puts two
districts in one tenant, which is a data isolation failure rather than a bug,
and it is found either by a security review or by a district.

### 2. Assuming a name and an email

A launch can carry neither. District policy, expressed as a privacy level, can
strip both, and in Moodle that is the **default**. `name` and `email` are
nullable throughout; the `sub` claim scoped to the deployment is the identifier.
A tool whose user creation path requires a display name either fails on such a
launch or creates a thousand users called "Unknown User".

### 3. Verifying the signature but not the nonce

The signature proves the platform issued the token. The nonce proves this launch
is happening **now, once**. Both are checked, and the state is consumed on use,
so a replayed launch is refused with `state_replay`.

### 4. Grade passback that returns 200 and vanishes

Four causes, all of which return success:

| Cause | What this tool does |
|---|---|
| No line item bound to the resource link | Prefers the `lineitem` claim from the launch, which is the platform naming the column it wants. Creates one only when none was given, idempotently |
| Timestamp not later than the recorded one | Generates at send time and keeps it strictly increasing per user and line item. A retry reusing the original timestamp can never succeed |
| `gradingProgress` not `FullyGraded` | Sends `FullyGraded` deliberately. Anything else lets the platform legitimately hold the score |
| Wrong grading period | Declares `lineItem` in the Deep Linking response so the platform creates the column in the right place |

A **409** is treated as success, not as an error to retry into. It means the
platform already holds this score or a newer one, and the timestamp will never
get older.

## Accessibility

The activity is a slope-intercept matcher, chosen because it is the shape of
thing that is hard to make accessible. All four requirements are implemented:

- **Keyboard path** reaching every state the mouse can, with a documented large
  step (Page Up and Page Down move by 1; arrows by 0.1). Moving a range of -10
  to 10 in 0.1 increments one press at a time is not a usable interaction.
- **Announced state** through a throttled live region carrying meaning: *"slope
  2, y-intercept negative 1, passes through 2 of 3 points"*, not "value 42".
- **A real text alternative** to the graph: a data table with the same
  information, updating with the controls. Not `alt="chart"`.
- **A second channel for colour**: matched points are filled circles, unmatched
  are open squares. Shape as well as colour, plus the word in the table.

Equations are MathML, so a screen reader reads them instead of skipping them.

## Registering against a real platform

The tool is registerable against any conformant LTI 1.3 platform. Give the
administrator these:

| Field | Value |
|---|---|
| OIDC initiation URL | `https://lti-launch.pretoni.com/lti/login` |
| Redirect URI / target link URI | `https://lti-launch.pretoni.com/lti/launch` |
| Public JWKS URL | `https://lti-launch.pretoni.com/.well-known/jwks.json` |
| Deep linking URL | `https://lti-launch.pretoni.com/lti/launch` |
| Configuration JSON | `https://lti-launch.pretoni.com/.well-known/lti-configuration` |

Then register the platform with the tool at `/admin` using the issuer, client
ID, deployment ID and the platform's own auth, token and JWKS URLs.

**Moodle notes**, which cost people hours:

- The LTI version dropdown defaults to 1.0/1.1 and every 1.3 field stays hidden
  until it is switched.
- The client ID is not shown until after the first save. Save, then reopen.
- The redirect URI is an **exact string match**. No trailing-slash tolerance, no
  prefix matching, and the failure is a generic "Invalid request" page.
- Privacy defaults to sending neither name nor email.
- The default launch container is an iframe. For first testing set it to a new
  window, which takes third-party cookies out of the equation.

## The reference platform

`src/platform/` implements the platform side and deploys as its own Worker.

It is **a test harness, not a product**, and is labelled as such wherever it
appears. It exists so the launch is demonstrable without standing up Moodle, and
because implementing both directions is a fair proof that the protocol is
understood.

It has to be a separate Worker rather than a route on the tool, because a Worker
cannot fetch its own hostname; the tool's JWKS fetch would loop back. That
constraint happens to match reality.

## Running it

```bash
npm install
npm run typecheck
npm test
npm run dev
npm run deploy
npx wrangler deploy -c wrangler.platform.toml   # the harness
```

## A note on the free tier

These services run on Cloudflare's free plan, which caps D1 at **100,000 row
writes per day**. One full roster sync of the demonstration district writes
roughly 90,000 rows (29,115 staged, 29,115 sync records, and the operational
tables), so a second full sync on the same day exhausts the quota and writes
begin to fail with a clear D1 error.

Reads are unaffected: the applied roster, the dashboards and the APIs keep
working. It is a quota, not a defect, and the fix is either the $5/month Workers
Paid plan or waiting for the reset at midnight UTC.

Worth knowing before demonstrating this to anyone: run a full sync the day
before, not five minutes before.

## Status and honest limits

- The tool implements Resource Link launch, Deep Linking 2.0, NRPS 2.0 and AGS
  2.0 (line items and scores). It is **not certified**; 1EdTech certification
  applies to a specific product at a specific version and has not been sought.
- It has been exercised against the reference platform in this repository, not
  against a production Moodle or Canvas instance. The registration steps above
  are the documented path, and the Moodle-specific notes come from reading
  Moodle's own `auth.php` and `edit_form.php`.
- Admin auth is a single shared key, appropriate for a demonstration and not for
  production.
