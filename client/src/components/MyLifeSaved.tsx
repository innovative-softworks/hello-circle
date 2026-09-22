import { useNavigate } from "react-router-dom";
import { Photo } from "./Photo";
import { HeartIcon } from "./icons";
import { colors, fonts, radius } from "../theme";
import type { Favourite } from "../types";

const LABEL: Record<Favourite["listingType"], string> = {
  centre: "Community centre",
  club: "Sports club",
  game: "Session",
  program_session: "Program session",
  club_session: "Club session",
  experience: "Adventure / Experience",
};

// "Saved" (My Life redesign §27) — compact preview, three items, no large
// cards. The server now attaches a best-effort name/imageUrl/subtitle per
// row (see favourites.ts's attachListingDetails) — falls back to the
// generic type label only if that listing was since removed.

export function MyLifeSaved({ favourites }: { favourites: Favourite[] }) {
  const navigate = useNavigate();
  if (favourites.length === 0) return null;

  const detailHref = (f: Favourite): string | null =>
    f.listingType === "centre" ? `/centres/${f.listingId}`
    : f.listingType === "club" ? `/clubs/${f.listingId}`
    : f.listingType === "game" ? `/games/${f.listingId}`
    : f.listingType === "experience" ? `/experiences/${f.listingId}`
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {favourites.slice(0, 3).map((f) => {
        const href = detailHref(f);
        // When the listing has no real name on file (removed/unresolved),
        // both name and subtitle fall back to the same generic type label —
        // showing it twice ("Community centre / Community centre") just
        // reads as broken, so the second line is dropped instead.
        const title = f.name ?? LABEL[f.listingType];
        const subtitle = f.name ? (f.subtitle ?? LABEL[f.listingType]) : null;
        return (
          <button
            key={`${f.listingType}:${f.listingId}`}
            onClick={() => href && navigate(href)}
            disabled={!href}
            style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: "8px", cursor: href ? "pointer" : "default" }}
          >
            <Photo
              src={f.imageUrl ?? undefined}
              alt={title}
              ph={colors.panel}
              style={{ width: 44, height: 44, borderRadius: 8, overflow: "hidden", flex: "none" }}
              icon={!f.imageUrl ? <HeartIcon size={14} filled style={{ color: colors.orange }} /> : undefined}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: colors.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {title}
              </div>
              {subtitle && <div style={{ fontSize: 11.5, color: colors.mutedLight }}>{subtitle}</div>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
