import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { createPool, loadDbConfig } from '../src/pool';
import { runMigrations } from '../src/migrate';
import { PropertyRepository } from '../src/repositories/property.repository';
import { ReservationRepository } from '../src/repositories/reservation.repository';
import { PricingHistoryRepository } from '../src/repositories/pricing-history.repository';
import { SyncRunRepository } from '../src/repositories/sync-run.repository';
import { SyncService } from '../src/sync.service';
import { HostifyMockAdapter } from '@xlnc/hostify-adapter';

// These tests require a real reachable Postgres instance — point them at a
// dedicated test database (never the dev/prod one) via env vars. They are
// integration tests by design: they exercise real SQL, real constraints,
// and the real trigger/view objects created by the migrations, not mocks.
const testConfig = {
  ...loadDbConfig(),
  database: process.env.POSTGRES_TEST_DB || 'xlnc_platform_test',
};

describe('database package (integration, real Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createPool(testConfig);
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Reset between tests; CASCADE clears reservations/pricing_recommendations
    // via FK, TRUNCATE ... RESTART IDENTITY resets serial PKs too.
    await pool.query(
      'TRUNCATE properties, reservations, pricing_recommendations, sync_runs RESTART IDENTITY CASCADE',
    );
  });

  describe('PropertyRepository', () => {
    const repo = () => new PropertyRepository(pool);

    it('upserts and reads back a property', async () => {
      const properties = repo();
      await properties.upsert(
        {
          id: '1001',
          externalId: '1001',
          name: 'Baja Drive Retreat',
          address: '1234 Baja Dr, San Diego, CA',
          bedrooms: 4,
          bathrooms: 2,
          basePrice: 285,
          currency: 'USD',
        },
        'hostify',
      );

      const found = await properties.findById('1001');
      expect(found).not.toBeNull();
      expect(found?.name).toBe('Baja Drive Retreat');
      expect(found?.sourceProvider).toBe('hostify');
      expect(found?.basePrice).toBe(285);
    });

    it('upsert is idempotent and updates fields on conflict', async () => {
      const properties = repo();
      const base = {
        id: '1001',
        externalId: '1001',
        name: 'Old Name',
        address: 'addr',
        bedrooms: 2,
        bathrooms: 1,
        basePrice: 100,
        currency: 'USD',
      };
      await properties.upsert(base, 'hostify');
      await properties.upsert({ ...base, name: 'New Name', basePrice: 150 }, 'hostify');

      const all = await properties.findAll();
      expect(all).toHaveLength(1); // proves it updated, not duplicated
      expect(all[0].name).toBe('New Name');
      expect(all[0].basePrice).toBe(150);
    });

    it('the updated_at trigger actually fires on update', async () => {
      const properties = repo();
      const base = {
        id: '1001',
        externalId: '1001',
        name: 'Name',
        address: 'addr',
        bedrooms: 2,
        bathrooms: 1,
        basePrice: 100,
        currency: 'USD',
      };
      await properties.upsert(base, 'hostify');
      const first = await properties.findById('1001');

      await new Promise((r) => setTimeout(r, 10));
      await properties.upsert({ ...base, basePrice: 999 }, 'hostify');
      const second = await properties.findById('1001');

      expect(new Date(second!.updatedAt).getTime()).toBeGreaterThan(
        new Date(first!.updatedAt).getTime(),
      );
    });
  });

  describe('ReservationRepository + FK/CHECK constraints', () => {
    it('rejects a reservation for a nonexistent property (FK enforced)', async () => {
      const reservations = new ReservationRepository(pool);
      await expect(
        reservations.upsert({
          id: 'res-1',
          externalId: 'res-1',
          propertyId: 'does-not-exist',
          checkIn: '2026-08-01',
          checkOut: '2026-08-03',
          status: 'confirmed',
          totalAmount: 500,
          currency: 'USD',
        }),
      ).rejects.toThrow();
    });

    it('rejects checkOut <= checkIn (CHECK constraint enforced)', async () => {
      const properties = new PropertyRepository(pool);
      await properties.upsert(
        {
          id: '1001',
          externalId: '1001',
          name: 'P',
          address: 'A',
          bedrooms: 1,
          bathrooms: 1,
          basePrice: 100,
          currency: 'USD',
        },
        'hostify',
      );

      const reservations = new ReservationRepository(pool);
      await expect(
        reservations.upsert({
          id: 'res-1',
          externalId: 'res-1',
          propertyId: '1001',
          checkIn: '2026-08-05',
          checkOut: '2026-08-05', // invalid: same day
          status: 'confirmed',
          totalAmount: 500,
          currency: 'USD',
        }),
      ).rejects.toThrow();
    });

    it('finds reservations overlapping a date range', async () => {
      const properties = new PropertyRepository(pool);
      await properties.upsert(
        {
          id: '1001',
          externalId: '1001',
          name: 'P',
          address: 'A',
          bedrooms: 1,
          bathrooms: 1,
          basePrice: 100,
          currency: 'USD',
        },
        'hostify',
      );

      const reservations = new ReservationRepository(pool);
      await reservations.upsert({
        id: 'res-1',
        externalId: 'res-1',
        propertyId: '1001',
        checkIn: '2026-08-01',
        checkOut: '2026-08-05',
        status: 'confirmed',
        totalAmount: 500,
        currency: 'USD',
      });

      const found = await reservations.findByPropertyAndRange('1001', '2026-08-03', '2026-08-10');
      expect(found).toHaveLength(1);
      expect(found[0].id).toBe('res-1');
    });
  });

  describe('PricingHistoryRepository', () => {
    it('records recommendations as an append-only history (not overwritten)', async () => {
      const properties = new PropertyRepository(pool);
      await properties.upsert(
        {
          id: '1001',
          externalId: '1001',
          name: 'P',
          address: 'A',
          bedrooms: 1,
          bathrooms: 1,
          basePrice: 100,
          currency: 'USD',
        },
        'hostify',
      );

      const history = new PricingHistoryRepository(pool);
      await history.record({
        propertyId: '1001',
        date: '2026-08-01',
        currentPrice: 100,
        recommendedPrice: 110,
        changePercent: 10,
        reason: 'high demand',
        source: 'mock',
      });
      await history.record({
        propertyId: '1001',
        date: '2026-08-01',
        currentPrice: 100,
        recommendedPrice: 105,
        changePercent: 5,
        reason: 'demand cooled',
        source: 'mock',
      });

      const fullHistory = await history.findHistoryForProperty('1001', '2026-08-01', '2026-08-01');
      expect(fullHistory).toHaveLength(2); // both recorded, neither overwritten

      const latest = await history.findLatestForProperty('1001', '2026-08-01', '2026-08-01');
      expect(latest).toHaveLength(1); // view collapses to most recent per date
      expect(latest[0].recommendedPrice).toBe(105);
    });
  });

  describe('SyncRunRepository (execution log)', () => {
    it('logs a successful run', async () => {
      const syncRuns = new SyncRunRepository(pool);
      const runId = await syncRuns.start('test_job');
      await syncRuns.succeed(runId, 5);

      const recent = await syncRuns.recent('test_job');
      expect(recent[0].status).toBe('succeeded');
      expect(recent[0].recordsProcessed).toBe(5);
    });

    it('logs a failed run with the error message', async () => {
      const syncRuns = new SyncRunRepository(pool);
      const runId = await syncRuns.start('test_job');
      await syncRuns.fail(runId, 'boom');

      const recent = await syncRuns.recent('test_job');
      expect(recent[0].status).toBe('failed');
      expect(recent[0].errorMessage).toBe('boom');
    });
  });

  describe('SyncService (end-to-end against mock Hostify adapter + real DB)', () => {
    it('syncs mock Hostify properties into the real properties table', async () => {
      const hostify = new HostifyMockAdapter();
      const syncService = new SyncService(
        hostify,
        new PropertyRepository(pool),
        new ReservationRepository(pool),
        new SyncRunRepository(pool),
      );

      const result = await syncService.syncProperties();
      expect(result.count).toBeGreaterThan(0);

      const stored = await new PropertyRepository(pool).findAll();
      expect(stored.length).toBe(result.count);
      expect(stored.every((p) => p.sourceProvider === 'hostify')).toBe(true);
    });

    it('records a failed sync run when the adapter throws', async () => {
      const throwingAdapter: import('@xlnc/shared').PmsAdapter = {
        providerName: 'broken',
        mode: 'mock',
        listProperties: async () => {
          throw new Error('simulated adapter failure');
        },
        getReservations: async () => [],
        getAvailability: async () => [],
        updatePrice: async () => {},
      };
      const syncService = new SyncService(
        throwingAdapter,
        new PropertyRepository(pool),
        new ReservationRepository(pool),
        new SyncRunRepository(pool),
      );

      await expect(syncService.syncProperties()).rejects.toThrow('simulated adapter failure');

      const recent = await new SyncRunRepository(pool).recent('broken_properties_sync');
      expect(recent[0].status).toBe('failed');
      expect(recent[0].errorMessage).toContain('simulated adapter failure');
    });
  });
});
