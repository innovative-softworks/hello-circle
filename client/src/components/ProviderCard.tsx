import { useNavigate } from "react-router-dom";
import { PinIcon } from "./icons";
import { EntityTypeLabel } from "./symbols";
import { Button } from "./ui";
import { ListingCard, cardButtonStyle } from "./ListingCard";
import { colors, placeholderStripes } from "../theme";
import type { SimilarProvider } from "../types";

// "Similar providers" / "More from this provider" card — deliberately
// minimal per the redesign brief's §44 (no followers/reviews/ratings).
// Design-system consistency pass: the shared ListingCard shape.
export function ProviderCard({ provider }: { provider: SimilarProvider }) {
  const navigate = useNavigate();
  const href = `/provider/${provider.id}`;
  return (
    <ListingCard
      href={href}
      title={provider.name}
      image={provider.image}
      ph={placeholderStripes.green}
      tag={<EntityTypeLabel type={provider.type} size={11} color="#172019" />}
      details={[provider.area ? { icon: <PinIcon size={13} />, text: provider.area } : null]}
      facts={<span style={{ color: colors.text }}>{provider.listingCount} listing{provider.listingCount === 1 ? "" : "s"}</span>}
      action={
        <Button style={cardButtonStyle} variant="ghost" onClick={() => navigate(href)}>
          View provider
        </Button>
      }
    />
  );
}
