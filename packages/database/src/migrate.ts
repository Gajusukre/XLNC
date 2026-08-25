import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, 'migrations');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

// Arbitrary fixed key for the session-level advisory lock that serializes
// migration runs. Any two processes pointed at the same database (two test
// workers running their own beforeAll, two API instances starting up at
// once, etc.) will block on this instead of racing to create the same
// tables — an unserialized "CREATE TABLE IF NOT EXISTS" is not safe against
// concurrent execution and can fail with a duplicate key error against
// Postgres's internal pg_type catalog.
const MIGRATION_LOCK_KEY = 0x584c4e43; // 'XLNC' as a 32-bit int, arbitrary but stable

/**
 * Applies every .sql file in src/migrations, in filename order, that
 * hasn't already been recorded in schema_migrations. Each migration runs
 * inside its own transaction — a failure rolls back that one migration
 * and stops, rather than leaving the schema half-applied.
 *
 * The whole run is wrapped in a session-level advisory lock so concurrent
 * callers (e.g. two test suites, or multiple API instances starting up
 * together) serialize instead of racing to create the same schema objects.
 */
export async function runMigrations(pool: Pool): Promise<MigrationResult> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      const files = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      const { rows } = await client.query<{ name: string }>(
        'SELECT name FROM schema_migrations',
      );
      const alreadyApplied = new Set(rows.map((r) => r.name));

      const applied: string[] = [];
      const skipped: string[] = [];

      for (const file of files) {
        if (alreadyApplied.has(file)) {
          skipped.push(file);
          continue;
        }

        const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
        try {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
          applied.push(file);
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
        }
      }

      return { applied, skipped };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
