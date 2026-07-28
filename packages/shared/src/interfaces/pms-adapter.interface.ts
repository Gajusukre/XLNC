import { Property, Reservation, AvailabilityDay } from '../types/property.types';

/**
 * Every property-management-system integration (Hostify today, others later)
 * must implement this interface. Nothing outside the adapter's own package
 * should import provider-specific SDKs or hit provider-specific endpoints —
 * that keeps the rest of the platform swappable and testable.
 */
export interface PmsAdapter {
  readonly providerName: string;
  readonly mode: 'live' | 'mock';

  listProperties(): Promise<Property[]>;
  getReservations(propertyId: string, from: string, to: string): Promise<Reservation[]>;
  getAvailability(propertyId: string, from: string, to: string): Promise<AvailabilityDay[]>;
  updatePrice(propertyId: string, date: string, price: number): Promise<void>;
}
