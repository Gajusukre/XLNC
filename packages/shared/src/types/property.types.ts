/**
 * Canonical property/reservation types used across all services.
 * Adapters (Hostify, future PMS providers) must map their provider-specific
 * shapes onto these types at the adapter boundary — nothing downstream
 * should ever see a raw Hostify or PriceLabs response shape.
 */

export interface Property {
  id: string;
  externalId: string; // ID in the source system (e.g. Hostify listing id)
  name: string;
  address: string;
  bedrooms: number;
  bathrooms: number;
  basePrice: number;
  currency: string;
}

export interface Reservation {
  id: string;
  externalId: string;
  propertyId: string;
  checkIn: string; // ISO date
  checkOut: string; // ISO date
  status: ReservationStatus;
  totalAmount: number;
  currency: string;
  guestName?: string;
}

export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'completed';

export interface AvailabilityDay {
  date: string; // ISO date
  propertyId: string;
  isAvailable: boolean;
  price: number;
}
