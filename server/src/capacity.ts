// Shared "spots left" arithmetic — games.ts, circles.ts, and registrations.ts
// each hand-rolled their own Math.max(0, capacity - occupied) / occupied >=
// capacity checks against three different "occupied" definitions (see each
// call site's own COUNT query). This does NOT unify those tables or their
// occupied-row definitions — that's the deliberately-deferred 5/6-table
// participation-model migration (see CLAUDE.md). It only centralizes the
// arithmetic, so a future capacity-rule change (e.g. an overbooking buffer)
// only needs to happen here. Pure function, no DB access, so it's cheap to
// unit test directly.

export interface CapacityResult {
  capacity: number | null;
  occupied: number;
  /** null capacity means unlimited — no cap, never full. */
  spotsLeft: number | null;
  isFull: boolean;
}

export function computeCapacity(capacity: number | null, occupied: number): CapacityResult {
  if (capacity === null) return { capacity: null, occupied, spotsLeft: null, isFull: false };
  return { capacity, occupied, spotsLeft: Math.max(0, capacity - occupied), isFull: occupied >= capacity };
}
