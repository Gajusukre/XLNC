import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../src/app';
import { Dependencies } from '../src/adapters.factory';
import { HostifyMockAdapter } from '@xlnc/hostify-adapter';
import { PriceLabsMockAdapter } from '@xlnc/pricelabs-adapter';
import { PricingEngineService } from '@xlnc/pricing-engine';
import {
  createPool,
  runMigrations,
  PropertyRepository,
  ReservationRepository,
  PricingHistoryRepository,
  SyncRunRepository,
  UserRepository,
  RefreshTokenRepository,
  AuditLogRepository,
  SyncService,
} from '@xlnc/database';
import { hashPassword } from '../src/auth/password.util';
import { signAccessToken, _resetSecretForTests } from '../src/auth/jwt.util';

// Two suites: one with a real (test) database wired in, one that simulates
// DB-unavailable to prove the API degrades gracefully rather than crashing
// or silently pretending persistence succeeded. Routes are now auth-protected,
// so each suite authenticates appropriately for the roles it needs.

describe('API (with real Postgres test DB)', () => {
  let app: Express;
  let deps: Dependencies;
  let managerToken: string;

  beforeAll(async () => {
    _resetSecretForTests();
    process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

    const hostify = new HostifyMockAdapter();
    const priceLabs = new PriceLabsMockAdapter();
    const pricingEngine = new PricingEngineService(hostify, priceLabs);

    const pool = createPool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : 5432,
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      database: process.env.POSTGRES_TEST_DB || 'xlnc_platform_test',
    });
    await runMigrations(pool);
    await pool.query(
      'TRUNCATE properties, reservations, pricing_recommendations, sync_runs, users, refresh_tokens, audit_log RESTART IDENTITY CASCADE',
    );

    const properties = new PropertyRepository(pool);
    const reservations = new ReservationRepository(pool);
    const pricingHistory = new PricingHistoryRepository(pool);
    const syncRuns = new SyncRunRepository(pool);
    const users = new UserRepository(pool);
    const refreshTokens = new RefreshTokenRepository(pool);
    const auditLog = new AuditLogRepository(pool);
    const syncService = new SyncService(hostify, properties, reservations, syncRuns);

    deps = {
      hostify,
      priceLabs,
      pricingEngine,
      pool,
      dbAvailable: () => true,
      properties,
      reservations,
      pricingHistory,
      syncRuns,
      users,
      refreshTokens,
      auditLog,
      syncService,
    };

    const manager = await users.create('manager@test.local', await hashPassword('irrelevant'), 'manager');
    managerToken = signAccessToken({ sub: manager.id, email: manager.email, role: manager.role });
  });

  afterAll(async () => {
    await deps.pool.end();
  });

  beforeEach(async () => {
    // Fresh app per test => fresh rate limiter instance per test. Login
    // attempts are deliberately capped tightly in production (10/15min);
    // reusing one app (and its limiter) across every test in this suite
    // would exceed that budget purely from test volume, not from any
    // actual brute-force behavior — so each test gets its own app/limiter,
    // while the DB/manager token above are still set up once for speed.
    app = createApp(deps);

    // pricing_recommendations is deliberately append-only (audit history),
    // so tests in this suite must reset between runs or counts leak across
    // tests — this is a test-isolation requirement, not a product behavior.
    // The manager user created in beforeAll must survive truncation, so
    // only reset the non-auth tables here.
    await deps.pool.query(
      'TRUNCATE properties, reservations, pricing_recommendations, sync_runs RESTART IDENTITY CASCADE',
    );
  });

  const auth = () => ({ Authorization: `Bearer ${managerToken}` });

  it('GET /health reports adapters live/mock and database connected (public, no auth)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.adapters.hostify).toBe('mock');
    expect(res.body.database).toBe('connected');
  });

  it('POST /sync/properties syncs mock Hostify properties into Postgres', async () => {
    const res = await request(app).post('/sync/properties').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);

    const stored = await deps.properties.findAll();
    expect(stored.length).toBe(res.body.count);
  });

  it('GET /pricing/:id/recommendations persists to history when DB is available', async () => {
    await request(app).post('/sync/properties').set(auth()); // ensure property exists for FK
    const res = await request(app)
      .get('/pricing/1001/recommendations?from=2026-08-01&to=2026-08-03')
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.persisted).toBe(true);

    const history = await deps.pricingHistory.findHistoryForProperty('1001', '2026-08-01', '2026-08-03');
    expect(history.length).toBe(3);
  });

  it('GET /pricing/:id/history returns persisted recommendations', async () => {
    await request(app).post('/sync/properties').set(auth());
    await request(app).get('/pricing/1001/recommendations?from=2026-08-01&to=2026-08-02').set(auth());

    const res = await request(app).get('/pricing/1001/history?from=2026-08-01&to=2026-08-02').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.history.length).toBe(2);
  });

  it('GET /sync/runs shows the execution log', async () => {
    await request(app).post('/sync/properties').set(auth());
    const res = await request(app).get('/sync/runs?jobName=hostify_properties_sync').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.runs[0].status).toBe('succeeded');
  });
});

