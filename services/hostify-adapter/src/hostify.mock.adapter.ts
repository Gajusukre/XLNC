import { PmsAdapter, Property, Reservation, AvailabilityDay } from '@xlnc/shared';

const MOCK_PROPERTIES: Property[] = [
  {
    id: '1001',
    externalId: '1001',
    name: 'Baja Drive Retreat',
    address: '1234 Baja Dr, San Diego, CA',
    bedrooms: 4,
    bathrooms: 2,
    basePrice: 285,
    currency: 'USD',
  },
  {
    id: '1002',
    externalId: '1002',
    name: 'Mission Beach Bungalow',
    address: '55 Ocean Front Walk, San Diego, CA',
    bedrooms: 2,
    bathrooms: 1,
    basePrice: 210,
    currency: 'USD',
  },
];

/**
 * Deterministic mock — same inputs always produce the same outputs, so
 * tests and demos are reproducible. Used automatically whenever
 * HOSTIFY_API_KEY is absent from the environment.
 */
export class HostifyMockAdapter implements PmsAdapter {
  readonly providerName = 'hostify';
  readonly mode = 'mock' as const;

  async listProperties(): Promise<Property[]> {
    return MOCK_PROPERTIES;
  }

  async getReservations(propertyId: string, from: string, to: string): Promise<Reservation[]> {
    const property = MOCK_PROPERTIES.find((p) => p.id === propertyId);
    if (!property) return [];
    return [
      {
        id: `res-${propertyId}-1`,
        externalId: `res-${propertyId}-1`,
        propertyId,
        checkIn: from,
        checkOut: addDays(from, 3),
        status: 'confirmed',
        totalAmount: property.basePrice * 3,
        currency: property.currency,
        guestName: 'Mock Guest',
      },
    ];
  }

  async getAvailability(propertyId: string, from: string, to: string): Promise<AvailabilityDay[]> {
    const property = MOCK_PROPERTIES.find((p) => p.id === propertyId);
    const basePrice = property?.basePrice ?? 200;
    const days = enumerateDays(from, to);
    return days.map((date, i) => ({
      date,
      propertyId,
      isAvailable: i % 3 !== 0, // deterministic pattern: every 3rd day booked
      price: basePrice,
    }));
  }

  async updatePrice(_propertyId: string, _date: string, _price: number): Promise<void> {
    // No-op in mock mode; real writes only happen against the live adapter.
    return;
  }
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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
