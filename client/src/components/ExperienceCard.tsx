import type { Experience } from "../types";
import { experienceHref, experienceKindWord } from "../experienceKind";
import { CalendarIcon, PinIcon, TreeIconSmall } from "./icons";
import { colors, placeholderStripes } from "../theme";
import { CardArrow, CardPrice, ListingCard } from "./ListingCard";
import { CardDate, itemCardLabel } from "./CardDate";
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
  const href = experienceHref(e.kind, e.slug ?? e.id);
  const where = [e.area, e.county].filter(Boolean).join(", ");
  return (
    <ListingCard
      href={href}
      title={e.title}
      image={e.imageUrl || null}
      ph={e.kind === "adventure" ? placeholderStripes.green : placeholderStripes.orange}
      icon={<TreeIconSmall size={28} />}
      iconColor={colors.orange}
      tag={[experienceKindWord(e.kind), e.difficulty].filter(Boolean).join(" · ")}
      save={<SaveButton saved={fav} onToggle={toggleFav} />}
      dateOn={nextSession ? <CardDate date={nextSession.date} time={nextSession.time} label={itemCardLabel({ date: nextSession.date, time: nextSession.time, spotsLeft: nextSession.spotsLeft })} /> : undefined}
      details={[where ? { icon: <PinIcon size={13} />, text: where } : null, nextSession ? { icon: <CalendarIcon size={13} />, text: `Next: ${nextSession.date} · ${nextSession.time}`, kind: "date" } : null]}
      facts={<CardPrice cents={e.priceCents} unit="per person" />}
      action={
        <CardArrow label={`View ${experienceKindWord(e.kind).toLowerCase()}: ${e.title}`} onClick={() => navigate(href)} />
      }
    >
      {e.blurb ? <p style={{ fontSize: 13, color: colors.muted, margin: "2px 0 0", lineHeight: 1.4 }}>{e.blurb}</p> : null}
    </ListingCard>
  );
}
