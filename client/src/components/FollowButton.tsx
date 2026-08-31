import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { followEntity, setFollowNotificationLevel, unfollowEntity, type FollowedType, type NotificationLevel } from "../api";
import { signInHref } from "../authRedirect";
import { useGuest } from "../GuestContext";
import { CheckIcon, ChevronDownIcon } from "./icons";
import { Button } from "./ui";
import { colors, fonts, radius } from "../theme";

const LEVEL_LABELS: Record<NotificationLevel, string> = { highlights: "Highlights", everything: "Everything" };

/** "Keep me in the loop" — one click to follow (no preference modal), a
 * quiet secondary "Notifications: Highlights ▾" control appears only after,
 * defaulting to Highlights, editable inline (never a full preference form).
 * Follower count is a small secondary line, never a headline stat, and
 * omitted below a threshold so a new provider/host doesn't read as
 * unpopular. Signed-out visitors are sent to sign-in with a return path —
 * following requires a real resident identity to notify (no guest
 * fallback), unlike Save/favourites. */
export function FollowButton({
  followedType,
  followedId,
  initialFollowing,
  initialLevel = "highlights",
  followerCount,
}: {
  followedType: FollowedType;
  followedId: string;
  initialFollowing: boolean;
  initialLevel?: NotificationLevel;
  followerCount?: number;
}) {
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [following, setFollowing] = useState(initialFollowing);
  const [level, setLevel] = useState<NotificationLevel>(initialLevel);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const toggleFollow = async () => {
    if (!resident) {
      navigate(signInHref());
      return;
    }
    setBusy(true);
    try {
      if (following) {
        await unfollowEntity(followedType, followedId);
        setFollowing(false);
        setMenuOpen(false);
      } else {
        await followEntity(followedType, followedId);
        setFollowing(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const changeLevel = async (next: NotificationLevel) => {
    setLevel(next);
    setMenuOpen(false);
    await setFollowNotificationLevel(followedType, followedId, next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <Button variant={following ? "ghost" : "primary"} onClick={toggleFollow} disabled={busy} style={{ padding: "10px 18px", fontSize: 13.5 }}>
        {following ? (
          <>
            <CheckIcon size={14} /> Following
          </>
        ) : (
          "+ Follow"
        )}
      </Button>

      {following && (
        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: colors.mutedLight, fontSize: 12, cursor: "pointer", padding: 0 }}
          >
            Notifications: {LEVEL_LABELS[level]} <ChevronDownIcon size={11} />
          </button>
          {menuOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                zIndex: 10,
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: radius.control,
                boxShadow: "0 8px 24px rgba(20,22,20,.12)",
                minWidth: 150,
                overflow: "hidden",
              }}
            >
              {(Object.keys(LEVEL_LABELS) as NotificationLevel[]).map((l) => (
                <button
                  key={l}
                  onClick={() => changeLevel(l)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "9px 14px",
                    fontSize: 13,
                    fontWeight: l === level ? 700 : 500,
                    background: l === level ? colors.panel : "none",
                    border: "none",
                    cursor: "pointer",
                    color: colors.text,
                    fontFamily: fonts.body,
                  }}
                >
                  {LEVEL_LABELS[l]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!following && followerCount !== undefined && followerCount >= 10 && (
        <span style={{ fontSize: 12, color: colors.mutedLight }}>
          {followerCount} people follow this{followedType === "host" ? "" : followedType === "centre" ? " venue" : " provider"}
        </span>
      )}
    </div>
  );
}
