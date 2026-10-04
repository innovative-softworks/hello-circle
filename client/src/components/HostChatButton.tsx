import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { fetchChatInbox } from "../api";
import { ChatModal } from "./ChatModal";
import { ChatIcon } from "./icons";
import { colors, fonts, radius } from "../theme";
import type { ChatInboxItem, ChatScopeType } from "../types";

// Vendor dashboard "Chat" button — opens a listing's group chat (a
// departure, a program, a club) in the popup, posting as the Host. Unread
// counts come from the host inbox; one fetch is shared by every button on
// screen (a departures list can render dozens) and refreshed after a chat
// closes.

let inboxCache: { at: number; promise: Promise<ChatInboxItem[]> } | null = null;
const listeners = new Set<() => void>();

function hostInbox(force = false): Promise<ChatInboxItem[]> {
  if (force || !inboxCache || Date.now() - inboxCache.at > 30000) {
    inboxCache = { at: Date.now(), promise: fetchChatInbox(true).then((r) => r.items).catch(() => []) };
  }
  return inboxCache.promise;
}

export function HostChatButton({
  scopeType,
  scopeId,
  title,
  label = "Chat",
  style,
}: {
  scopeType: ChatScopeType;
  scopeId: string;
  title: string;
  label?: string;
  style?: CSSProperties;
}) {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      hostInbox().then((items) => {
        if (alive) setUnread(items.find((i) => i.scopeType === scopeType && i.scopeId === scopeId)?.unread ?? 0);
      });
    refresh();
    listeners.add(refresh);
    return () => {
      alive = false;
      listeners.delete(refresh);
    };
  }, [scopeType, scopeId]);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={unread > 0 ? `${label}, ${unread} unread` : label}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", padding: 0, cursor: "pointer", color: colors.greenText, fontSize: 12.5, fontWeight: 700, ...style }}
      >
        <ChatIcon size={14} /> {label}
        {unread > 0 && (
          <span style={{ minWidth: 17, height: 17, borderRadius: 9, background: colors.orange, color: "#fff", fontSize: 10.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      <ChatModal
        open={open}
        onClose={() => {
          setOpen(false);
          hostInbox(true).then(() => listeners.forEach((l) => l()));
        }}
        scopeType={scopeType}
        scopeId={scopeId}
        title={title}
      />
    </>
  );
}

/** Vendor Overview card — the most recent group chats across the org's
 *  listings, each opening in the popup. Hidden until there's a chat. */
export function VendorChatsCard() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ChatInboxItem[] | null>(null);
  const [openItem, setOpenItem] = useState<ChatInboxItem | null>(null);

  useEffect(() => {
    hostInbox().then(setItems);
  }, []);

  if (!items || items.length === 0) return null;
  const unread = items.reduce((n, i) => n + i.unread, 0);

  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: fonts.display, fontWeight: 700, fontSize: 16 }}>
          <ChatIcon size={17} /> Group chats
          {unread > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: colors.orange, borderRadius: radius.pill, padding: "2px 8px" }}>{unread} unread</span>}
        </div>
        <button onClick={() => navigate("/chats")} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: colors.greenText, fontSize: 13, fontWeight: 700 }}>
          All chats →
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.slice(0, 4).map((i) => (
          <button
            key={`${i.scopeType}:${i.scopeId}`}
            onClick={() => setOpenItem(i)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, textAlign: "left", background: colors.bg, border: "none", borderRadius: radius.control, padding: "10px 12px", cursor: "pointer", color: colors.text }}
          >
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: i.unread > 0 ? 800 : 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.title}</span>
              <span style={{ display: "block", fontSize: 12.5, color: colors.mutedLight, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {i.lastMessage ? `${i.lastMessage.authorName}: ${i.lastMessage.body}` : `${i.subtitle} · no messages yet`}
              </span>
            </span>
            {i.unread > 0 && (
              <span style={{ minWidth: 20, height: 20, borderRadius: 10, background: colors.orange, color: "#fff", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 6px", flex: "none" }}>{i.unread}</span>
            )}
          </button>
        ))}
      </div>
      <ChatModal
        open={!!openItem}
        onClose={() => {
          setOpenItem(null);
          hostInbox(true).then((next) => {
            setItems(next);
            listeners.forEach((l) => l());
          });
        }}
        scopeType={openItem?.scopeType ?? "program"}
        scopeId={openItem?.scopeId ?? ""}
        title={openItem?.title ?? ""}
        viewHref={openItem?.href}
      />
    </div>
  );
}
