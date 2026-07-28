CREATE TABLE IF NOT EXISTS reservations (
  id           TEXT PRIMARY KEY,
  external_id  TEXT NOT NULL,
  property_id  TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  check_in     DATE NOT NULL,
  check_out    DATE NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  total_amount NUMERIC(10, 2) NOT NULL,
  currency     CHAR(3) NOT NULL DEFAULT 'USD',
  guest_name   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_reservation_dates CHECK (check_out > check_in)
);

CREATE INDEX IF NOT EXISTS idx_reservations_property_id ON reservations (property_id);
CREATE INDEX IF NOT EXISTS idx_reservations_checkin_checkout ON reservations (property_id, check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations (status);

DROP TRIGGER IF EXISTS trg_reservations_updated_at ON reservations;
CREATE TRIGGER trg_reservations_updated_at
  BEFORE UPDATE ON reservations
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
