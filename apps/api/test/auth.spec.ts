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
import { _resetSecretForTests } from '../src/auth/jwt.util';

describe('Auth + RBAC (real Postgres test DB)', () => {
  let app: Express;
  let deps: Dependencies;

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
    app = createApp(deps);
  });

  afterAll(async () => {
    await deps.pool.end();
  });

  beforeEach(async () => {
    // Fresh app per test => fresh rate limiter instance per test. The
    // login endpoint's production limit (10 attempts/15min) is deliberately
    // tight for brute-force protection; this suite alone makes more than
    // 10 login calls across its tests, which would exhaust one shared
    // limiter's budget purely from test volume rather than any actual
    // brute-force behavior. A fresh app per test avoids that while keeping
    // the production limiter itself genuinely strict.
    app = createApp(deps);
    await deps.pool.query(
      'TRUNCATE users, refresh_tokens, audit_log, properties, reservations, pricing_recommendations, sync_runs RESTART IDENTITY CASCADE',
    );
  });

  async function createUser(email: string, password: string, role: 'admin' | 'manager' | 'viewer') {
    const hash = await hashPassword(password);
    return deps.users.create(email, hash, role);
  }

  describe('POST /auth/login', () => {
    it('rejects unknown email with a generic 401 (no user enumeration)', async () => {
      const res = await request(app).post('/auth/login').send({ email: 'nobody@x.com', password: 'whatever1' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid credentials');
    });

    it('rejects wrong password with the same generic 401', async () => {
      await createUser('viewer@xlnc.test', 'correct-password', 'viewer');
      const res = await request(app).post('/auth/login').send({ email: 'viewer@xlnc.test', password: 'wrong-password' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid credentials');
    });

    it('logs a failed login attempt in the audit log', async () => {
      await request(app).post('/auth/login').send({ email: 'nobody@x.com', password: 'whatever1' });
      const failures = await deps.auditLog.recentByAction('login_failure');
      expect(failures.length).toBeGreaterThan(0);
    });

    it('succeeds with correct credentials and returns access + refresh tokens', async () => {
      await createUser('viewer@xlnc.test', 'correct-password', 'viewer');
      const res = await request(app).post('/auth/login').send({ email: 'viewer@xlnc.test', password: 'correct-password' });
      expect(res.status).toBe(200);
      expect(typeof res.body.accessToken).toBe('string');
      expect(typeof res.body.refreshToken).toBe('string');
      expect(res.body.user.role).toBe('viewer');
    });

    it('logs a successful login in the audit log', async () => {
      await createUser('viewer@xlnc.test', 'correct-password', 'viewer');
      await request(app).post('/auth/login').send({ email: 'viewer@xlnc.test', password: 'correct-password' });
      const successes = await deps.auditLog.recentByAction('login_success');
      expect(successes.length).toBe(1);
    });

    it('rate-limits repeated login attempts from the same client (11th attempt is throttled)', async () => {
      await createUser('viewer@xlnc.test', 'correct-password', 'viewer');
      let lastStatus = 0;
      for (let i = 0; i < 11; i++) {
        const res = await request(app)
          .post('/auth/login')
          .send({ email: 'viewer@xlnc.test', password: 'wrong-on-purpose' });
        lastStatus = res.status;
      }
      // The production limit is 10 attempts/15min — the 11th must be throttled.
      expect(lastStatus).toBe(429);
    });
  });

  describe('RBAC enforcement on protected routes', () => {
    it('rejects unauthenticated requests to /properties with 401', async () => {
      const res = await request(app).get('/properties');
      expect(res.status).toBe(401);
    });

    it('rejects a malformed/garbage token with 401', async () => {
      const res = await request(app).get('/properties').set('Authorization', 'Bearer not-a-real-token');
      expect(res.status).toBe(401);
    });

    it('viewer CAN read /properties', async () => {
      await createUser('viewer@xlnc.test', 'correct-password', 'viewer');
      const login = await request(app).post('/auth/login').send({ email: 'viewer@xlnc.test', password: 'correct-password' });
      const res = await request(app).get('/properties').set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(res.status).toBe(200);
    });

    it('viewer CANNOT trigger /sync/properties (403)', async () => {
      await createUser('viewer@xlnc.test', 'correct-password', 'viewer');
      const login = await request(app).post('/auth/login').send({ email: 'viewer@xlnc.test', password: 'correct-password' });
      const res = await request(app).post('/sync/properties').set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(res.status).toBe(403);
    });

    it('manager CAN trigger /sync/properties', async () => {
      await createUser('manager@xlnc.test', 'correct-password', 'manager');
      const login = await request(app).post('/auth/login').send({ email: 'manager@xlnc.test', password: 'correct-password' });
      const res = await request(app).post('/sync/properties').set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(res.status).toBe(200);
    });

    it('manager CANNOT create users (admin-only, 403)', async () => {
      await createUser('manager@xlnc.test', 'correct-password', 'manager');
      const login = await request(app).post('/auth/login').send({ email: 'manager@xlnc.test', password: 'correct-password' });
      const res = await request(app)
        .post('/auth/users')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .send({ email: 'new@xlnc.test', password: 'password123', role: 'viewer' });
      expect(res.status).toBe(403);
    });

    it('admin CAN create users, and the new user can log in', async () => {
      await createUser('admin@xlnc.test', 'correct-password', 'admin');
      const login = await request(app).post('/auth/login').send({ email: 'admin@xlnc.test', password: 'correct-password' });

      const createRes = await request(app)
        .post('/auth/users')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .send({ email: 'new@xlnc.test', password: 'password123', role: 'viewer' });
      expect(createRes.status).toBe(201);

      const newLogin = await request(app).post('/auth/login').send({ email: 'new@xlnc.test', password: 'password123' });
      expect(newLogin.status).toBe(200);
    });
  });

  describe('Refresh token flow', () => {
    it('exchanges a valid refresh token for a new access token, and rotates it', async () => {
      await createUser('viewer@xlnc.test', 'correct-password', 'viewer');
      const login = await request(app).post('/auth/login').send({ email: 'viewer@xlnc.test', password: 'correct-password' });

      const refreshRes = await request(app).post('/auth/refresh').send({ refreshToken: login.body.refreshToken });
      expect(refreshRes.status).toBe(200);
      expect(typeof refreshRes.body.accessToken).toBe('string');
      expect(refreshRes.body.refreshToken).not.toBe(login.body.refreshToken); // rotated

      // Old refresh token must now be dead (single use).
      const reuseRes = await request(app).post('/auth/refresh').send({ refreshToken: login.body.refreshToken });
      expect(reuseRes.status).toBe(401);
    });

    it('logout revokes the refresh token', async () => {
      await createUser('viewer@xlnc.test', 'correct-password', 'viewer');
      const login = await request(app).post('/auth/login').send({ email: 'viewer@xlnc.test', password: 'correct-password' });

      await request(app).post('/auth/logout').send({ refreshToken: login.body.refreshToken });
      const refreshRes = await request(app).post('/auth/refresh').send({ refreshToken: login.body.refreshToken });
      expect(refreshRes.status).toBe(401);
    });
  });

  describe('GET /auth/me', () => {
    it('returns the authenticated user identity from the token', async () => {
      await createUser('viewer@xlnc.test', 'correct-password', 'viewer');
      const login = await request(app).post('/auth/login').send({ email: 'viewer@xlnc.test', password: 'correct-password' });
      const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('viewer@xlnc.test');
      expect(res.body.user.role).toBe('viewer');
    });
  });
});
