import { describe, it, expect } from 'vitest';
import { HostifyMockAdapter } from '@xlnc/hostify-adapter';
import { PriceLabsMockAdapter } from '@xlnc/pricelabs-adapter';
import { PricingEngineService } from '../src/pricing-engine.service';

describe('PricingEngineService', () => {
  const pms = new HostifyMockAdapter();
  const pricingIntel = new PriceLabsMockAdapter();
  const engine = new PricingEngineService(pms, pricingIntel);

  it('produces one recommendation per day in the range', async () => {
    const recs = await engine.recommendForProperty('1001', '2026-08-01', '2026-08-07');
    expect(recs).toHaveLength(7);
  });

  it('tags recommendations with the pricing intel adapter mode', async () => {
    const recs = await engine.recommendForProperty('1001', '2026-08-01', '2026-08-03');
    expect(recs.every((r) => r.source === 'mock')).toBe(true);
  });

  it('never recommends a price change beyond the configured guardrail', async () => {
    const recs = await engine.recommendForProperty('1001', '2026-08-01', '2026-08-14');
    for (const rec of recs) {
      expect(Math.abs(rec.changePercent)).toBeLessThanOrEqual(15.01); // 15% guardrail + rounding slack
    }
  });

  it('never recommends a price below the configured floor', async () => {
    const engineWithHighFloor = new PricingEngineService(pms, pricingIntel, {
      maxChangePercent: 0.15,
      minPrice: 1000, // deliberately absurd floor to prove the clamp works
    });
    const recs = await engineWithHighFloor.recommendForProperty('1001', '2026-08-01', '2026-08-03');
    for (const rec of recs) {
      expect(rec.recommendedPrice).toBeGreaterThanOrEqual(1000);
    }
  });

  it('throws for an unknown property id', async () => {
    await expect(
      engine.recommendForProperty('does-not-exist', '2026-08-01', '2026-08-03'),
    ).rejects.toThrow(/Unknown property/);
  });

  it('includes a human-readable reason for each recommendation', async () => {
    const recs = await engine.recommendForProperty('1001', '2026-08-01', '2026-08-03');
    for (const rec of recs) {
      expect(typeof rec.reason).toBe('string');
      expect(rec.reason.length).toBeGreaterThan(0);
    }
  });
});
