import { Pool } from 'pg';
import { PricingRecommendation } from '@xlnc/shared';

export interface StoredPricingRecommendation extends PricingRecommendation {
  id: number;
  computedAt: string;
}

export class PricingHistoryRepository {
  constructor(private readonly pool: Pool) {}

  async record(rec: PricingRecommendation): Promise<void> {
    await this.pool.query(
      `INSERT INTO pricing_recommendations
         (property_id, target_date, current_price, recommended_price, change_percent, reason, pricing_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        rec.propertyId,
        rec.date,
        rec.currentPrice,
        rec.recommendedPrice,
        rec.changePercent,
        rec.reason,
        rec.source,
      ],
    );
  }

  async recordMany(recs: PricingRecommendation[]): Promise<number> {
    for (const rec of recs) {
      await this.record(rec);
    }
    return recs.length;
  }

  /** Full audit history — every computation ever recorded, newest first. */
  async findHistoryForProperty(
    propertyId: string,
    from: string,
    to: string,
  ): Promise<StoredPricingRecommendation[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM pricing_recommendations
       WHERE property_id = $1 AND target_date BETWEEN $2 AND $3
       ORDER BY target_date ASC, computed_at DESC`,
      [propertyId, from, to],
    );
    return rows.map(mapRow);
  }

  /** Latest recommendation per date, via the latest_pricing_recommendations view. */
  async findLatestForProperty(
    propertyId: string,
    from: string,
    to: string,
  ): Promise<StoredPricingRecommendation[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM latest_pricing_recommendations
       WHERE property_id = $1 AND target_date BETWEEN $2 AND $3
       ORDER BY target_date ASC`,
      [propertyId, from, to],
    );
    return rows.map(mapRow);
  }
}

function mapRow(row: Record<string, unknown>): StoredPricingRecommendation {
  return {
    id: Number(row.id),
    propertyId: row.property_id as string,
    date: toIsoDate(row.target_date),
    currentPrice: Number(row.current_price),
    recommendedPrice: Number(row.recommended_price),
    changePercent: Number(row.change_percent),
    reason: row.reason as string,
    source: row.pricing_source as 'live' | 'mock',
    computedAt: (row.computed_at as Date).toISOString(),
  };
}

function toIsoDate(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}
