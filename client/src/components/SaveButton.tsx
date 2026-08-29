import { useEffect, useState } from "react";
import { addFavourite, fetchFavourites, removeFavourite } from "../api";
import { HeartIcon } from "./icons";
import { isFavorite, toggleFavorite } from "../favorites";
import { useGuest } from "../GuestContext";
import { colors } from "../theme";
import type { Favourite } from "../types";

// Shared save/heart affordance (cards/listings consistency pass) — was
// hand-rolled identically (30×30 circle, rgba(255,255,255,.9) bg, HeartIcon,
// orange when saved) in 6+ card components, and inconsistently *behaved*:
// DiscoverRow.tsx's DiscoverCard synced a signed-in resident's save to the
// server (addFavourite/removeFavourite, matching CentreDetail.tsx's own
// page-level toggle), while CentreCard/ClubCard/CirclePlanCard/
// ExperienceKindBrowse only ever wrote to localStorage — a resident's saved
// centre from a discovery grid silently never reached their account. This
// hook is the one source of that behavior; the button is the one source of
// the visual.

/** Resident-aware saved state: server-synced when signed in, localStorage
 * otherwise — the same logic DiscoverRow.tsx already had, now shared. */
export function useSavedState(kind: Favourite["listingType"], id: string): [boolean, () => void] {
  const { resident } = useGuest();
  const [saved, setSaved] = useState(() => isFavorite(kind, id));

  useEffect(() => {
    if (resident) fetchFavourites().then((rows) => setSaved(rows.some((r) => r.listingType === kind && r.listingId === id))).catch(() => {});
    else setSaved(isFavorite(kind, id));
  }, [resident, kind, id]);

  const toggle = () => {
    if (resident) {
      const next = !saved;
      setSaved(next);
      (next ? addFavourite(kind, id) : removeFavourite(kind, id)).catch(() => setSaved(!next));
    } else {
      setSaved(toggleFavorite(kind, id));
    }
  };

  return [saved, toggle];
}

/** The button itself — a photo-overlay circle, top-right by default
 * (bottom-right for cards whose top-right corner already holds a status
 * pill, e.g. a mixed-feed DiscoverCard). Icon color is a fixed
 * near-black-on-white constant rather than a `colors.*` token on purpose:
 * it sits on a fixed white circle over arbitrary photography, not the page
 * background, so it doesn't participate in light/dark theming — the same
 * reasoning as theme.ts's `photoOverlay`. */
export function SaveButton({ saved, onToggle, position = "top" }: { saved: boolean; onToggle: () => void; position?: "top" | "bottom" }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={saved ? "Remove from saved" : "Save"}
      style={{
        position: "absolute",
        [position]: 10,
        right: 10,
        width: 30,
        height: 30,
        borderRadius: "50%",
        border: "none",
        background: "rgba(255,255,255,.9)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        color: saved ? colors.orange : "#8A928B",
      }}
    >
      <HeartIcon size={15} filled={saved} />
    </button>
  );
}
