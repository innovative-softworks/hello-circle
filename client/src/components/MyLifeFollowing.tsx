import { useNavigate } from "react-router-dom";
import { Photo } from "./Photo";
import { BuildingIcon, PersonIcon } from "./icons";
import { colors, radius } from "../theme";
import type { FollowedEntity } from "../api";

// "Following" preview — mirrors MyLifeSaved's compact-list shape (three
// items, no large cards); the full list with unfollow/notification-level
// controls lives on the Profile page's Following tab.

export function MyLifeFollowing({ follows }: { follows: FollowedEntity[] }) {
  const navigate = useNavigate();
  if (follows.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {follows.slice(0, 3).map((f) => (
        <button
          key={`${f.followedType}:${f.followedId}`}
          onClick={() => navigate(f.href)}
          style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: "8px", cursor: "pointer" }}
        >
          <Photo
            src={f.imageUrl ?? undefined}
            alt={f.name ?? ""}
            ph={colors.panel}
            style={{ width: 44, height: 44, borderRadius: "50%", overflow: "hidden", flex: "none" }}
            icon={!f.imageUrl ? f.followedType === "vendor" ? <BuildingIcon size={14} /> : <PersonIcon size={14} /> : undefined}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: colors.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {f.name ?? "Removed account"}
            </div>
            <div style={{ fontSize: 11.5, color: colors.mutedLight }}>{f.followedType === "vendor" ? "Provider" : "Host"}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
