/**
 * Raw Hostify API response shapes. These must never leak outside this
 * package — the adapter maps them onto @xlnc/shared canonical types.
 * Shape based on Hostify's public API documentation (v2 listings/reservations).
 */

export interface HostifyListingResponse {
  id: number;
  name: string;
  address: string;
  bedrooms_number: number;
  bathrooms_number: number;
  price: number;
  currency: string;
}

export interface HostifyReservationResponse {
  id: number;
  listing_id: number;
  checkIn: string;
  checkOut: string;
  status: string;
  total_price: number;
  currency: string;
  guest_name?: string;
}

export interface HostifyCalendarDayResponse {
  date: string;
  listing_id: number;
  status: 'available' | 'booked' | 'blocked';
  price: number;
}
