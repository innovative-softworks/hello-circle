import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Centre } from "../types";
import { colors } from "../theme";
import { isFavorite, toggleFavorite } from "../favorites";
import { BuildingIcon, HeartIcon, StarIcon } from "./icons";
import { Photo } from "./Photo";

export function CentreCard({ centre, height = 140 }: { centre: Centre; height?: number }) {
  const navigate = useNavigate();
  const [fav, setFav] = useState(() => isFavorite("centre", centre.id));

  return (
    <div
      onClick={() => navigate(`/centres/${centre.slug ?? centre.id}`)}
      className="card-hover card-surface"
      style={{
        cursor: "pointer",
        background: "#fff",
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
        style={{ height }}
        contentStyle={{ display: "flex", alignItems: "flex-end", padding: 12 }}
      >
        <span
          style={{
            background: "rgba(255,255,255,.9)",
            borderRadius: 8,
            padding: "4px 9px",
            fontSize: 12,
            fontWeight: 700,
            color: colors.green,
          }}
        >
          from €{centre.from}/hr
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setFav(toggleFavorite("centre", centre.id));
          }}
          aria-label={fav ? "Remove from favourites" : "Save to favourites"}
          className="btn"
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            width: 30,
            height: 30,
            borderRadius: "50%",
            border: "none",
            background: "rgba(255,255,255,.9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            color: fav ? colors.orange : "#8A928B",
          }}
        >
          <HeartIcon size={15} filled={fav} />
        </button>
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
