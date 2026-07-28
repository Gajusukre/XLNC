import { PricingIntelligenceAdapter, MarketPricingSignal } from '@xlnc/shared';

/**
 * Deterministic mock market-pricing signal generator. Uses a seeded
 * pseudo-random function keyed on propertyId+date so the same inputs
 * always produce the same outputs (reproducible tests/demos), while still
 * varying signal-to-signal so the pricing engine has something realistic
 * to react to.
 */
export class PriceLabsMockAdapter implements PricingIntelligenceAdapter {
  readonly providerName = 'pricelabs';
  readonly mode = 'mock' as const;

  async getMarketSignal(propertyId: string, date: string): Promise<MarketPricingSignal> {
    const seed = hashSeed(`${propertyId}:${date}`);
    const demandScore = 40 + (seed % 50); // 40-89
    const seasonalityIndex = 0.9 + ((seed % 30) / 100); // 0.9-1.19
    const leadTimeDays = daysBetween(new Date().toISOString().slice(0, 10), date);
    const basePrice = 200 + (seed % 150);
    const competitorMedianPrice = Math.round(basePrice * seasonalityIndex);
    const recommendedRate = Math.round(
      competitorMedianPrice * (1 + (demandScore - 65) / 200),
    );

    return {
      propertyId,
      date,
      demandScore,
      competitorMedianPrice,
      seasonalityIndex,
      leadTimeDays,
      recommendedRate,
    };
  }

  async getMarketSignalsForRange(
    propertyId: string,
    from: string,
    to: string,
  ): Promise<MarketPricingSignal[]> {
    const dates = enumerateDays(from, to);
    return Promise.all(dates.map((date) => this.getMarketSignal(propertyId, date)));
  }
}

function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function daysBetween(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

function enumerateDays(from: string, to: string): string[] {
  const start = new Date(from);
  const end = new Date(to);
  const days: string[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d).toISOString().slice(0, 10));
  }
  return days;
}
