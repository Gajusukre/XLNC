import { Pool } from 'pg';
import { Property } from '@xlnc/shared';

export interface StoredProperty extends Property {
  sourceProvider: string;
  createdAt: string;
  updatedAt: string;
}

export class PropertyRepository {
  constructor(private readonly pool: Pool) {}

  async upsert(property: Property, sourceProvider: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO properties (id, external_id, name, address, bedrooms, bathrooms, base_price, currency, source_provider)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         external_id = EXCLUDED.external_id,
         name = EXCLUDED.name,
         address = EXCLUDED.address,
         bedrooms = EXCLUDED.bedrooms,
         bathrooms = EXCLUDED.bathrooms,
         base_price = EXCLUDED.base_price,
         currency = EXCLUDED.currency,
         source_provider = EXCLUDED.source_provider`,
      [
        property.id,
        property.externalId,
        property.name,
        property.address,
        property.bedrooms,
        property.bathrooms,
        property.basePrice,
        property.currency,
        sourceProvider,
      ],
    );
  }

  async upsertMany(properties: Property[], sourceProvider: string): Promise<number> {
    for (const property of properties) {
      await this.upsert(property, sourceProvider);
    }
    return properties.length;
  }

  async findAll(): Promise<StoredProperty[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM properties ORDER BY name ASC',
    );
    return rows.map(mapRow);
  }

  async findById(id: string): Promise<StoredProperty | null> {
    const { rows } = await this.pool.query('SELECT * FROM properties WHERE id = $1', [id]);
    return rows[0] ? mapRow(rows[0]) : null;
  }
}

function mapRow(row: Record<string, unknown>): StoredProperty {
  return {
    id: row.id as string,
    externalId: row.external_id as string,
    name: row.name as string,
    address: row.address as string,
    bedrooms: row.bedrooms as number,
    bathrooms: row.bathrooms as number,
    basePrice: Number(row.base_price),
    currency: row.currency as string,
    sourceProvider: row.source_provider as string,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}
