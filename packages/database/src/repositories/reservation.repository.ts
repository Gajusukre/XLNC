import { Pool } from 'pg';
import { Reservation } from '@xlnc/shared';

export class ReservationRepository {
  constructor(private readonly pool: Pool) {}

  async upsert(reservation: Reservation): Promise<void> {
    await this.pool.query(
      `INSERT INTO reservations (id, external_id, property_id, check_in, check_out, status, total_amount, currency, guest_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         check_in = EXCLUDED.check_in,
         check_out = EXCLUDED.check_out,
         total_amount = EXCLUDED.total_amount,
         currency = EXCLUDED.currency,
         guest_name = EXCLUDED.guest_name`,
      [
        reservation.id,
        reservation.externalId,
        reservation.propertyId,
        reservation.checkIn,
        reservation.checkOut,
        reservation.status,
        reservation.totalAmount,
        reservation.currency,
        reservation.guestName ?? null,
      ],
    );
  }

  async upsertMany(reservations: Reservation[]): Promise<number> {
    for (const reservation of reservations) {
      await this.upsert(reservation);
    }
    return reservations.length;
  }

  async findByPropertyAndRange(
    propertyId: string,
    from: string,
    to: string,
  ): Promise<Reservation[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM reservations
       WHERE property_id = $1 AND check_in <= $3 AND check_out >= $2
       ORDER BY check_in ASC`,
      [propertyId, from, to],
    );
    return rows.map(mapRow);
  }
}

function mapRow(row: Record<string, unknown>): Reservation {
  return {
    id: row.id as string,
    externalId: row.external_id as string,
    propertyId: row.property_id as string,
    checkIn: toIsoDate(row.check_in),
    checkOut: toIsoDate(row.check_out),
    status: row.status as Reservation['status'],
    totalAmount: Number(row.total_amount),
    currency: row.currency as string,
    guestName: (row.guest_name as string) ?? undefined,
  };
}

function toIsoDate(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}
