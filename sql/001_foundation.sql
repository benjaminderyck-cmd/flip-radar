-- FLIP RADAR 0.1 — additive, transactional, rerunnable migration.
-- Run on a dedicated Postgres 15+ / Supabase database or schema.
-- Does not DROP, TRUNCATE, modify n8n tables or touch Perlesmania data.
BEGIN;
CREATE SCHEMA IF NOT EXISTS flip_radar;
REVOKE ALL ON SCHEMA flip_radar FROM PUBLIC;
CREATE TABLE IF NOT EXISTS flip_radar.schema_migrations (
  version text PRIMARY KEY, installed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS flip_radar.sources (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9_-]{2,64}$'),
  config jsonb NOT NULL CHECK (jsonb_typeof(config)='object'),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS flip_radar.missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_key text NOT NULL UNIQUE,
  input_hash text NOT NULL, payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0), lease_token uuid, lease_until timestamptz,
  last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fr_missions_queue_idx ON flip_radar.missions(status,created_at);
CREATE TABLE IF NOT EXISTS flip_radar.runs (
  id uuid PRIMARY KEY, mission_id uuid NOT NULL REFERENCES flip_radar.missions(id),
  status text NOT NULL, summary jsonb NOT NULL, trace jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS flip_radar.listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text NOT NULL REFERENCES flip_radar.sources(id),
  source_listing_id text NOT NULL, canonical_url text NOT NULL UNIQUE,
  payload jsonb NOT NULL CHECK (payload->>'mode' = 'live'),
  fingerprint text NOT NULL, observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id,source_listing_id)
);
CREATE INDEX IF NOT EXISTS fr_listings_observed_idx ON flip_radar.listings(observed_at DESC);
CREATE TABLE IF NOT EXISTS flip_radar.listing_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  listing_id uuid NOT NULL REFERENCES flip_radar.listings(id),
  run_id uuid NOT NULL REFERENCES flip_radar.runs(id), fingerprint text NOT NULL,
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(listing_id,fingerprint)
);
CREATE TABLE IF NOT EXISTS flip_radar.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), listing_id uuid NOT NULL REFERENCES flip_radar.listings(id),
  request_key text NOT NULL UNIQUE, input_hash text NOT NULL,
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS flip_radar.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), listing_id uuid NOT NULL REFERENCES flip_radar.listings(id),
  review_id uuid NOT NULL UNIQUE REFERENCES flip_radar.reviews(id),
  verdict text NOT NULL CHECK (verdict IN ('GO','REVUE','SURVEILLER','NON')),
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fr_opportunities_verdict_idx ON flip_radar.opportunities(verdict,created_at DESC);
CREATE TABLE IF NOT EXISTS flip_radar.alert_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), opportunity_id uuid NOT NULL REFERENCES flip_radar.opportunities(id),
  dedupe_key text NOT NULL UNIQUE, text text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','sent','uncertain')),
  claim_token uuid, claimed_at timestamptz, sent_at timestamptz, telegram_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fr_outbox_pending_idx ON flip_radar.alert_outbox(status,created_at);
CREATE TABLE IF NOT EXISTS flip_radar.decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), opportunity_id uuid NOT NULL REFERENCES flip_radar.opportunities(id),
  request_key text NOT NULL UNIQUE, decision text NOT NULL CHECK (decision IN ('watch','reject','bought','sold_elsewhere')),
  notes text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
-- No public/anon reads via Supabase. Schema owner runs the private backend.
-- For a non-owner service role, add dedicated grants + RLS policies separately.
ALTER TABLE flip_radar.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE flip_radar.missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE flip_radar.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE flip_radar.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE flip_radar.listing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE flip_radar.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE flip_radar.opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE flip_radar.alert_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE flip_radar.decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE flip_radar.schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA flip_radar FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA flip_radar FROM PUBLIC;
INSERT INTO flip_radar.schema_migrations(version) VALUES ('001_foundation') ON CONFLICT DO NOTHING;
COMMIT;
