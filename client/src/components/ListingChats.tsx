import { useEffect, useState, type CSSProperties } from "react";
import { fetchChatInbox } from "../api";
import { useAuth } from "../AuthContext";
import { useGuest } from "../GuestContext";
import { ChatModal } from "./ChatModal";
import { ChatIcon } from "./icons";
import { Modal } from "./ui";
import { colors, radius } from "../theme";
import type { ChatInboxItem, ChatScopeType } from "../types";

// The detail-page "Chat" button, sat in each page's top utility bar next
// to Share/Save. It asks the inbox which conversations the signed-in
// resident belongs to for this listing (a game or Circle they've joined, a
// booked departure, a program they're enrolled in, a club they're
// registered with) — membership is decided server-side, so it renders
// nothing for anyone not taking part. One conversation opens straight into
// the chat popup; several (e.g. two booked departures) get a small picker
// popup first.
export function ListingChatButton({
  scopeType,
  listingId,
  style,
  iconOnly,
  refreshKey,
}: {
  scopeType: ChatScopeType;
  listingId: string;
  /** Matches the surrounding utility-bar buttons on each page. */
  style?: CSSProperties;
  iconOnly?: boolean;
  /** Bump to re-check membership (e.g. right after joining). */
  refreshKey?: unknown;
}) {
  const { resident } = useGuest();
  const { user } = useAuth();
  const isVendor = user?.role === "vendor";
  const [items, setItems] = useState<ChatInboxItem[]>([]);
  const [picker, setPicker] = useState(false);
  const [openItem, setOpenItem] = useState<ChatInboxItem | null>(null);

  // A resident sees the chats they take part in; a vendor viewing their own
  // listing sees its chats as the host. (A linked person holding both
  // sessions gets both — deduped, since the server lets them in either way.)
  const load = () => {
    if (!resident && !isVendor) {
      setItems([]);
      return;
    }
    Promise.all([
      resident ? fetchChatInbox().then((r) => r.items).catch(() => []) : Promise.resolve([] as ChatInboxItem[]),
      isVendor && scopeType !== "game" && scopeType !== "circle" ? fetchChatInbox(true).then((r) => r.items).catch(() => []) : Promise.resolve([] as ChatInboxItem[]),
    ]).then(([mine, hosted]) => {
      const seen = new Set<string>();
      setItems(
        [...mine, ...hosted].filter((i) => {
          if (i.scopeType !== scopeType || i.listingId !== listingId || seen.has(i.scopeId)) return false;
          seen.add(i.scopeId);
          return true;
        })
      );
    });
  };

  useEffect(load, [resident?.id, isVendor, scopeType, listingId, refreshKey]);

  if (items.length === 0) return null;
  const unread = items.reduce((n, i) => n + i.unread, 0);

  return (
    <>
      <button
        onClick={() => (items.length === 1 ? setOpenItem(items[0]) : setPicker(true))}
        aria-label={unread > 0 ? `Group chat, ${unread} unread` : "Group chat"}
        title="Group chat"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, position: "relative", cursor: "pointer", ...style }}
      >
        <ChatIcon size={iconOnly ? 20 : 14} />
        {!iconOnly && "Chat"}
        {unread > 0 &&
          (iconOnly ? (
            <span aria-hidden="true" style={{ position: "absolute", top: -2, right: -3, width: 9, height: 9, borderRadius: 5, background: colors.orange, border: `2px solid ${colors.bg}` }} />
          ) : (
            <span style={{ minWidth: 18, height: 18, borderRadius: 9, background: colors.orange, color: "#fff", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
              {unread > 99 ? "99+" : unread}
            </span>
          ))}
      </button>

      <Modal open={picker} onClose={() => setPicker(false)} title="Which chat?" subtitle="Pick a departure.">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((i) => (
            <button
              key={i.scopeId}
              onClick={() => {
                setPicker(false);
                setOpenItem(i);
              }}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, textAlign: "left", background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "12px 14px", cursor: "pointer", color: colors.text, fontSize: 14, fontWeight: 700 }}
            >
              {i.subtitle.replace(/^Departure · /, "")}
              {i.unread > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: colors.orange, borderRadius: radius.pill, padding: "2px 7px" }}>{i.unread}</span>}
            </button>
          ))}
        </div>
      </Modal>

      <ChatModal
        open={!!openItem}
        onClose={() => {
          setOpenItem(null);
          load();
        }}
        scopeType={openItem?.scopeType ?? scopeType}
        scopeId={openItem?.scopeId ?? ""}
        title={openItem?.title ?? ""}
      />
    </>
  );
}
