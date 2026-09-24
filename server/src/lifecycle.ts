// Universal Publishing, Lifecycle & Availability System — Phase B.
//
// The single shared server-side policy this whole feature is built around
// (brief §66: "Do not duplicate logic across Home/Explore/Search/detail/
// Host profile/Provider profile/sitemap/sharing/OG/booking endpoint —
// create shared server-side helpers/policies... one consistent source of
// truth"). Every entity-specific route (games/programs/experiences/centres/
// clubs/circles) calls into these functions rather than re-deriving the
// same "can this be seen/booked/indexed right now" logic inline.
//
// Three dimensions, kept deliberately separate per the brief's own §2-3
// (never merge into one combinatorial enum like COMING_SOON_PRIVATE):
//   - Lifecycle: the creator's own explicit publishing state.
//   - Availability: mostly DERIVED (capacity vs confirmed), not stored.
//   - Visibility/privacy: each entity's own EXISTING field (circles.join_mode,
//     games.visibility, centre/club/experience .status's approval gate) —
//     this module never reimplements or replaces those. See §20: privacy
//     must never be derived from lifecycle.

/** Not every entity supports every value — see LIFECYCLE_BY_ENTITY below for
 * which subset each of the six entity types actually uses. */
export type Lifecycle = "draft" | "coming_soon" | "active" | "paused" | "completed" | "cancelled" | "archived";

export type Availability = "not_open" | "open" | "limited" | "full" | "waitlist" | "closed";

export type LifecycleEntityKind = "activity" | "program" | "experience" | "centre" | "club" | "circle";

/** The exact allowed lifecycle values per entity kind (brief §76's matrix,
 * "not every entity must support every state"). A transition or a stored
 * value outside this set is always invalid for that kind. */
export const LIFECYCLE_BY_ENTITY: Record<LifecycleEntityKind, readonly Lifecycle[]> = {
  activity: ["draft", "coming_soon", "active", "paused", "completed", "cancelled", "archived"],
  program: ["draft", "coming_soon", "active", "paused", "completed", "archived"],
  experience: ["draft", "coming_soon", "active", "paused", "cancelled", "archived"],
  centre: ["draft", "coming_soon", "active", "paused", "archived"],
  club: ["draft", "coming_soon", "active", "paused", "archived"],
  circle: ["draft", "coming_soon", "active", "paused", "archived"],
};

/** §28 — explicit transition rules, not scattered conditions. Keys are
 * `${from}` states, values are the `to` states that transition may legally
 * reach. Absence of a `from` key (e.g. `completed`, `cancelled`, `archived`
 * for most entities) means "no forward transitions" — those are terminal
 * unless a specific entity explicitly widens it (none do today). Every
 * entity's real transition set is the intersection of this table and its
 * own LIFECYCLE_BY_ENTITY allow-list, so e.g. `circle` never sees
 * `completed`/`cancelled` as a `to` even though `active → completed` isn't
 * listed as invalid in the base map for kinds that do use `completed`. */
const VALID_TRANSITIONS: Record<Lifecycle, readonly Lifecycle[]> = {
  draft: ["coming_soon", "active", "archived"],
  coming_soon: ["active", "cancelled", "draft", "archived"],
  active: ["paused", "completed", "cancelled", "archived"],
  paused: ["active", "cancelled", "archived"],
  completed: ["archived"],
  cancelled: ["archived"],
  archived: [],
};

export interface TransitionResult {
  ok: boolean;
  reason?: string;
}

/** Central transition validator (§28). Callers pass the entity kind so an
 * out-of-range value (e.g. `completed` on a Circle, which never has that
 * state) is rejected even if the base VALID_TRANSITIONS graph would
 * otherwise allow it for some other kind. */
export function validateLifecycleTransition(kind: LifecycleEntityKind, from: Lifecycle, to: Lifecycle): TransitionResult {
  const allowed = LIFECYCLE_BY_ENTITY[kind];
  if (!allowed.includes(to)) return { ok: false, reason: `"${to}" is not a valid state for ${kind}` };
  if (from === to) return { ok: true };
  if (!VALID_TRANSITIONS[from]?.includes(to)) return { ok: false, reason: `Cannot move from "${from}" to "${to}"` };
  return { ok: true };
}

/** Optional scheduling fields an entity row may carry (brief §22-24, §26).
 * All optional — an entity that never uses scheduled publishing just omits
 * them, and effective state then equals stored state. Dates are ISO
 * datetime strings (already-normalized UTC instants — see irelandTime.ts;
 * this module does no timezone math of its own, callers convert Ireland
 * wall-clock input to UTC before it ever reaches here, same discipline as
 * every other scheduled-instant column in this codebase). */
export interface LifecycleSchedule {
  lifecycle: Lifecycle;
  publishAt?: string | null;
  bookingOpenAt?: string | null;
  bookingCloseAt?: string | null;
}

/** §26 — "prefer effective state derived at read/action time... this avoids
 * scheduler reliability problems." The stored `lifecycle` is always the
 * host's own last explicit choice (so §27 "manual override" — Manage always
 * shows what the host actually set, never a value silently mutated by a
 * background job). This function computes what a VIEWER effectively sees
 * right now, given that stored choice plus any schedule, without ever
 * writing back to the row. A `draft` never auto-advances (draft has no
 * publish-at concept of its own in this design — moving off draft is always
 * a deliberate host action, matching §21's three-way "Save as draft /
 * Coming soon / Publish now" choice at creation time, not a fourth
 * "scheduled draft" mode); `coming_soon`/`active` do. */
