import { useNavigate } from "react-router-dom";
import type { Centre } from "../types";
import { colors } from "../theme";
import { BuildingIcon, PinIcon, StarIcon, UsersIcon } from "./icons";
import { CardAction, CardArrow, CardPrice, ListingCard } from "./ListingCard";
import { SaveButton, useSavedState } from "./SaveButton";
import { Button } from "./ui";

// Community centre card — the shared ListingCard shape (design-system
// consistency pass). Behaviour unchanged: opens the centre / booking page.
export function CentreCard({ centre }: { centre: Centre }) {
  const navigate = useNavigate();
  const [fav, toggleFav] = useSavedState("centre", centre.id);
  const href = `/centres/${centre.slug ?? centre.id}`;
  const open = () => navigate(href);
  return (
    <ListingCard
      rowOnPhone
      href={href}
      title={centre.name}
      image={centre.image}
      ph={centre.ph}
      icon={<BuildingIcon size={26} />}
      iconColor={colors.orange}
      tag={`from €${centre.from}/hr`}
      save={<SaveButton saved={fav} onToggle={toggleFav} />}
      details={[
        centre.area ? { icon: <PinIcon size={13} />, text: centre.area } : null,
        { icon: <UsersIcon size={13} />, text: `Up to ${centre.capacity} people` },
        centre.reviews > 0 ? { icon: <StarIcon size={13} style={{ color: colors.gold }} />, text: `${centre.rating} (${centre.reviews} review${centre.reviews === 1 ? "" : "s"})` } : null,
      ]}
      facts={<CardPrice cents={Math.round(centre.from * 100)} from unit="an hour" />}
      action={
        centre.isOpen === false ? (
          <CardAction look="booked">Not taking bookings</CardAction>
        ) : (
          <CardArrow label={`Check availability: ${centre.name}`} onClick={open} />
        )
      }
    />
  );
}
