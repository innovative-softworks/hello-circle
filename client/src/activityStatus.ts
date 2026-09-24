import { availabilityFromSpots } from "./components/ui";
import { colors } from "./theme";
import type { Game } from "./types";

// Host Experience Polish — a consistent human-language status label across
// every Host surface (Activities list, Overview's Next Up/upcoming cards),
// derived purely from fields every Game response already has. Originally
// deliberately did NOT introduce 'draft'/'paused' as real states ("no
// product need driving it") — the Universal Publishing, Lifecycle &
// Availability System is exactly that product need, so this now checks
// `effectiveLifecycle` first (server/src/lifecycle.ts's policy, already
// computed server-side — never re-derived here) before falling back to the
// original capacity/date-driven labels for a plain 'active' activity.
// Reuses ui.tsx's existing availabilityFromSpots() for the capacity-driven
// states rather than picking new thresholds by feel.

export interface DerivedActivityStatus {
  label: string;
  bg: string;
  fg: string;
}

export function deriveActivityStatus(game: Pick<Game, "status" | "date" | "spotsLeft" | "capacity" | "effectiveLifecycle">): DerivedActivityStatus {
  if (game.status === "cancelled") return { label: "Cancelled", bg: colors.panel, fg: colors.muted };
  if (game.effectiveLifecycle === "draft") return { label: "Draft", bg: colors.panel, fg: colors.muted };
  if (game.effectiveLifecycle === "coming_soon") return { label: "Coming soon", bg: colors.orangeBg, fg: colors.logoMarkText };
  if (game.effectiveLifecycle === "paused") return { label: "Paused", bg: colors.panel, fg: colors.orangeDark };
  if (game.effectiveLifecycle === "archived") return { label: "Archived", bg: colors.panel, fg: colors.muted };

  const todayIso = new Date().toISOString().slice(0, 10);
  if (game.date < todayIso) return { label: "Completed", bg: colors.panel, fg: colors.mutedLight };

  if (game.status === "pending_participants") return { label: "Needs players", bg: colors.orangeBg, fg: colors.logoMarkText };

  const availability = availabilityFromSpots(game.spotsLeft);
  if (availability === "full") return { label: "Full", bg: colors.panel, fg: colors.muted };
  if (availability === "urgent") return { label: "Almost full", bg: colors.orangeBg, fg: colors.logoMarkText };
  return { label: "Open", bg: colors.greenBg, fg: colors.greenText };
}
