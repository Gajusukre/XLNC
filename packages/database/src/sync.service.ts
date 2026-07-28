import { PmsAdapter } from '@xlnc/shared';
import { PropertyRepository } from './repositories/property.repository';
import { ReservationRepository } from './repositories/reservation.repository';
import { SyncRunRepository } from './repositories/sync-run.repository';

export class SyncService {
  constructor(
    private readonly pms: PmsAdapter,
    private readonly properties: PropertyRepository,
    private readonly reservations: ReservationRepository,
    private readonly syncRuns: SyncRunRepository,
  ) {}

  async syncProperties(): Promise<{ runId: number; count: number }> {
    const runId = await this.syncRuns.start(`${this.pms.providerName}_properties_sync`);
    try {
      const properties = await this.pms.listProperties();
      const count = await this.properties.upsertMany(properties, this.pms.providerName);
      await this.syncRuns.succeed(runId, count);
      return { runId, count };
    } catch (err) {
      await this.syncRuns.fail(runId, (err as Error).message);
      throw err;
    }
  }

  async syncReservations(
    propertyId: string,
    from: string,
    to: string,
  ): Promise<{ runId: number; count: number }> {
    const runId = await this.syncRuns.start(`${this.pms.providerName}_reservations_sync`);
    try {
      const reservations = await this.pms.getReservations(propertyId, from, to);
      const count = await this.reservations.upsertMany(reservations);
      await this.syncRuns.succeed(runId, count);
      return { runId, count };
    } catch (err) {
      await this.syncRuns.fail(runId, (err as Error).message);
      throw err;
    }
  }
}
