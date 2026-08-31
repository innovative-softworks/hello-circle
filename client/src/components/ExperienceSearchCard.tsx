import { useNavigate } from "react-router-dom";
import { TreeIconSmall } from "./icons";
import { Photo } from "./Photo";
import { SaveButton, useSavedState } from "./SaveButton";
import { Button } from "./ui";
import { cardImageRatio, colors, placeholderStripes } from "../theme";
import type { ExperienceSearchResult } from "../types";
import { formatPrice } from "../formatters";

// Adventure/experience result card — shared by Explore's Results Mode and
// AskHelloCircle.tsx (both consume the same runStructuredSearch() result).
// Built to the exact same shell/spacing/type-scale as CentreCard/ClubCard
// (padding, title size, photo badge, SaveButton) rather than its own
// tighter variant — it previously ran smaller padding, a smaller title, and
// no save button at all, which read as a lesser card family sitting in the
// same results grid.

export function ExperienceSearchCard({ e }: { e: ExperienceSearchResult }) {
  const navigate = useNavigate();
  const [fav, toggleFav] = useSavedState("experience", e.id);
  const open = () => navigate(`/${e.kind === "adventure" ? "adventures" : "experiences"}/${e.id}`);
  // Same per-kind CTA verb ExperienceDetail.tsx's own booking button uses.
  const registerLabel = e.kind === "adventure" ? "Book this adventure" : "Register for this experience";
  return (
    <div
      onClick={open}
      className="card-hover card-surface"
      style={{ cursor: "pointer", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 18, overflow: "hidden" }}
    >
      <Photo
        src={e.imageUrl || undefined}
        alt={e.title}
        ph={e.kind === "adventure" ? placeholderStripes.green : placeholderStripes.orange}
        icon={<TreeIconSmall size={26} />}
        iconColor={e.kind === "adventure" ? colors.greenText : colors.orangeDark}
        style={{ aspectRatio: cardImageRatio.discovery }}
        contentStyle={{ display: "flex", alignItems: "flex-end", padding: 12 }}
      >
        <span
          className="card-photo-badge"
          style={{
            background: "rgba(255,255,255,.9)",
            borderRadius: 8,
            padding: "4px 9px",
            fontSize: 12,
            fontWeight: 700,
            color: e.kind === "adventure" ? colors.green : colors.orangeDark,
            transition: "background-color .2s ease, color .2s ease",
          }}
        >
          {e.kind === "adventure" ? "Adventure" : "Experience"}
        </span>
        <SaveButton saved={fav} onToggle={toggleFav} />
      </Photo>
      <div style={{ padding: "16px 18px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 3px", letterSpacing: "-.01em" }}>{e.title}</h3>
          <span style={{ fontWeight: 700, fontSize: 15, whiteSpace: "nowrap" }}>{formatPrice(e.priceCents)}</span>
        </div>
        <p style={{ margin: "0 0 12px", color: colors.mutedLight, fontSize: 14 }}>{e.area}{e.area && e.county ? ", " : ""}{e.county}</p>
        <div onClick={(ev) => ev.stopPropagation()}>
          <Button style={{ width: "100%", fontSize: 13 }} onClick={open}>
            {registerLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