export function getEffectiveLifecycle(schedule: LifecycleSchedule, now: Date = new Date()): Lifecycle {
  const { lifecycle, publishAt, bookingOpenAt, bookingCloseAt } = schedule;
  if (lifecycle === "coming_soon" && bookingOpenAt && new Date(bookingOpenAt) <= now) return "active";
  if (lifecycle === "active" && bookingCloseAt && new Date(bookingCloseAt) <= now) return "paused";
  if (publishAt && new Date(publishAt) > now) {
    // Scheduled-but-not-yet-live: behaves as draft to every viewer until
    // publishAt, regardless of what "real" state it's scheduled to become.
    return "draft";
  }
  return lifecycle;
}

/** §41-46 — can this entity appear in Explore/Search/Home/Host profile/
 * Provider profile/Map at all? Visibility/privacy (join_mode, .visibility,
 * approval status) is a SEPARATE, prior gate every caller must also apply —
 * this function only answers the lifecycle half of the question. */
export function canDiscover(effectiveLifecycle: Lifecycle): boolean {
  return effectiveLifecycle === "coming_soon" || effectiveLifecycle === "active" || effectiveLifecycle === "paused";
}

/** Same three values as canDiscover, as a ready-to-inline SQL IN-list
 * literal — for the (common) case where an entity's stored `lifecycle`
 * column never itself holds 'cancelled'/'completed' (those come from an
 * existing status/date field instead, per each entity's own effective-
 * lifecycle wrapper), so a plain `lifecycle IN (...)` WHERE clause is exact
 * rather than an approximation needing a per-row JS re-filter. Kept as one
 * shared constant so every entity's discovery query agrees, rather than
 * each route hand-typing the same three strings. */
export const DISCOVERABLE_LIFECYCLES_SQL = "('coming_soon', 'active', 'paused')";

/** §54-60 — is this entity's public detail page indexable right now? Same
 * base set as canDiscover, since an indexable-but-undiscoverable page (or
 * vice versa) isn't a real product state this brief asks for — entity-
 * specific SEO code may still layer its own historical-page exception on
 * top for `completed`/`cancelled` (see ogMeta.ts call sites; §58-59
 * explicitly allow keeping a historical page indexable case-by-case, which
 * is a per-entity editorial decision, not a universal lifecycle rule). */
export function canIndex(effectiveLifecycle: Lifecycle): boolean {
  return canDiscover(effectiveLifecycle);
}

/** §9-13, §48-53 — may a NEW booking/join/enrolment/registration be
 * initiated right now, purely from the lifecycle+availability angle?
 * Visibility/privacy and capacity-vs-waitlist UX are still the caller's own
 * concern; this is the one universal gate every transaction-initiating
 * endpoint must apply before doing anything else (§48: "Do not merely
 * disable buttons... every booking/join/enrolment endpoint must validate
 * effective availability server-side"). */
export function canBook(effectiveLifecycle: Lifecycle, availability: Availability): boolean {
  if (effectiveLifecycle !== "active") return false;
  return availability === "open" || availability === "limited" || availability === "full" || availability === "waitlist";
  // "full" still returns true here deliberately — a full-but-active listing
  // can still accept a *waitlist* join, which is itself a real transaction
  // (an entry in the existing waitlist_entries table). A caller rejecting a
  // plain "book a confirmed spot" attempt on a full listing does so by
  // checking availability === "full" itself, same as today's capacity
  // recount — this function only answers "is any transaction legal at all."
}

/** §10 (Paused doesn't affect existing participants) / §50-51 (don't store
 * "full" if it's derivable) — capacity/confirmed-count → Availability.
 * `waitlistEnabled` mirrors whatever real waitlist mechanism the entity
 * already has (games/registrations both have one; reuse those, this
 * function never creates a second one per §51). A paused/cancelled/
 * completed/draft/coming_soon lifecycle always reports "not_open"/"closed"
 * regardless of capacity numbers — availability only means something for a
 * genuinely active listing. */
export function getEffectiveAvailability(effectiveLifecycle: Lifecycle, capacity: number | null, confirmed: number | null, waitlistEnabled: boolean, almostFullAt = 2): Availability {
  if (effectiveLifecycle === "draft" || effectiveLifecycle === "coming_soon") return "not_open";
  if (effectiveLifecycle === "paused" || effectiveLifecycle === "cancelled" || effectiveLifecycle === "completed" || effectiveLifecycle === "archived") return "closed";
  if (capacity == null || confirmed == null) return "open";
  const spotsLeft = capacity - confirmed;
  if (spotsLeft <= 0) return waitlistEnabled ? "waitlist" : "full";
  if (spotsLeft <= almostFullAt) return "limited";
  return "open";
}

/** §32-35 client-facing label — kept here (not client-only) so a server-
 * rendered surface (OG meta description, a transactional email) can use
 * the identical wording without duplicating the mapping. Client components
 * needing a *component* (badge/color) still own their own presentation —
 * see client/src/components/ui.tsx's StatusBadge, extended (not
 * duplicated) with these same values per §33's "one shared status/badge
 * system" instruction. */
export function getPublicLifecycleLabel(effectiveLifecycle: Lifecycle, availability: Availability): string {
  switch (effectiveLifecycle) {
    case "draft":
      return "Draft";
    case "coming_soon":
      return "Coming soon";
    case "paused":
      return "Bookings paused";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "archived":
      return "Archived";
    case "active":
      switch (availability) {
        case "full":
          return "Full";
        case "waitlist":
          return "Waitlist";
        case "limited":
          return "Almost full";
        default:
          return "Open";
      }
  }
}
