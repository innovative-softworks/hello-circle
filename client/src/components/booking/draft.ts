// Booking kit — a guest's in-progress form, kept in sessionStorage so a
// refresh, a trip to sign in, or "Back" from Stripe's page doesn't lose it.
// Same never-block convention as continuePlanning.ts: storage can be absent
// or throw (private browsing, blocked site data), and the flow carries on.
//
// Callers must not put special-category data (medical notes) in a draft.

import { useCallback, useEffect, useRef, useState } from "react";

const PREFIX = "hc_booking_draft:";
export const DRAFT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function sessionStore(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readDraft<T>(key: string, storage: StorageLike | null = sessionStore(), now = Date.now()): T | null {
  try {
    const raw = storage?.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: number; value: T };
    if (typeof parsed?.savedAt !== "number" || now - parsed.savedAt > DRAFT_MAX_AGE_MS) {
      storage?.removeItem(PREFIX + key);
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

export function writeDraft<T>(key: string, value: T, storage: StorageLike | null = sessionStore(), now = Date.now()): void {
  try {
    storage?.setItem(PREFIX + key, JSON.stringify({ savedAt: now, value }));
  } catch {
    // Storage full or blocked — the form still works without a draft.
  }
}

export function clearDraft(key: string, storage: StorageLike | null = sessionStore()): void {
  try {
    storage?.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}

/** Form state that survives a refresh within the same tab. `restored` is
 * true when the initial value came from a saved draft (so the page can say
 * "We kept your details"). Call `clear()` once the booking is made. */
export function useBookingDraft<T>(key: string, initial: T): { value: T; setValue: (next: T | ((prev: T) => T)) => void; restored: boolean; clear: () => void } {
  const restoredRef = useRef<T | null>(null);
  const [value, setValueState] = useState<T>(() => {
    const saved = readDraft<T>(key);
    restoredRef.current = saved;
    return saved ? { ...initial, ...saved } : initial;
  });
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    if (!cleared) writeDraft(key, value);
  }, [key, value, cleared]);

  const setValue = useCallback((next: T | ((prev: T) => T)) => {
    setCleared(false);
    setValueState(next);
  }, []);
  const clear = useCallback(() => {
    setCleared(true);
    clearDraft(key);
  }, [key]);

  return { value, setValue, restored: restoredRef.current !== null, clear };
}
