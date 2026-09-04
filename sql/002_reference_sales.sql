-- FLIP RADAR 0.2 — official historical reference sales.
-- Additive, transactional and rerunnable. No acquisition source is enabled here.
BEGIN;

CREATE SCHEMA IF NOT EXISTS flip_radar;

CREATE TABLE IF NOT EXISTS flip_radar.reference_sales (
  source_id text NOT NULL CHECK (source_id ~ '^[a-z0-9_-]{2,64}$'),
  source_record_id text NOT NULL CHECK (source_record_id ~ '^[a-zA-Z0-9_.:-]{1,160}$'),
  official_lot_id text NOT NULL CHECK (official_lot_id ~ '^[a-zA-Z0-9_.:-]{1,120}$'),
  description text NOT NULL,
  description_derived boolean NOT NULL DEFAULT false,
  category text,
  brand text,
  model text,
  first_registration_date date,
  sale_number text,
  sold_at date NOT NULL,
  organizer text,
  sale_name text,
  sold_price_eur_cents bigint NOT NULL CHECK (sold_price_eur_cents > 0),
  verification_ref text NOT NULL,
  source_updated_at timestamptz NOT NULL,
  license_id text NOT NULL CHECK (license_id = 'etalab-2.0'),
  raw_hash text NOT NULL CHECK (raw_hash ~ '^[0-9a-f]{64}$'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, source_record_id)
);

CREATE INDEX IF NOT EXISTS fr_reference_sales_brand_model_idx
  ON flip_radar.reference_sales (lower(brand), lower(model), sold_at DESC);
CREATE INDEX IF NOT EXISTS fr_reference_sales_category_idx
  ON flip_radar.reference_sales (lower(category), sold_at DESC);
CREATE INDEX IF NOT EXISTS fr_reference_sales_sold_at_idx
  ON flip_radar.reference_sales (sold_at DESC);
CREATE INDEX IF NOT EXISTS fr_reference_sales_official_lot_idx
  ON flip_radar.reference_sales (official_lot_id);

CREATE TABLE IF NOT EXISTS flip_radar.reference_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key text NOT NULL UNIQUE,
  source_id text NOT NULL CHECK (source_id ~ '^[a-z0-9_-]{2,64}$'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  summary jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE flip_radar.reference_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE flip_radar.reference_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON flip_radar.reference_sales FROM PUBLIC;
REVOKE ALL ON flip_radar.reference_imports FROM PUBLIC;

INSERT INTO flip_radar.schema_migrations(version)
VALUES ('002_reference_sales')
ON CONFLICT DO NOTHING;

COMMIT;
