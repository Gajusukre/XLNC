import { describe, it, expect, vi } from 'vitest';
import { PriceLabsMockAdapter } from '../src/pricelabs.mock.adapter';
import { PriceLabsAdapter } from '../src/pricelabs.adapter';
import { createPriceLabsAdapter } from '../src/index';

describe('PriceLabsMockAdapter', () => {
  const adapter = new PriceLabsMockAdapter();

  it('reports its provider name and mode', () => {
    expect(adapter.providerName).toBe('pricelabs');
    expect(adapter.mode).toBe('mock');
  });

  it('returns a deterministic signal for the same property+date', async () => {
    const first = await adapter.getMarketSignal('1001', '2026-08-15');
    const second = await adapter.getMarketSignal('1001', '2026-08-15');
    expect(first).toEqual(second);
  });

  it('returns different signals for different dates', async () => {
    const a = await adapter.getMarketSignal('1001', '2026-08-15');
    const b = await adapter.getMarketSignal('1001', '2026-08-16');
    expect(a).not.toEqual(b);
  });

  it('keeps demand score within the documented 0-100 range', async () => {
    const signal = await adapter.getMarketSignal('1001', '2026-08-15');
    expect(signal.demandScore).toBeGreaterThanOrEqual(0);
    expect(signal.demandScore).toBeLessThanOrEqual(100);
  });

  it('returns one signal per day for a range', async () => {
    const signals = await adapter.getMarketSignalsForRange('1001', '2026-08-01', '2026-08-05');
    expect(signals).toHaveLength(5);
  });
});

describe('PriceLabsAdapter (live)', () => {
  it('throws if constructed without an API key', () => {
    expect(() => new PriceLabsAdapter('')).toThrow(/requires an API key/);
  });
});

describe('createPriceLabsAdapter factory', () => {
  it('falls back to mock mode when PRICELABS_API_KEY is absent', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = createPriceLabsAdapter({} as NodeJS.ProcessEnv);
    expect(adapter.mode).toBe('mock');
  });
});
