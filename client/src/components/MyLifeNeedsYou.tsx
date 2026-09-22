import { useNavigate } from "react-router-dom";
import { ArrowRightIcon, BellIcon, CalendarIcon, ChatIcon, CheckCircleIcon, ClockConfirmIcon, PlusIcon, RepeatIcon, CardIcon } from "./icons";
import { colors, fonts, radius } from "../theme";
import type { NeedsAttentionItem } from "../types";

// My Life V2's "Needs You" (Phase 1 "Connect", extended Phase 2 "Circles
// V2" with the two plan_* action types) — action-oriented, not a passive
// feed: each row states what's pending and what happens if you tap it,
// mirroring the brief's own mock-up style ("Sarah invited you to a Circle
// — [View]"). Same compact-row visual language as MyLifeSaved/
// MyLifeFollowing (no large cards) — see those for the established pattern
// this follows. Server already returns items in priority order; this
// renders that order as-is rather than re-deriving it client-side.

const ICON_BY_ACTION: Record<NeedsAttentionItem["actionType"], React.ReactNode> = {
  payment_incomplete: <CardIcon size={16} />,
  waitlist_offered: <ClockConfirmIcon size={16} />,
  join_request: <BellIcon size={16} />,
  circle_invitation: <ChatIcon size={16} />,
  plan_activity_creation: <PlusIcon size={16} />,
  plan_confirmation: <CheckCircleIcon size={16} />,
  open_poll: <RepeatIcon size={16} />,
};

export function MyLifeNeedsYou({ items }: { items: NeedsAttentionItem[] }) {
  const navigate = useNavigate();

  if (items.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 4px", fontSize: 13, color: colors.mutedLight }}>
        <CalendarIcon size={15} style={{ flexShrink: 0, opacity: 0.6 }} />
        You're all caught up.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => navigate(item.actionUrl)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: "100%",
            textAlign: "left",
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.control,
            padding: "10px 12px",
            cursor: "pointer",
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: colors.panel,
              color: colors.text,
              flex: "none",
            }}
          >
            {ICON_BY_ACTION[item.actionType]}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: fonts.display, fontSize: 13.5, fontWeight: 700, color: colors.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {item.title}
            </div>
            <div style={{ fontSize: 11.5, color: colors.mutedLight, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.description}</div>
          </div>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              fontWeight: 700,
              color: colors.greenText,
              flex: "none",
              whiteSpace: "nowrap",
            }}
          >
            {item.actionLabel} <ArrowRightIcon size={12} />
          </span>
        </button>
      ))}
    </div>
  );
}
