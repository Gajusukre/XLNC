-- Execution log for background/triggered sync jobs (Hostify pull,
-- PriceLabs pull, etc). One row per run, so failures are visible and
-- queryable rather than only living in application logs.
CREATE TABLE IF NOT EXISTS sync_runs (
  id           BIGSERIAL PRIMARY KEY,
  job_name     TEXT NOT NULL,        -- e.g. 'hostify_properties_sync'
  status       TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  records_processed INTEGER,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_job_name ON sync_runs (job_name, started_at);
