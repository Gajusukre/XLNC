export interface MarketPricingSignal {
  propertyId: string;
  date: string; // ISO date
  demandScore: number; // 0-100, higher = more demand
  competitorMedianPrice: number;
  seasonalityIndex: number; // 1.0 = baseline, >1 = high season
  leadTimeDays: number; // days between "today" and this date
  recommendedRate: number;
}

export interface PricingRecommendation {
  propertyId: string;
  date: string;
  currentPrice: number;
  recommendedPrice: number;
  changePercent: number;
  reason: string;
  source: 'live' | 'mock';
}
