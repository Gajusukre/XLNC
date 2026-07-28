import { PricingIntelligenceAdapter } from '@xlnc/shared';
import { PriceLabsAdapter } from './pricelabs.adapter';
import { PriceLabsMockAdapter } from './pricelabs.mock.adapter';

export { PriceLabsAdapter } from './pricelabs.adapter';
export { PriceLabsMockAdapter } from './pricelabs.mock.adapter';

export function createPriceLabsAdapter(
  env: NodeJS.ProcessEnv = process.env,
): PricingIntelligenceAdapter {
  const apiKey = env.PRICELABS_API_KEY;
  if (apiKey) {
    // eslint-disable-next-line no-console
    console.log('[pricelabs-adapter] LIVE mode: PRICELABS_API_KEY found.');
    return new PriceLabsAdapter(apiKey);
  }
  // eslint-disable-next-line no-console
  console.warn(
    '[pricelabs-adapter] MOCK mode: PRICELABS_API_KEY not set. Using deterministic mock market signals.',
  );
  return new PriceLabsMockAdapter();
}
