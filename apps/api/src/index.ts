import { createApp } from './app';
import { buildDependencies } from './adapters.factory';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

async function main() {
  const deps = await buildDependencies();
  const app = createApp(deps);

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[api] listening on port ${PORT}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[api] fatal startup error:', err);
  process.exit(1);
});
