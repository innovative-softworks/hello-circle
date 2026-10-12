import { useNavigate } from "react-router-dom";
import type { Club } from "../types";
import { colors } from "../theme";
import { priceLabel } from "../priceLabel";
import { clubPriceSignal } from "../priceSignal";
import { PriceChip } from "./PriceChip";
import { BallIcon, PinIcon, UsersIcon } from "./icons";
import { CardPrice, ListingCard, cardButtonStyle } from "./ListingCard";
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
          {signal === "free" ? <PriceChip signal="free" /> : <CardPrice>{priceLabel(club)}</CardPrice>}
          {signal === "free_trial" && <PriceChip signal="free_trial" />}
        </>
      }
      action={
        <Button style={cardButtonStyle} variant="dark" onClick={open}>
          {club.audience === "kids" ? "Register my child" : "Register"}
        </Button>
      }
    />
  );
}
