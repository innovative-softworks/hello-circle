import type { Game } from "./types";

/** Builds the query-string HostGamePage.tsx's create-mode `qp()` helper
 * already knows how to consume, carrying over every "what this activity is"
 * field from an existing Game. Extracted from GameDetail.tsx's "Do it
 * again" handler (Host Experience Polish pass) so the same exact param set
 * can also back HostActivitiesTab.tsx's new "Duplicate"/"Host again"
 * actions without re-deriving the field list a second time — zero behavior
 * change for "Do it again" itself.
 *
 * Deliberately NOT carried over (matches the original handler's own
 * reasoning): date/time (a re-host always needs a new date), and
 * soloFriendly/minParticipants/confirmationDeadline/circleId/planId, which
 * are situational to the original booking, not "what this activity is". */
export function buildRehostParams(game: Game): URLSearchParams {
  const params = new URLSearchParams({ activity: game.activityLabel });
  if (game.centreId) params.set("centreId", game.centreId);
  else if (game.locationText) params.set("locationText", game.locationText);
  if (game.priceCents) params.set("priceCents", String(game.priceCents));
  params.set("capacity", String(game.capacity));
  if (game.skillLevel) params.set("skillLevel", game.skillLevel);
  if (game.description) params.set("description", game.description);
  if (game.durationMinutes) params.set("durationMinutes", String(game.durationMinutes));
  if (game.equipmentNeeded) params.set("equipmentNeeded", game.equipmentNeeded);
  if (game.minAge) params.set("minAge", String(game.minAge));
  if (game.surfaceType) params.set("surfaceType", game.surfaceType);
  if (game.indoorOutdoor) params.set("indoorOutdoor", game.indoorOutdoor);
  if (game.meetingInstructions) params.set("meetingInstructions", game.meetingInstructions);
  if (game.cancellationPolicy) params.set("cancellationPolicy", game.cancellationPolicy);
  return params;
}

/** Convenience wrapper for the common case — a relative URL to hand straight to `navigate()`. */
export function rehostHref(game: Game): string {
  return `/games/host?${buildRehostParams(game).toString()}`;
}
