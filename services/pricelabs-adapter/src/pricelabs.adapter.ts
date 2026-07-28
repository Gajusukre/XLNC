import { PricingIntelligenceAdapter, MarketPricingSignal } from '@xlnc/shared';

const PRICELABS_BASE_URL = 'https://api.pricelabs.co/v1';

/**
 * Live PriceLabs adapter, built against PriceLabs' public API documentation
 * (market/neighborhood data, recommended prices, and listing-level pricing
 * endpoints). NOT YET VERIFIED against a real PriceLabs account/response —
 * no PriceLabs credentials exist for this project yet. Endpoint paths and
 * field names below should be re-checked against a real API key + Postman
 * collection before this leaves mock mode; treat this as a documented,
 * ready-to-verify implementation rather than a guessed one shipped as final.
 */
export class PriceLabsAdapter implements PricingIntelligenceAdapter {
  readonly providerName = 'pricelabs';
  readonly mode = 'live' as const;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = PRICELABS_BASE_URL,
  ) {
    if (!apiKey) {
      throw new Error(
        'PriceLabsAdapter requires an API key. Use PriceLabsMockAdapter when PRICELABS_API_KEY is not set.',
      );
    }
  }

  async getMarketSignal(propertyId: string, date: string): Promise<MarketPricingSignal> {
    const res = await fetch(
      `${this.baseUrl}/listings/${propertyId}/pricing?date=${date}`,
      { headers: { 'X-API-Key': this.apiKey } },
    );
    if (!res.ok) {
      throw new Error(`PriceLabs request failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as {
      demand_score: number;
      market_price: number;
      seasonality: number;
      lead_time_days: number;
      recommended_price: number;
    };
    return {
      propertyId,
      date,
      demandScore: data.demand_score,
      competitorMedianPrice: data.market_price,
      seasonalityIndex: data.seasonality,
      leadTimeDays: data.lead_time_days,
      recommendedRate: data.recommended_price,
    };
  }

  async getMarketSignalsForRange(
    propertyId: string,
    from: string,
    to: string,
  ): Promise<MarketPricingSignal[]> {
    // PriceLabs' documented range endpoint batches this server-side; until
    // verified, fall back to sequential single-date calls so behavior stays
    // correct even if the batch endpoint shape turns out to differ.
    const dates = enumerateDays(from, to);
    return Promise.all(dates.map((date) => this.getMarketSignal(propertyId, date)));
  }
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
