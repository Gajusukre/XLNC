import { Pool, PoolConfig } from 'pg';

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
}

export function loadDbConfig(env: NodeJS.ProcessEnv = process.env): DbConfig {
  return {
    host: env.POSTGRES_HOST || 'localhost',
    port: env.POSTGRES_PORT ? Number(env.POSTGRES_PORT) : 5432,
    user: env.POSTGRES_USER || 'postgres',
    password: env.POSTGRES_PASSWORD || 'postgres',
    database: env.POSTGRES_DB || 'xlnc_platform',
    ssl: env.POSTGRES_SSL === 'true',
  };
}

let sharedPool: Pool | null = null;

/**
 * Returns a process-wide singleton pool by default (createPool()), or a
 * fresh independent pool when a config override is passed (used by tests
 * to point at a separate test database without touching the shared pool).
 */
export function createPool(config?: DbConfig): Pool {
  if (!config) {
    if (!sharedPool) {
      sharedPool = new Pool(toPoolConfig(loadDbConfig()));
    }
    return sharedPool;
  }
  return new Pool(toPoolConfig(config));
}

export async function closePool(pool: Pool): Promise<void> {
  await pool.end();
  if (pool === sharedPool) {
    sharedPool = null;
  }
}

function toPoolConfig(config: DbConfig): PoolConfig {
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    max: 10,
  };
}
