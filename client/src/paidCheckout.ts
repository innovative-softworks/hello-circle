import { useEffect, useState } from "react";

// Commercial release gate, client side — GET /api/config `paidCheckoutOpen`.
// Display only: it lets paid flows say "free bookings only" before the form
// is filled in. The server refuses a paid checkout whatever this says.
// A failed config fetch shows the paid flow as usual (the server still
// decides), so a network blip never hides free or cash bookings.
//
// The same config call also carries `openBooking` (the Make It Happen
// switch), read through openBookingOpen() below — one fetch, shared.

interface AppConfig {
  paidCheckoutOpen?: boolean;
  openBooking?: boolean;
  /** Circle Experience 2.0 switches (circleFeatures.ts). */
  circleFeatures?: Record<string, boolean>;
  /** Experience 3.0 switches. */
  experienceFeatures?: Record<string, boolean>;
}

let cached: Promise<AppConfig | null> | null = null;

export function appConfig(): Promise<AppConfig | null> {
  if (!cached) {
    cached = fetch("/api/config")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return cached;
}

export function paidCheckoutOpen(): Promise<boolean> {
  return appConfig().then((d) => d?.paidCheckoutOpen !== false);
}

/** null while unknown; then whether paid (card) checkout is open. */
export function usePaidCheckoutOpen(): boolean | null {
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    paidCheckoutOpen().then((v) => live && setOpen(v));
    return () => {
      live = false;
    };
  }, []);
  return open;
}

export const PAID_CLOSED_MESSAGE = "Paid bookings aren't open yet — only free bookings are available for now.";

/** Shown next to a price field while paid checkout is closed. */
export const PAID_CLOSED_PRICE_NOTICE = "Paid bookings aren't open yet. If you set a price, people will see this listing but won't be able to book it until paid bookings open. Leave the price empty to keep it free.";

/**
 * Make It Happen (Open Booking) switch. true/false from the server; null when
 * the config call failed. An older server that doesn't send the field has no
 * switch at all, so that counts as open.
 */
export function openBookingOpen(): Promise<boolean | null> {
  return appConfig().then((d) => (d === null ? null : d.openBooking !== false));
}

/** undefined while loading; then true/false, or null if the config call failed. */
export function useOpenBookingOpen(): boolean | null | undefined {
  const [open, setOpen] = useState<boolean | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    openBookingOpen().then((v) => live && setOpen(v));
    return () => {
      live = false;
    };
  }, []);
  return open;
}

/** Test hook: forget the cached answer. */
export function resetPaidCheckoutCache(): void {
  cached = null;
}
