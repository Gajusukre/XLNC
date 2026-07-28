CREATE TABLE IF NOT EXISTS properties (
  id              TEXT PRIMARY KEY,           -- matches PmsAdapter Property.id (external system id, e.g. Hostify listing id)
  external_id     TEXT NOT NULL,
  name            TEXT NOT NULL,
  address         TEXT NOT NULL,
  bedrooms        INTEGER NOT NULL DEFAULT 0,
  bathrooms       INTEGER NOT NULL DEFAULT 0,
  base_price      NUMERIC(10, 2) NOT NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'USD',
  source_provider TEXT NOT NULL,              -- e.g. 'hostify'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_properties_source_provider ON properties (source_provider);

-- Generic trigger function: keeps updated_at current on any row update.
-- Reused by every table below that has an updated_at column.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_properties_updated_at ON properties;
CREATE TRIGGER trg_properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
