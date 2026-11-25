-- ChargeVisor Business: independent PostgreSQL schema. No access to BLITZ tables.
-- Run against a NEW, dedicated ChargeVisor database only.
BEGIN;
CREATE TABLE IF NOT EXISTS cv_tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 180),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended')),
  price_per_kwh numeric(7,4) CHECK (price_per_kwh BETWEEN 0 AND 999),
  licensed_points integer NOT NULL DEFAULT 0 CHECK (licensed_points BETWEEN 0 AND 100000),
  contact_name text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  contact_phone text NOT NULL DEFAULT '',
  street text NOT NULL DEFAULT '',
  house_number text NOT NULL DEFAULT '',
  postal_code text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT '',
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cv_users (
  id uuid PRIMARY KEY,
  tenant_id uuid REFERENCES cv_tenants(id) ON DELETE RESTRICT,
  email text NOT NULL UNIQUE CHECK (email=lower(email)),
  archived_login_email text,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  role text NOT NULL CHECK (role IN ('superadmin','admin','user')),
  password_hash text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  can_invite_users boolean NOT NULL DEFAULT false,
  can_download_pdf boolean NOT NULL DEFAULT false,
  can_control_charging boolean NOT NULL DEFAULT false,
  can_reset_station boolean NOT NULL DEFAULT false,
  portal_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,tenant_id),
  CHECK ((role='superadmin' AND tenant_id IS NULL) OR (role!='superadmin' AND tenant_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS cv_users_tenant_idx ON cv_users(tenant_id);
CREATE TABLE IF NOT EXISTS cv_sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES cv_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cv_sessions_expire_idx ON cv_sessions(expires_at);
CREATE TABLE IF NOT EXISTS cv_invitations (
  token_hash char(64) PRIMARY KEY,
  email text NOT NULL CHECK (email=lower(email)),
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','user')),
  tenant_id uuid NOT NULL REFERENCES cv_tenants(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES cv_users(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cv_invitations_tenant_idx ON cv_invitations(tenant_id);
-- One-use email password recovery for existing verified accounts.
CREATE TABLE IF NOT EXISTS cv_password_resets (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES cv_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cv_password_resets_user_idx ON cv_password_resets(user_id);
CREATE TABLE IF NOT EXISTS cv_chargepoints (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES cv_tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  ocpp_identity text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,tenant_id)
);
CREATE INDEX IF NOT EXISTS cv_chargepoints_tenant_idx ON cv_chargepoints(tenant_id);
CREATE TABLE IF NOT EXISTS cv_point_access (
  user_id uuid NOT NULL REFERENCES cv_users(id) ON DELETE CASCADE,
  chargepoint_id uuid NOT NULL REFERENCES cv_chargepoints(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES cv_tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id,chargepoint_id),
  FOREIGN KEY (chargepoint_id,tenant_id) REFERENCES cv_chargepoints(id,tenant_id),
  FOREIGN KEY (user_id,tenant_id) REFERENCES cv_users(id,tenant_id)
);
-- Pending user invitation can hold pre-approved point assignments, tenant-scoped.
CREATE UNIQUE INDEX IF NOT EXISTS cv_invitation_tenant_uq ON cv_invitations(token_hash,tenant_id);
CREATE TABLE IF NOT EXISTS cv_invitation_point_access (
  token_hash char(64) NOT NULL,
  tenant_id uuid NOT NULL,
  chargepoint_id uuid NOT NULL,
  PRIMARY KEY(token_hash,chargepoint_id),
  FOREIGN KEY(token_hash,tenant_id) REFERENCES cv_invitations(token_hash,tenant_id) ON DELETE CASCADE,
  FOREIGN KEY(chargepoint_id,tenant_id) REFERENCES cv_chargepoints(id,tenant_id) ON DELETE CASCADE
);
-- Physical infrastructure: one site has stations, stations have chargepoints.
-- OCPP 1.6J supports a shared charge-box identity with multiple numbered connectors.
CREATE TABLE IF NOT EXISTS cv_sites (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES cv_tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK(length(name) BETWEEN 2 AND 160),
  address text NOT NULL DEFAULT '',
  street text NOT NULL DEFAULT '',
  house_number text NOT NULL DEFAULT '',
  postal_code text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT 'Deutschland',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,tenant_id)
);
CREATE TABLE IF NOT EXISTS cv_stations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES cv_tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL,
  name text NOT NULL CHECK(length(name) BETWEEN 2 AND 160),
  topology text NOT NULL CHECK(topology IN ('shared','individual')),
  serial text NOT NULL DEFAULT '',
  ocpp_identity text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,tenant_id),
  FOREIGN KEY(site_id,tenant_id) REFERENCES cv_sites(id,tenant_id) ON DELETE RESTRICT
);
ALTER TABLE cv_chargepoints ADD COLUMN IF NOT EXISTS station_id uuid;
ALTER TABLE cv_chargepoints ADD COLUMN IF NOT EXISTS connector_number integer NOT NULL DEFAULT 1;
ALTER TABLE cv_chargepoints ADD COLUMN IF NOT EXISTS serial text NOT NULL DEFAULT '';
ALTER TABLE cv_chargepoints ADD COLUMN IF NOT EXISTS power_kw numeric(6,2);
ALTER TABLE cv_chargepoints DROP CONSTRAINT IF EXISTS cv_chargepoints_ocpp_identity_key;
CREATE UNIQUE INDEX IF NOT EXISTS cv_point_ocpp_connector_uniq ON cv_chargepoints(ocpp_identity,connector_number);
CREATE INDEX IF NOT EXISTS cv_point_station_idx ON cv_chargepoints(station_id,tenant_id);
CREATE INDEX IF NOT EXISTS cv_stations_site_idx ON cv_stations(site_id,tenant_id);
CREATE INDEX IF NOT EXISTS cv_sites_tenant_idx ON cv_sites(tenant_id);
ALTER TABLE cv_stations ADD COLUMN IF NOT EXISTS is_simulator boolean NOT NULL DEFAULT false;
-- Secrets are NEVER persisted in plaintext. One entry per OCPP WebSocket identity.
CREATE TABLE IF NOT EXISTS cv_ocpp_credentials (
  identity text PRIMARY KEY,
  tenant_id uuid NOT NULL,
  station_id uuid NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  last_connected_at timestamptz,
  FOREIGN KEY(station_id,tenant_id) REFERENCES cv_stations(id,tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS cv_ocpp_credentials_station_idx ON cv_ocpp_credentials(station_id,tenant_id);
-- OCPP messages arrive through a genuine, authenticated WebSocket connection.
-- All simulator telemetry is explicitly labeled; it is never billing data.
CREATE TABLE IF NOT EXISTS cv_ocpp_live (
 identity text PRIMARY KEY REFERENCES cv_ocpp_credentials(identity) ON DELETE CASCADE,
 tenant_id uuid NOT NULL,station_id uuid NOT NULL,
 connected boolean NOT NULL DEFAULT false,status text,action text,
 vendor text,model text,firmware text,energy_wh numeric,power_w numeric,
 simulated boolean NOT NULL DEFAULT false,last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cv_ocpp_events (
 id bigserial PRIMARY KEY,identity text NOT NULL REFERENCES cv_ocpp_credentials(identity) ON DELETE CASCADE,
 tenant_id uuid NOT NULL,action text NOT NULL,payload jsonb NOT NULL,
 simulated boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cv_ocpp_events_lookup_idx ON cv_ocpp_events(identity,created_at DESC);
-- Virtual OCPP end-to-end charging sessions. Real charging authorization remains disabled.
CREATE TABLE IF NOT EXISTS cv_ocpp_transactions (
  id bigserial PRIMARY KEY,
  identity text NOT NULL REFERENCES cv_ocpp_credentials(identity) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  connector_id integer NOT NULL,
  meter_start_wh numeric NOT NULL DEFAULT 0,
  meter_stop_wh numeric,
  started_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz,
  stop_reason text,
  signed_meter boolean,
  simulated boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS cv_ocpp_transactions_station_idx ON cv_ocpp_transactions(identity,started_at DESC);
CREATE TABLE IF NOT EXISTS cv_ocpp_connector_live (
  identity text NOT NULL REFERENCES cv_ocpp_credentials(identity) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  station_id uuid NOT NULL,
  connector_id integer NOT NULL,
  status text,
  energy_wh numeric,
  power_w numeric,
  simulated boolean NOT NULL DEFAULT false,
  last_seen timestamptz NOT NULL DEFAULT now(),
  status_changed_at timestamptz,
  error_code text,
  error_info text,
  PRIMARY KEY(identity,connector_id)
);
CREATE INDEX IF NOT EXISTS cv_ocpp_connector_tenant_idx ON cv_ocpp_connector_live(tenant_id,station_id);



-- Microsoft Graph OAuth is connected only by an authenticated Walectra superadmin.
-- OAuth states are one-use and bound to the user who initiated the connection.
CREATE TABLE IF NOT EXISTS cv_ms_oauth_states (
  state_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES cv_users(id) ON DELETE CASCADE,
  verifier_cipher text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cv_ms_mail_accounts (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id=1),
  microsoft_user_id text NOT NULL,
  email text NOT NULL,
  refresh_token_cipher text NOT NULL,
  connected_by uuid NOT NULL REFERENCES cv_users(id) ON DELETE RESTRICT,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cv_audit (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES cv_users(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES cv_tenants(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_id text,
  happened_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
