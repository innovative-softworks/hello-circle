import { useNavigate } from "react-router-dom";
import type { Club } from "../types";
import { colors } from "../theme";
import { clubPriceSignal } from "../priceSignal";
import { BallIcon, PinIcon, UsersIcon } from "./icons";
import { CardArrow, CardPrice, ListingCard } from "./ListingCard";
import { SaveButton, useSavedState } from "./SaveButton";
import { Button } from "./ui";

// Sports club card — the shared ListingCard shape (design-system
// consistency pass). Behaviour unchanged: opens the club / registration.
export function ClubCard({ club }: { club: Club }) {
  const navigate = useNavigate();
  const [fav, toggleFav] = useSavedState("club", club.id);
  const href = `/clubs/${club.slug ?? club.id}`;
  const open = () => navigate(href);
  const signal = clubPriceSignal(club);

  return (
    <ListingCard
      rowOnPhone
      href={href}
      title={club.name}
      image={club.image}
      ph={club.ph}
      icon={<BallIcon size={26} />}
      iconColor={colors.orange}
      tag={club.sport || "Club"}
      save={<SaveButton saved={fav} onToggle={toggleFav} />}
      details={[club.area ? { icon: <PinIcon size={13} />, text: club.area } : null, club.ages ? { icon: <UsersIcon size={13} />, text: `Ages ${club.ages}` } : null]}
      facts={
        <>
          <CardPrice cents={signal === "free" ? 0 : Math.round(club.price * 100)} unit={club.unit ? (club.unit === "session" ? "per session" : `a ${club.unit}`) : undefined} />
          {signal === "free_trial" && <span className="lc-price-note">Free first session</span>}
        </>
      }
      action={
        <CardArrow label={`${club.audience === "kids" ? "Register my child" : "Register"}: ${club.name}`} onClick={open} />
      }
    />
  );
}
