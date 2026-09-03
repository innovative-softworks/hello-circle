import { request } from './client';

export interface CreateBookingInput {
  centreId: string;
  roomId: string;
  date: string;
  time: string;
  duration: number;
  eventType: string;
  guests: number;
  name: string;
  email: string;
  phone: string;
  notes?: string;
  couponCode?: string;
}

export function createBookingCheckout(input: CreateBookingInput): Promise<{ ref: string; url?: string; totalEuro: number }> {
  return request('/bookings/checkout', { method: 'POST', body: JSON.stringify(input) });
}

export function fetchBookingStatus(ref: string): Promise<{ ref: string; paymentStatus: string; totalCents: number }> {
  return request(`/bookings/status/${encodeURIComponent(ref)}`);
}

export function fetchAvailability(
  centreId: string,
  roomId: string,
  date: string,
  duration = 1
): Promise<{ slots: string[]; bookedTimes: string[]; closed: boolean }> {
  return request(`/availability?centreId=${encodeURIComponent(centreId)}&roomId=${encodeURIComponent(roomId)}&date=${encodeURIComponent(date)}&duration=${duration}`);
}

export function fetchAvailabilityRange(centreId: string, roomId: string, from: string, days = 60): Promise<{ closedDates: string[] }> {
  return request(`/availability/range?centreId=${encodeURIComponent(centreId)}&roomId=${encodeURIComponent(roomId)}&from=${encodeURIComponent(from)}&days=${days}`);
}
