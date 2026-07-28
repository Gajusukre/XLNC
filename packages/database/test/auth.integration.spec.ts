import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { createPool, loadDbConfig } from '../src/pool';
import { runMigrations } from '../src/migrate';
import { UserRepository } from '../src/repositories/user.repository';
import { RefreshTokenRepository, hashToken } from '../src/repositories/refresh-token.repository';
import { AuditLogRepository } from '../src/repositories/audit-log.repository';

const testConfig = {
  ...loadDbConfig(),
  database: process.env.POSTGRES_TEST_DB || 'xlnc_platform_test',
};

describe('auth repositories (integration, real Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createPool(testConfig);
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE users, refresh_tokens, audit_log RESTART IDENTITY CASCADE',
    );
  });

  describe('UserRepository', () => {
    it('creates a user and enforces unique email (real UNIQUE constraint)', async () => {
      const users = new UserRepository(pool);
      await users.create('admin@xlnc.test', 'hashed-value', 'admin');
      await expect(users.create('admin@xlnc.test', 'other-hash', 'viewer')).rejects.toThrow();
    });

    it('rejects an invalid role (real CHECK constraint)', async () => {
      const users = new UserRepository(pool);
      await expect(
        // @ts-expect-error deliberately invalid role to prove the DB constraint holds
        users.create('bad-role@xlnc.test', 'hash', 'superuser'),
      ).rejects.toThrow();
    });

    it('finds a user by email case-insensitively (normalized to lowercase on write)', async () => {
      const users = new UserRepository(pool);
      await users.create('Admin@XLNC.test', 'hash', 'admin');
      const found = await users.findByEmail('admin@xlnc.test');
      expect(found).not.toBeNull();
    });

    it('existsWithRole correctly reports presence/absence', async () => {
      const users = new UserRepository(pool);
      expect(await users.existsWithRole('admin')).toBe(false);
      await users.create('admin@xlnc.test', 'hash', 'admin');
      expect(await users.existsWithRole('admin')).toBe(true);
      expect(await users.existsWithRole('manager')).toBe(false);
    });
  });

  describe('RefreshTokenRepository', () => {
    it('stores a token hashed, never the raw value', async () => {
      const users = new UserRepository(pool);
      const user = await users.create('user@xlnc.test', 'hash', 'viewer');
      const tokens = new RefreshTokenRepository(pool);
      const raw = 'super-secret-raw-refresh-token';
      await tokens.store(user.id, raw, new Date(Date.now() + 60_000));

      const { rows } = await pool.query('SELECT token_hash FROM refresh_tokens');
      expect(rows[0].token_hash).toBe(hashToken(raw));
      expect(rows[0].token_hash).not.toBe(raw);
    });

    it('findValid returns the record for an unexpired, unrevoked token', async () => {
      const users = new UserRepository(pool);
      const user = await users.create('user@xlnc.test', 'hash', 'viewer');
      const tokens = new RefreshTokenRepository(pool);
      const raw = 'valid-token';
      await tokens.store(user.id, raw, new Date(Date.now() + 60_000));

      const found = await tokens.findValid(raw);
      expect(found).not.toBeNull();
      expect(found?.userId).toBe(user.id);
    });

    it('findValid returns null for an expired token', async () => {
      const users = new UserRepository(pool);
      const user = await users.create('user@xlnc.test', 'hash', 'viewer');
      const tokens = new RefreshTokenRepository(pool);
      const raw = 'expired-token';
      await tokens.store(user.id, raw, new Date(Date.now() - 1000)); // already expired

      const found = await tokens.findValid(raw);
      expect(found).toBeNull();
    });

    it('findValid returns null after revocation', async () => {
      const users = new UserRepository(pool);
      const user = await users.create('user@xlnc.test', 'hash', 'viewer');
      const tokens = new RefreshTokenRepository(pool);
      const raw = 'to-be-revoked';
      await tokens.store(user.id, raw, new Date(Date.now() + 60_000));

      await tokens.revoke(raw);
      const found = await tokens.findValid(raw);
      expect(found).toBeNull();
    });

    it('revokeAllForUser invalidates every active token for that user', async () => {
      const users = new UserRepository(pool);
      const user = await users.create('user@xlnc.test', 'hash', 'viewer');
      const tokens = new RefreshTokenRepository(pool);
      await tokens.store(user.id, 'token-a', new Date(Date.now() + 60_000));
      await tokens.store(user.id, 'token-b', new Date(Date.now() + 60_000));

      await tokens.revokeAllForUser(user.id);

      expect(await tokens.findValid('token-a')).toBeNull();
      expect(await tokens.findValid('token-b')).toBeNull();
    });
  });

  describe('AuditLogRepository', () => {
    it('records a login success/failure and reads it back', async () => {
      const users = new UserRepository(pool);
      const user = await users.create('user@xlnc.test', 'hash', 'viewer');
      const audit = new AuditLogRepository(pool);

      await audit.record({ userId: user.id, action: 'login_success', success: true, ipAddress: '127.0.0.1' });
      await audit.record({ userId: null, action: 'login_failure', success: false, detail: 'bad password' });

      const forUser = await audit.recentForUser(user.id);
      expect(forUser).toHaveLength(1);
      expect(forUser[0].action).toBe('login_success');

      const failures = await audit.recentByAction('login_failure');
      expect(failures).toHaveLength(1);
      expect(failures[0].success).toBe(false);
    });

    it('keeps the audit row when the referenced user is deleted (ON DELETE SET NULL)', async () => {
      const users = new UserRepository(pool);
      const user = await users.create('temp@xlnc.test', 'hash', 'viewer');
      const audit = new AuditLogRepository(pool);
      await audit.record({ userId: user.id, action: 'login_success', success: true });

      await pool.query('DELETE FROM users WHERE id = $1', [user.id]);

      const { rows } = await pool.query('SELECT * FROM audit_log WHERE action = $1', ['login_success']);
      expect(rows).toHaveLength(1); // row survives
      expect(rows[0].user_id).toBeNull(); // FK set null, not cascaded delete
    });
  });
});
