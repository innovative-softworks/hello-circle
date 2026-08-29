import type { Game } from "./types";

// Shared game participation-state + CTA copy logic (design-system unification
// pass) — was independently reimplemented in Games.tsx (tier-based: "I'm in"
// for urgent/needs-people, "Join" for plain-available, for visual variety
// across the results grid) and GameJoinCard.tsx (price-based: "I'm in" only
// for free games, "Join · €X" for paid ones). Because GameJoinCard drives a
// game's own detail page, the same game could show "Join" in the list and
// "I'm in" on its own detail page — the same action reading as two different
// verbs depending on which page you're on. One shared rule now backs both;
// Games.tsx's urgency-tier variety (the reason "I'm in" exists at all,
// instead of always "Join") is preserved, just no longer duplicated.

export type GameAvailability = "needs" | "available" | "full";

/** One participation state per game — drives badge, CTA copy/tone, and the
 * Games.tsx Availability filter. */
export function gameState(game: Game): GameAvailability {
  if (game.spotsLeft === 0) return "full";
  if (game.status === "pending_participants" || game.spotsLeft <= 2) return "needs";
  return "available";
}

/** CTA label for a joinable (not full, not already-joined) game — "I'm in"
 * when urgent/needs-people, "Join" otherwise, with a price suffix appended
 * either way. Callers handle the full/joined/waitlisted states themselves,
 * since that copy ("Join waitlist" / "View plan") isn't state-derived. */
export function primaryCtaLabel(game: Game): string {
  const base = gameState(game) === "needs" ? "I'm in" : "Join";
  return game.priceCents ? `${base} · €${(game.priceCents / 100).toFixed(2)}` : base;
}
