import { useNavigate } from "react-router-dom";
import type { Centre } from "../types";
import { cardImageRatio, colors } from "../theme";
import { BuildingIcon, StarIcon } from "./icons";
import { Photo } from "./Photo";
import { SaveButton, useSavedState } from "./SaveButton";

export function CentreCard({ centre }: { centre: Centre }) {
  const navigate = useNavigate();
  const [fav, toggleFav] = useSavedState("centre", centre.id);

  return (
    <div
      onClick={() => navigate(`/centres/${centre.slug ?? centre.id}`)}
      className="card-hover card-surface"
      style={{
        cursor: "pointer",
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 18,
        overflow: "hidden",
      }}
    >
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
      <div style={{ padding: "16px 18px 18px" }}>
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
        <p style={{ margin: 0, color: colors.mutedLight, fontSize: 14 }}>{centre.area}</p>
      </div>
    </div>
  );
}
