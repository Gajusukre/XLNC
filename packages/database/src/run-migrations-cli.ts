import { createPool, closePool } from './pool';
import { runMigrations } from './migrate';

async function main() {
  const pool = createPool();
  try {
    const result = await runMigrations(pool);
    // eslint-disable-next-line no-console
    console.log(`[migrate] applied: ${result.applied.join(', ') || '(none)'}`);
    // eslint-disable-next-line no-console
    console.log(`[migrate] already up to date: ${result.skipped.join(', ') || '(none)'}`);
  } finally {
    await closePool(pool);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[migrate] FAILED:', err.message);
  process.exit(1);
});
