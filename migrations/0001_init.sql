-- lti-launch schema.

-- A registration is one platform deployment.
--
-- The tenancy key is (issuer, client_id, deployment_id), NOT the issuer alone.
-- One platform issuer can host many deployments: several districts on the same
-- regional Canvas instance, or several sub-accounts inside one district.
-- Keying on the issuer alone puts two districts in one tenant, which is a data
-- isolation failure rather than a bug.
CREATE TABLE registrations (
  id                TEXT PRIMARY KEY,
  issuer            TEXT NOT NULL,
  client_id         TEXT NOT NULL,
  deployment_id     TEXT NOT NULL,
  label             TEXT NOT NULL,
  auth_login_url    TEXT NOT NULL,
  auth_token_url    TEXT NOT NULL,
  jwks_url          TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  UNIQUE (issuer, client_id, deployment_id)
);

-- The tool's own signing key. Published at /.well-known/jwks.json and used to
-- sign the client assertion when requesting a token from the platform.
CREATE TABLE tool_keys (
  kid          TEXT PRIMARY KEY,
  public_jwk   TEXT NOT NULL,
  private_jwk  TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);

-- OIDC state and nonce, single use.
--
-- Checking the nonce for replay is skipped surprisingly often. It is the
-- difference between "we validated the token" and "we verified this launch
-- happened once, now".
CREATE TABLE login_states (
  state        TEXT PRIMARY KEY,
  nonce        TEXT NOT NULL,
  issuer       TEXT NOT NULL,
  client_id    TEXT,
  target_link  TEXT,
  created_at   TEXT NOT NULL,
  consumed_at  TEXT
);
CREATE INDEX idx_login_created ON login_states (created_at);

-- One row per launching human per registration.
--
-- `subject` is the only identifier guaranteed to be present. Name and email are
-- absent whenever the platform's privacy level says so, which is the default in
-- Moodle, so both are nullable and the tool works without them.
CREATE TABLE launch_users (
  id              TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL,
  subject         TEXT NOT NULL,
  name            TEXT,
  email           TEXT,
  role            TEXT NOT NULL,
  first_seen      TEXT NOT NULL,
  last_seen       TEXT NOT NULL,
  UNIQUE (registration_id, subject)
);

CREATE TABLE launches (
  id               TEXT PRIMARY KEY,
  registration_id  TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  message_type     TEXT NOT NULL,
  context_id       TEXT,
  context_title    TEXT,
  resource_link_id TEXT,
  activity_id      TEXT,
  roles_json       TEXT NOT NULL,
  ags_json         TEXT,
  nrps_url         TEXT,
  deep_link_json   TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_launches_user ON launches (user_id, created_at DESC);

-- Attempts at the activity. The evidence lives here; passback is a copy for the
-- teacher's convenience, so a platform being down must never lose the work.
CREATE TABLE attempts (
  id               TEXT PRIMARY KEY,
  launch_id        TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  registration_id  TEXT NOT NULL,
  resource_link_id TEXT,
  activity_id      TEXT NOT NULL,
  score            REAL NOT NULL,
  max_score        REAL NOT NULL,
  detail_json      TEXT NOT NULL,
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_attempts_user ON attempts (user_id, created_at DESC);

-- Score delivery as an object with a lifecycle rather than a fire-and-forget
-- event. This is what turns "did it land?" into a query instead of a guess,
-- and it gives the retry surface for free.
CREATE TABLE score_deliveries (
  id             TEXT PRIMARY KEY,
  attempt_id     TEXT NOT NULL,
  line_item_url  TEXT NOT NULL,
  -- pending | accepted | rejected | superseded
  state          TEXT NOT NULL,
  attempts_count INTEGER NOT NULL DEFAULT 0,
  -- Strictly monotonic per (user, line item). A retry that reuses the original
  -- timestamp is rejected by the platform as stale.
  sent_timestamp TEXT,
  http_status    INTEGER,
  response_body  TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_delivery_attempt ON score_deliveries (attempt_id);

-- ---------------------------------------------------------------------------
-- Reference platform (a test harness, not a product)
--
-- Implementing the platform side as well as the tool side is what makes the
-- launch demonstrable without standing up Moodle, and it is a reasonable proof
-- that the protocol is understood in both directions. It is deliberately
-- labelled everywhere it appears so nobody mistakes it for the product.
-- ---------------------------------------------------------------------------

CREATE TABLE platform_keys (
  kid         TEXT PRIMARY KEY,
  public_jwk  TEXT NOT NULL,
  private_jwk TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE platform_line_items (
  id               TEXT PRIMARY KEY,
  context_id       TEXT NOT NULL,
  resource_link_id TEXT,
  label            TEXT NOT NULL,
  score_maximum    REAL NOT NULL,
  created_at       TEXT NOT NULL
);

-- The platform's gradebook. What lands here is the proof that passback worked.
CREATE TABLE platform_scores (
  id             TEXT PRIMARY KEY,
  line_item_id   TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  score_given    REAL,
  score_maximum  REAL,
  activity_progress TEXT,
  grading_progress  TEXT,
  timestamp      TEXT NOT NULL,
  received_at    TEXT NOT NULL
);
CREATE INDEX idx_pscores_item ON platform_scores (line_item_id, user_id);
