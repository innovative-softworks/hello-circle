import { useNavigate } from "react-router-dom";
import type { Centre } from "../types";
import { cardImageRatio, colors } from "../theme";
import { BuildingIcon, StarIcon } from "./icons";
import { Photo } from "./Photo";
import { SaveButton, useSavedState } from "./SaveButton";
import { Button, CardLink } from "./ui";

export function CentreCard({ centre }: { centre: Centre }) {
  const navigate = useNavigate();
  const [fav, toggleFav] = useSavedState("centre", centre.id);
  const href = `/centres/${centre.slug ?? centre.id}`;
  const open = () => navigate(href);

  return (
    <div
      className="card-hover card-surface"
      style={{
        position: "relative",
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 18,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <CardLink to={href} label={centre.name} />
      <Photo
        src={centre.image}
        alt={centre.name}
        ph={centre.ph}
        icon={<BuildingIcon size={26} />}
        iconColor={colors.green}
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
            color: colors.green,
            transition: "background-color .2s ease, color .2s ease",
          }}
        >
          from €{centre.from}/hr
        </span>
        <SaveButton saved={fav} onToggle={toggleFav} />
      </Photo>
      <div style={{ padding: "16px 18px 18px", flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          {centre.reviews > 0 && (
            <>
              <StarIcon size={14} style={{ color: colors.gold }} />
              <span style={{ fontWeight: 700, fontSize: 14 }}>{centre.rating}</span>
              <span style={{ color: colors.faint, fontSize: 13 }}>({centre.reviews})</span>
            </>
          )}
          <span style={{ marginLeft: "auto", color: colors.faint, fontSize: 13 }}>up to {centre.capacity}</span>
        </div>
        <h3 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 3px", letterSpacing: "-.01em" }}>{centre.name}</h3>
        <p style={{ margin: "0 0 12px", color: colors.mutedLight, fontSize: 14 }}>{centre.area}</p>
        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: colors.text }}>from €{centre.from}/hr</span>
          <div className="stretched-link-above">
            <Button
              variant={centre.isOpen === false ? "ghost" : "dark"}
              disabled={centre.isOpen === false}
              style={{ padding: "8px 16px", fontSize: 13 }}
              onClick={open}
            >
              {centre.isOpen === false ? "Not taking bookings" : "Check availability"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
