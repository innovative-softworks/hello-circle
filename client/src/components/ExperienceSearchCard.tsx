import { useNavigate } from "react-router-dom";
import { PinIcon, TreeIconSmall } from "./icons";
import { SaveButton, useSavedState } from "./SaveButton";
import { Button } from "./ui";
import { colors, placeholderStripes } from "../theme";
import type { ExperienceSearchResult } from "../types";
import { formatPrice } from "../formatters";
import { centsPriceSignal } from "../priceSignal";
import { PriceChip } from "./PriceChip";
import { CardPrice, ListingCard, cardButtonStyle } from "./ListingCard";

// Adventure/experience result card — shared by Explore's Results Mode and
// AskHelloCircle.tsx. Now the shared ListingCard shape (design-system
// consistency pass); behaviour unchanged.
export function ExperienceSearchCard({ e }: { e: ExperienceSearchResult }) {
  const navigate = useNavigate();
  const [fav, toggleFav] = useSavedState("experience", e.id);
  const href = `/${e.kind === "adventure" ? "adventures" : "experiences"}/${e.id}`;
  // Same per-kind CTA verb ExperienceDetail.tsx's own booking button uses.
  const registerLabel = e.kind === "adventure" ? "Book this adventure" : "Register for this experience";
  const where = [e.area, e.county].filter(Boolean).join(", ");
  return (
    <ListingCard
      href={href}
      title={e.title}
      image={e.imageUrl || null}
      ph={e.kind === "adventure" ? placeholderStripes.green : placeholderStripes.orange}
      icon={<TreeIconSmall size={26} />}
      iconColor={colors.orange}
      tag={e.kind === "adventure" ? "Adventure" : "Experience"}
      save={<SaveButton saved={fav} onToggle={toggleFav} />}
      details={[where ? { icon: <PinIcon size={13} />, text: where } : null]}
      facts={centsPriceSignal(e.priceCents) ? <PriceChip signal="free" /> : <CardPrice>{formatPrice(e.priceCents)}</CardPrice>}
      action={
        <Button style={cardButtonStyle} variant="dark" onClick={() => navigate(href)}>
          {registerLabel}
        </Button>
      }
    />
  );
}
