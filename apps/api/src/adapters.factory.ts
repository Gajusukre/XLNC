import { createHostifyAdapter } from '@xlnc/hostify-adapter';
import { createPriceLabsAdapter } from '@xlnc/pricelabs-adapter';
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
import { hashPassword } from './auth/password.util';

/**
 * Single composition point for the app. Every route handler gets its
 * dependencies from here rather than constructing adapters itself, so
 * there is exactly one place that decides live vs. mock for the whole API.
 *
 * DB connectivity is treated as degradable, not fatal: if Postgres is
 * unreachable at startup, the API still boots and serves live pricing
 * (the primary value) — it just can't persist history, authenticate
 * users, or serve DB-backed endpoints until connectivity returns.
 */
export async function buildDependencies() {
  const hostify = createHostifyAdapter();
  const priceLabs = createPriceLabsAdapter();
  const pricingEngine = new PricingEngineService(hostify, priceLabs);

  const pool = createPool();
  let dbAvailable = false;
  try {
    await pool.query('SELECT 1');
    await runMigrations(pool);
    dbAvailable = true;
    // eslint-disable-next-line no-console
    console.log('[database] connected and migrated successfully.');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[database] UNAVAILABLE at startup (${(err as Error).message}). ` +
        'API will continue serving live pricing; persistence/auth/history endpoints will return 503 until DB connectivity returns.',
    );
  }

  const properties = new PropertyRepository(pool);
  const reservations = new ReservationRepository(pool);
  const pricingHistory = new PricingHistoryRepository(pool);
  const syncRuns = new SyncRunRepository(pool);
  const users = new UserRepository(pool);
  const refreshTokens = new RefreshTokenRepository(pool);
  const auditLog = new AuditLogRepository(pool);
  const syncService = new SyncService(hostify, properties, reservations, syncRuns);

  if (dbAvailable) {
    await bootstrapAdminUser(users);
  }

  return {
    hostify,
    priceLabs,
    pricingEngine,
    pool,
    dbAvailable: () => dbAvailable,
    properties,
    reservations,
    pricingHistory,
    syncRuns,
    users,
    refreshTokens,
    auditLog,
    syncService,
  };
}

export type Dependencies = Awaited<ReturnType<typeof buildDependencies>>;

/**
 * Creates the first admin user from ADMIN_EMAIL/ADMIN_PASSWORD env vars,
 * but only if no admin exists yet. Never hardcodes credentials — both
 * values must come from the environment. Idempotent and safe to run on
 * every startup.
 */
async function bootstrapAdminUser(users: InstanceType<typeof UserRepository>): Promise<void> {
  const alreadyHasAdmin = await users.existsWithRole('admin');
  if (alreadyHasAdmin) return;

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    // eslint-disable-next-line no-console
    console.warn(
      '[auth] No admin user exists and ADMIN_EMAIL/ADMIN_PASSWORD are not set — ' +
        'skipping bootstrap. Set both in .env to create the first admin automatically, ' +
        'or insert one manually.',
    );
    return;
  }

  const passwordHash = await hashPassword(password);
  await users.create(email, passwordHash, 'admin');
  // eslint-disable-next-line no-console
  console.log(`[auth] Bootstrapped initial admin user: ${email}`);
}
