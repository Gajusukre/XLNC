import { MarketPricingSignal } from '../types/pricing.types';

/**
 * Every market-pricing-intelligence integration (PriceLabs today, others
 * later) must implement this interface. This is the seam that lets the
 * pricing engine run against a mock today and PriceLabs tomorrow with zero
 * changes to the pricing engine itself.
 */
export interface PricingIntelligenceAdapter {
  readonly providerName: string;
  readonly mode: 'live' | 'mock';

  getMarketSignal(propertyId: string, date: string): Promise<MarketPricingSignal>;
  getMarketSignalsForRange(
    propertyId: string,
    from: string,
    to: string,
  ): Promise<MarketPricingSignal[]>;
}
