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

// Ownership is proven by the X-Client-Id header the shared request() helper
// already attaches to every call — no email needed for a booking made from
// this device (server/src/routes/bookings.ts's POST /:ref/cancel).
export function cancelBooking(ref: string): Promise<{ ok: boolean }> {
  return request(`/bookings/${encodeURIComponent(ref)}/cancel`, { method: 'POST', body: JSON.stringify({}) });
}

// Same X-Client-Id ownership as cancelBooking — the server re-validates
// opening hours/overlaps/the booking window against the new slot itself
// (server/src/routes/bookings.ts's POST /:ref/reschedule), so this client
// doesn't need to duplicate that logic — a real conflict just comes back
// as a normal ApiError message.
export function rescheduleBooking(ref: string, date: string, time: string): Promise<{ ok: boolean }> {
  return request(`/bookings/${encodeURIComponent(ref)}/reschedule`, { method: 'POST', body: JSON.stringify({ date, time }) });
}
