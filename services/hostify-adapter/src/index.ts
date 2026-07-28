import { PmsAdapter } from '@xlnc/shared';
import { HostifyAdapter } from './hostify.adapter';
import { HostifyMockAdapter } from './hostify.mock.adapter';

export { HostifyAdapter } from './hostify.adapter';
export { HostifyMockAdapter } from './hostify.mock.adapter';

/**
 * Factory used by apps/api at startup. Logs clearly which mode is active —
 * per spec, adapters must never silently fall back to mock.
 */
export function createHostifyAdapter(env: NodeJS.ProcessEnv = process.env): PmsAdapter {
  const apiKey = env.HOSTIFY_API_KEY;
  if (apiKey) {
    // eslint-disable-next-line no-console
    console.log('[hostify-adapter] LIVE mode: HOSTIFY_API_KEY found.');
    return new HostifyAdapter(apiKey);
  }
  // eslint-disable-next-line no-console
  console.warn(
    '[hostify-adapter] MOCK mode: HOSTIFY_API_KEY not set. Using deterministic mock data.',
  );
  return new HostifyMockAdapter();
}
