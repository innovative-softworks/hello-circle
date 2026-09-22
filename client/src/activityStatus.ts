import { availabilityFromSpots } from "./components/ui";
import { colors } from "./theme";
import type { Game } from "./types";

// Host Experience Polish — a consistent human-language status label across
// every Host surface (Activities list, Overview's Next Up/upcoming cards),
// derived purely from fields every Game response already has (status,
// date, spotsLeft). Deliberately does NOT introduce 'draft'/'paused' as
// real stored statuses — those aren't real states this codebase supports;
// inventing them would mean deciding how they interact with the join
// route's guard, capacity counting, etc. with no product need driving it.
// Reuses ui.tsx's existing availabilityFromSpots() for the capacity-driven
// states rather than picking new thresholds by feel.

export interface DerivedActivityStatus {
  label: string;
  bg: string;
  fg: string;
}

export function deriveActivityStatus(game: Pick<Game, "status" | "date" | "spotsLeft" | "capacity">): DerivedActivityStatus {
  if (game.status === "cancelled") return { label: "Cancelled", bg: colors.panel, fg: colors.muted };

  const todayIso = new Date().toISOString().slice(0, 10);
  if (game.date < todayIso) return { label: "Completed", bg: colors.panel, fg: colors.mutedLight };

  if (game.status === "pending_participants") return { label: "Needs players", bg: colors.orangeBg, fg: colors.logoMarkText };

  const availability = availabilityFromSpots(game.spotsLeft);
  if (availability === "full") return { label: "Full", bg: colors.panel, fg: colors.muted };
  if (availability === "urgent") return { label: "Almost full", bg: colors.orangeBg, fg: colors.logoMarkText };
  return { label: "Open", bg: colors.greenBg, fg: colors.greenText };
}
