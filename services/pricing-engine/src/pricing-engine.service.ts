import {
  PmsAdapter,
  PricingIntelligenceAdapter,
  PricingRecommendation,
} from '@xlnc/shared';

export interface PricingEngineOptions {
  /** Max single-day price change allowed, as a fraction (0.15 = 15%). */
  maxChangePercent: number;
  /** Floor below which recommended prices are never allowed to go. */
  minPrice: number;
}

const DEFAULT_OPTIONS: PricingEngineOptions = {
  maxChangePercent: 0.15,
  minPrice: 50,
};

/**
 * Combines a PmsAdapter (current prices/availability) with a
 * PricingIntelligenceAdapter (market signal) to produce guardrailed
 * pricing recommendations. Never depends on which adapter is live vs
 * mock — that's decided entirely at the adapter factory layer.
 */
export class PricingEngineService {
  constructor(
    private readonly pms: PmsAdapter,
    private readonly pricingIntel: PricingIntelligenceAdapter,
    private readonly options: PricingEngineOptions = DEFAULT_OPTIONS,
  ) {}

  async recommendForProperty(
    propertyId: string,
    from: string,
    to: string,
  ): Promise<PricingRecommendation[]> {
    const [properties, availability, signals] = await Promise.all([
      this.pms.listProperties(),
      this.pms.getAvailability(propertyId, from, to),
      this.pricingIntel.getMarketSignalsForRange(propertyId, from, to),
    ]);

    const property = properties.find((p) => p.id === propertyId);
    if (!property) {
      throw new Error(`Unknown property: ${propertyId}`);
    }

    const availabilityByDate = new Map(availability.map((a) => [a.date, a]));

    return signals.map((signal) => {
      const day = availabilityByDate.get(signal.date);
      const currentPrice = day?.price ?? property.basePrice;
      const guardrailed = this.applyGuardrails(currentPrice, signal.recommendedRate);

      return {
        propertyId,
        date: signal.date,
        currentPrice,
        recommendedPrice: guardrailed,
        changePercent: round2(((guardrailed - currentPrice) / currentPrice) * 100),
        reason: this.buildReason(signal),
        source: this.pricingIntel.mode,
      };
    });
  }

  private applyGuardrails(currentPrice: number, recommended: number): number {
    const maxUp = currentPrice * (1 + this.options.maxChangePercent);
    const maxDown = currentPrice * (1 - this.options.maxChangePercent);
    const clamped = Math.min(Math.max(recommended, maxDown), maxUp);
    return Math.max(Math.round(clamped), this.options.minPrice);
  }

  private buildReason(signal: {
    demandScore: number;
    seasonalityIndex: number;
    leadTimeDays: number;
  }): string {
    const parts: string[] = [];
    if (signal.demandScore >= 70) parts.push('high demand');
    else if (signal.demandScore <= 40) parts.push('low demand');
    if (signal.seasonalityIndex >= 1.1) parts.push('peak season');
    else if (signal.seasonalityIndex <= 0.95) parts.push('off season');
    if (signal.leadTimeDays <= 7) parts.push('short lead time');
    return parts.length > 0 ? parts.join(', ') : 'stable market conditions';
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
