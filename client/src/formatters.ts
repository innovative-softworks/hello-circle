import { dateLabel, euro } from "./euro";

// Centralized display formatters (cards/listings consistency pass) — before
// this, distance/participant-count/price/relative-date phrasing was each
// reimplemented slightly differently per card component (different
// rounding, different "going"/"joined"/"attendees" wording, different
// "Free"/"€0" handling). One function per concern here; domain cards call
// these instead of formatting inline.

/** "Today", "Tomorrow", a day-of-week abbreviation for the next 6 days, or
 * dateLabel's "Sat 29 Aug" beyond that — extracted from Games.tsx's own
 * relativeWhenLabel, which every card-level date should match. */
export function formatRelativeDay(iso: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${iso}T00:00:00`);
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays > 1 && diffDays < 7) return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  return dateLabel(iso);
}

/** 24-hour "HH:MM" (already the app's stored format) to a 12-hour clock —
 * e.g. "19:30" -> "7:30 PM". */
export function formatTime12h(time: string): string {
  const [hStr, m] = time.split(":");
  const h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

/** The card-level "Today · 19:30" / "Sat 29 Aug · 09:00" pattern.
 * `hour12` matches the "Today · 7:30 PM" pill-badge convention used on a
 * couple of hero overlays — plain 24-hour everywhere else, which is why
 * it's opt-in rather than the default. */
export function formatDateTime(iso: string, time: string, hour12 = false): string {
  return `${formatRelativeDay(iso)} · ${hour12 ? formatTime12h(time) : time}`;
}

/** "1.8 km" under 10km (one decimal — the resolution that actually matters
 * at walking/cycling distance), "12 km" at 10 and above (a decimal stops
 * being meaningful), "450 m" under 1km. Was previously `.toFixed(1)`, plain
 * template interpolation, and `Math.round()` all in independent use across
 * different cards with no agreed rounding rule. */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/** "Dublin 8 · 1.8 km" / "Dublin 8" when no distance is known — never a
 * full street address on a card (see CLAUDE.md-adjacent design-system
 * doc's §Location format). */
export function formatLocation(area: string | null | undefined, distanceKm?: number | null): string {
  const parts = [area?.trim()].filter((p): p is string => !!p);
  if (distanceKm != null) parts.push(formatDistance(distanceKm));
  return parts.join(" · ") || "—";
}

/** "Free", "€8", "€8 each" (per-person pricing), "From €20" (a range's
 * floor) — never "€0.00"/"FREE ENTRY"/"0 EUR". `cents` of 0/null/undefined
 * all mean free. */
export function formatPrice(cents: number | null | undefined, opts?: { each?: boolean; from?: boolean }): string {
  if (!cents) return "Free";
  const label = euro(cents / 100);
  if (opts?.from) return `From ${label}`;
  if (opts?.each) return `${label} each`;
  return label;
}

/** "8 going" / "8/10 joined" / "3 of 4 joined" — one term per entity type
 * (a Game/Plan says "joined", a Circle says "going" — matching each
 * domain's existing established usage rather than forcing one word
 * everywhere), capacity shown only when known. */
export function formatParticipantCount(count: number, capacity?: number | null, term: "going" | "joined" = "going"): string {
  if (capacity != null) return `${count}/${capacity} ${term}`;
  return `${count} ${term}`;
}

/** The card-level availability phrase paired with AvailabilityBadge's
 * color state (ui.tsx) — same wording rule (≤2 left reads urgent) so a
 * card's text and its badge color can never disagree. Pass `needed` for a
 * pending_participants-style game instead of a plain spotsLeft count. */
export function formatAvailability(spotsLeft: number, needed?: number): string {
  if (needed != null && needed > 0) return needed === 1 ? "1 more to confirm" : `${needed} more to confirm`;
  if (spotsLeft <= 0) return "Full";
  if (spotsLeft === 1) return "1 spot left";
  if (spotsLeft <= 2) return `${spotsLeft} spots left`;
  return `${spotsLeft} spots available`;
}
