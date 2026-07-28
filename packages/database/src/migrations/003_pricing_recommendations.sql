-- Append-only history: every time the pricing engine computes a
-- recommendation for a property+date, a new row is inserted here rather
-- than overwriting a prior one. This is the audit trail of what the
-- system recommended and when, and what market conditions (live vs mock)
-- informed it.
CREATE TABLE IF NOT EXISTS pricing_recommendations (
  id                 BIGSERIAL PRIMARY KEY,
  property_id        TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  target_date        DATE NOT NULL,
  current_price      NUMERIC(10, 2) NOT NULL,
  recommended_price  NUMERIC(10, 2) NOT NULL,
  change_percent     NUMERIC(6, 2) NOT NULL,
  reason             TEXT NOT NULL,
  pricing_source     TEXT NOT NULL CHECK (pricing_source IN ('live', 'mock')),
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricing_recs_property_date ON pricing_recommendations (property_id, target_date);
CREATE INDEX IF NOT EXISTS idx_pricing_recs_computed_at ON pricing_recommendations (computed_at);

-- Convenience view: the most recently computed recommendation per
-- property+date, so callers don't need to know the "latest wins" logic.
CREATE OR REPLACE VIEW latest_pricing_recommendations AS
SELECT DISTINCT ON (property_id, target_date)
  id, property_id, target_date, current_price, recommended_price,
  change_percent, reason, pricing_source, computed_at
FROM pricing_recommendations
ORDER BY property_id, target_date, computed_at DESC;
