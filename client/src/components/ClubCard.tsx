import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Club } from "../types";
import { colors } from "../theme";
import { isFavorite, toggleFavorite } from "../favorites";
import { priceLabel } from "../priceLabel";
import { BallIcon, HeartIcon } from "./icons";
import { Photo } from "./Photo";

export function ClubCard({ club }: { club: Club }) {
  const navigate = useNavigate();
  const [fav, setFav] = useState(() => isFavorite("club", club.id));

  return (
    <div
      onClick={() => navigate(`/clubs/${club.id}`)}
      className="card-hover card-surface"
      style={{
        cursor: "pointer",
        background: "#fff",
        border: `1px solid ${colors.border}`,
        borderRadius: 18,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Photo
        src={club.image}
        alt={club.name}
        ph={club.ph}
        icon={<BallIcon size={26} />}
        iconColor={colors.orangeDark}
        style={{ height: 120 }}
        contentStyle={{ display: "flex", alignItems: "flex-end", padding: 12 }}
      >
        <span
          style={{
            background: "rgba(255,255,255,.9)",
            borderRadius: 8,
            padding: "4px 9px",
            fontSize: 12,
            fontWeight: 700,
            color: colors.orangeDark,
          }}
        >
          {club.sport}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setFav(toggleFavorite("club", club.id));
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
      <div style={{ padding: "16px 18px 18px", flex: 1, display: "flex", flexDirection: "column" }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 3px", letterSpacing: "-.01em" }}>{club.name}</h3>
        <p style={{ margin: "0 0 12px", color: colors.mutedLight, fontSize: 14 }}>
          {club.area} · ages {club.ages}
        </p>
        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: colors.text }}>{priceLabel(club)}</span>
          {club.trial && (
            <span
              style={{
                marginLeft: "auto",
                background: colors.greenBg,
                color: colors.greenText,
                borderRadius: 20,
                padding: "3px 10px",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Free trial
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
