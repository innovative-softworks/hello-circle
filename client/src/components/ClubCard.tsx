import { useNavigate } from "react-router-dom";
import type { Club } from "../types";
import { colors } from "../theme";
import { priceLabel } from "../priceLabel";
import { BallIcon } from "./icons";
import { Photo } from "./Photo";
import { SaveButton, useSavedState } from "./SaveButton";

export function ClubCard({ club }: { club: Club }) {
  const navigate = useNavigate();
  const [fav, toggleFav] = useSavedState("club", club.id);

  return (
    <div
      onClick={() => navigate(`/clubs/${club.slug ?? club.id}`)}
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
        <SaveButton saved={fav} onToggle={toggleFav} />
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
