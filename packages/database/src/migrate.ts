import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, 'migrations');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies every .sql file in src/migrations, in filename order, that
 * hasn't already been recorded in schema_migrations. Each migration runs
 * inside its own transaction — a failure rolls back that one migration
 * and stops, rather than leaving the schema half-applied.
 */
export async function runMigrations(pool: Pool): Promise<MigrationResult> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const alreadyApplied = new Set(rows.map((r) => r.name));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (alreadyApplied.has(file)) {
      skipped.push(file);
      continue;
    }

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  return { applied, skipped };
}
