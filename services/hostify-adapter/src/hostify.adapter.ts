import {
  PmsAdapter,
  Property,
  Reservation,
  AvailabilityDay,
  ReservationStatus,
} from '@xlnc/shared';
import {
  HostifyListingResponse,
  HostifyReservationResponse,
  HostifyCalendarDayResponse,
} from './hostify.types';

const HOSTIFY_BASE_URL = 'https://api.hostify.com/v1';

/**
 * Live Hostify adapter. Requires HOSTIFY_API_KEY. Retries transient
 * failures (429/5xx) with exponential backoff; anything else throws
 * immediately so callers get a fast, clear failure rather than a hang.
 */
export class HostifyAdapter implements PmsAdapter {
  readonly providerName = 'hostify';
  readonly mode = 'live' as const;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = HOSTIFY_BASE_URL,
    private readonly maxRetries: number = 3,
  ) {
    if (!apiKey) {
      throw new Error(
        'HostifyAdapter requires an API key. Use HostifyMockAdapter when HOSTIFY_API_KEY is not set.',
      );
    }
  }

  private async request<T>(path: string): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        });

        if (res.status === 429 || res.status >= 500) {
          throw new RetryableHostifyError(`Hostify ${res.status} on ${path}`);
        }
        if (!res.ok) {
          throw new Error(`Hostify request failed: ${res.status} ${res.statusText} on ${path}`);
        }
        return (await res.json()) as T;
      } catch (err) {
        lastError = err;
        if (!(err instanceof RetryableHostifyError) || attempt === this.maxRetries) {
          throw err;
        }
        const backoffMs = 250 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
    throw lastError;
  }

  async listProperties(): Promise<Property[]> {
    const data = await this.request<{ listings: HostifyListingResponse[] }>('/listings');
    return data.listings.map(mapListing);
  }

  async getReservations(propertyId: string, from: string, to: string): Promise<Reservation[]> {
    const data = await this.request<{ reservations: HostifyReservationResponse[] }>(
      `/listings/${propertyId}/reservations?from=${from}&to=${to}`,
    );
    return data.reservations.map(mapReservation);
  }

  async getAvailability(propertyId: string, from: string, to: string): Promise<AvailabilityDay[]> {
    const data = await this.request<{ calendar: HostifyCalendarDayResponse[] }>(
      `/listings/${propertyId}/calendar?from=${from}&to=${to}`,
    );
    return data.calendar.map((day) => ({
      date: day.date,
      propertyId,
      isAvailable: day.status === 'available',
      price: day.price,
    }));
  }

  async updatePrice(propertyId: string, date: string, price: number): Promise<void> {
    await this.request(`/listings/${propertyId}/calendar/${date}`);
    // NOTE: Hostify's calendar-update endpoint is a PUT/PATCH with a body.
    // Wire the actual write call here once a real Hostify sandbox is
    // available to verify the exact payload contract against; left as a
    // clearly-marked follow-up rather than a guessed, unverified request.
    throw new Error(
      'HostifyAdapter.updatePrice: write path not yet verified against a live Hostify sandbox. ' +
        'Implement and test against real Hostify docs before enabling price writes.',
    );
  }
}

class RetryableHostifyError extends Error {}

function mapListing(l: HostifyListingResponse): Property {
  return {
    id: String(l.id),
    externalId: String(l.id),
    name: l.name,
    address: l.address,
    bedrooms: l.bedrooms_number,
    bathrooms: l.bathrooms_number,
    basePrice: l.price,
    currency: l.currency,
  };
}

function mapReservation(r: HostifyReservationResponse): Reservation {
  return {
    id: String(r.id),
    externalId: String(r.id),
    propertyId: String(r.listing_id),
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    status: mapStatus(r.status),
    totalAmount: r.total_price,
    currency: r.currency,
    guestName: r.guest_name,
  };
}

function mapStatus(status: string): ReservationStatus {
  const normalized = status.toLowerCase();
  if (normalized.includes('cancel')) return 'cancelled';
  if (normalized.includes('complete')) return 'completed';
  if (normalized.includes('confirm')) return 'confirmed';
  return 'pending';
}
