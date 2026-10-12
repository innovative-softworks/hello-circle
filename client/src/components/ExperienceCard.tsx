import type { Experience } from "../types";
import { CalendarIcon, PinIcon, TreeIconSmall } from "./icons";
import { colors, placeholderStripes } from "../theme";
import { formatPrice } from "../formatters";
import { centsPriceSignal } from "../priceSignal";
import { PriceChip } from "./PriceChip";
import { CardPrice, ListingCard, cardButtonStyle } from "./ListingCard";
import { SaveButton, useSavedState } from "./SaveButton";
import { Button } from "./ui";
import { useNavigate } from "react-router-dom";

// Experience/adventure browse card — the shared ListingCard shape
// (design-system consistency pass). Same data as before: price, place,
// difficulty, next session.
export function ExperienceCard({ e }: { e: Experience }) {
  const navigate = useNavigate();
  const [fav, toggleFav] = useSavedState("experience", e.id);
  const nextSession = e.sessions[0];
  const href = `/${e.kind === "adventure" ? "adventures" : "experiences"}/${e.slug ?? e.id}`;
  const where = [e.area, e.county].filter(Boolean).join(", ");
  return (
    <ListingCard
      href={href}
      title={e.title}
      image={e.imageUrl || null}
      ph={e.kind === "adventure" ? placeholderStripes.green : placeholderStripes.orange}
      icon={<TreeIconSmall size={28} />}
      iconColor={colors.orange}
      tag={[e.kind === "adventure" ? "Adventure" : "Experience", e.difficulty].filter(Boolean).join(" · ")}
      save={<SaveButton saved={fav} onToggle={toggleFav} />}
      details={[where ? { icon: <PinIcon size={13} />, text: where } : null, nextSession ? { icon: <CalendarIcon size={13} />, text: `Next: ${nextSession.date} · ${nextSession.time}` } : null]}
      facts={centsPriceSignal(e.priceCents) ? <PriceChip signal="free" /> : <CardPrice>{formatPrice(e.priceCents)}</CardPrice>}
      action={
        <Button style={cardButtonStyle} variant="ghost" onClick={() => navigate(href)}>
          View {e.kind === "adventure" ? "adventure" : "experience"}
        </Button>
      }
    >
      {e.blurb ? <p style={{ fontSize: 13, color: colors.muted, margin: "2px 0 0", lineHeight: 1.4 }}>{e.blurb}</p> : null}
    </ListingCard>
  );
}
