import { useNavigate } from "react-router-dom";
import { Photo } from "./Photo";
import { EntityTypeLabel } from "./symbols";
import { cardImageRatio, colors, placeholderStripes, radius } from "../theme";
import type { SimilarProvider } from "../types";

// "Similar providers" / "More from this provider" card — deliberately
// minimal per the redesign brief's §44 (no followers/reviews/ratings/five
// CTAs stacked onto a card meant for quick comparison).
export function ProviderCard({ provider }: { provider: SimilarProvider }) {
  const navigate = useNavigate();
  return (
    <div
      onClick={() => navigate(`/provider/${provider.id}`)}
      className="card-hover card-surface"
      style={{ cursor: "pointer", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, overflow: "hidden" }}
    >
      <Photo src={provider.image ?? undefined} alt={provider.name} ph={placeholderStripes.green} style={{ aspectRatio: cardImageRatio.discovery }} />
      <div style={{ padding: "14px 16px 16px" }}>
        <EntityTypeLabel type={provider.type} size={12} color={colors.mutedLight} />
        <div style={{ fontWeight: 700, fontSize: 15, margin: "6px 0 2px" }}>{provider.name}</div>
        {provider.area && <div style={{ fontSize: 12.5, color: colors.mutedLight, marginBottom: 8 }}>{provider.area}</div>}
        <span style={{ fontSize: 12, color: colors.faint }}>
          {provider.listingCount} listing{provider.listingCount === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
