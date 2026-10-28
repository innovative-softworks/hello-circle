import { useNavigate } from "react-router-dom";
import { PinIcon, TreeIconSmall } from "./icons";
import { SaveButton, useSavedState } from "./SaveButton";
import { Button } from "./ui";
import { colors, placeholderStripes } from "../theme";
import type { ExperienceSearchResult } from "../types";
import { CardArrow, CardPrice, ListingCard } from "./ListingCard";
import { cardWord } from "../cardWord";
import { priceState } from "../exploreFilters";

// Adventure/experience result card — shared by Explore's Results Mode and
// AskHelloCircle.tsx. Now the shared ListingCard shape (design-system
// consistency pass); behaviour unchanged.
export function ExperienceSearchCard({ e, chosenWord }: { e: ExperienceSearchResult; chosenWord?: string | null }) {
  const navigate = useNavigate();
  const [fav, toggleFav] = useSavedState("experience", e.id);
  const href = `/${e.kind === "adventure" ? "adventures" : e.kind === "event" ? "events" : "experiences"}/${e.id}`;
  // Same per-kind CTA verb ExperienceDetail.tsx's own booking button uses.
  const registerLabel = e.kind === "adventure" ? "Book this adventure" : e.kind === "event" ? "Register for this event" : "Register for this experience";
  const where = [e.area, e.county].filter(Boolean).join(", ");
  return (
    <ListingCard
      rowOnPhone
      href={href}
      title={e.title}
      image={e.imageUrl || null}
      ph={e.kind === "adventure" ? placeholderStripes.green : placeholderStripes.orange}
      icon={<TreeIconSmall size={26} />}
      iconColor={colors.orange}
      tag={e.kind === "adventure" ? "Adventure" : e.kind === "event" ? "Event" : "Experience"}
      word={cardWord(e.category, e.kind === "adventure" ? "Adventure" : e.kind === "volunteer" ? "Volunteer" : e.kind === "event" ? "Event" : "Experience", chosenWord)}
      save={<SaveButton saved={fav} onToggle={toggleFav} />}
      details={[where ? { icon: <PinIcon size={13} />, text: where } : null]}
      facts={priceState(e) === "unknown" ? null : <CardPrice cents={e.priceCents} unit="per person" />}
      action={
        <CardArrow label={`${registerLabel}: ${e.title}`} onClick={() => navigate(href)} />
      }
    />
  );
}