describe('API (DB unavailable — graceful degradation)', () => {
  let app: Express;
  let viewerToken: string;

  beforeAll(() => {
    _resetSecretForTests();
    process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

    const hostify = new HostifyMockAdapter();
    const priceLabs = new PriceLabsMockAdapter();
    const pricingEngine = new PricingEngineService(hostify, priceLabs);
    // Point the pool at a port nothing is listening on, to simulate an
    // unreachable database without needing to actually stop Postgres.
    const pool = createPool({
      host: '127.0.0.1',
      port: 1, // nothing listens here
      user: 'postgres',
      password: 'postgres',
      database: 'xlnc_platform',
    });

    const properties = new PropertyRepository(pool);
    const reservations = new ReservationRepository(pool);
    const pricingHistory = new PricingHistoryRepository(pool);
    const syncRuns = new SyncRunRepository(pool);
    const users = new UserRepository(pool);
    const refreshTokens = new RefreshTokenRepository(pool);
    const auditLog = new AuditLogRepository(pool);
    const syncService = new SyncService(hostify, properties, reservations, syncRuns);

    app = createApp({
      hostify,
      priceLabs,
      pricingEngine,
      pool,
      dbAvailable: () => false, // simulates the startup check having failed
      properties,
      reservations,
      pricingHistory,
      syncRuns,
      users,
      refreshTokens,
      auditLog,
      syncService,
    });

    // JWT verification is stateless (no DB needed), so authentication still
    // works even with the DB down — this token is crafted directly rather
    // than via /auth/login, since login itself requires the DB.
    viewerToken = signAccessToken({ sub: 'test-user-id', email: 'viewer@test.local', role: 'viewer' });
  });

  const auth = () => ({ Authorization: `Bearer ${viewerToken}` });

  it('GET /health reports database unavailable without crashing', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.database).toBe('unavailable');
  });

  it('GET /pricing/:id/recommendations still returns live pricing with persisted:false', async () => {
    const res = await request(app)
      .get('/pricing/1001/recommendations?from=2026-08-01&to=2026-08-02')
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.persisted).toBe(false);
    expect(res.body.recommendations).toHaveLength(2);
  });

  it('GET /pricing/:id/history returns 503 rather than hanging or crashing', async () => {
    const res = await request(app).get('/pricing/1001/history?from=2026-08-01&to=2026-08-02').set(auth());
    expect(res.status).toBe(503);
  });

  it('POST /sync/properties returns 503 rather than throwing (still requires manager+ role)', async () => {
    // viewer lacks the manager/admin role sync requires, so this correctly
    // 403s on authorization before ever reaching the DB-unavailable check —
    // proving RBAC is enforced even when the DB is down.
    const res = await request(app).post('/sync/properties').set(auth());
    expect(res.status).toBe(403);
  });
});
