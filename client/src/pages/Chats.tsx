import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchChatInbox } from "../api";
import { useAuth } from "../AuthContext";
import { useGuest } from "../GuestContext";
import { ChatModal } from "../components/ChatModal";
import { ChatIcon } from "../components/icons";
import { Button, EmptyState, PageSpinner, Tabs } from "../components/ui";
import { signInHref } from "../authRedirect";
import { colors, fonts, radius } from "../theme";
import type { ChatInboxItem } from "../types";

// My Chats — every group conversation this person belongs to (games,
// Circles, booked departures, programs, clubs), most recent first. Rows
// open the conversation in a popup rather than a separate page, so the
// inbox stays put underneath. A vendor account gets a "As host" view of
// the chats for its own listings; a linked vendor+resident gets both.

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
}

type View = "personal" | "host";

export function Chats() {
  const { resident, loading: guestLoading } = useGuest();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isVendor = user?.role === "vendor";
  const [view, setView] = useState<View>(resident ? "personal" : "host");
  const [items, setItems] = useState<ChatInboxItem[] | null>(null);
  const [openItem, setOpenItem] = useState<ChatInboxItem | null>(null);

  useEffect(() => {
    if (!resident && isVendor) setView("host");
  }, [resident, isVendor]);

  const load = () => {
    if (view === "personal" && !resident) return setItems([]);
    if (view === "host" && !isVendor) return setItems([]);
    fetchChatInbox(view === "host")
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  };

  useEffect(() => {
    setItems(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, resident?.id, isVendor]);

  if (guestLoading) return <PageSpinner />;

  if (!resident && !isVendor) {
    return (
      <section className="section-pad" style={{ maxWidth: 640, margin: "0 auto", padding: "64px 24px" }}>
        <EmptyState
          icon={<ChatIcon size={22} />}
          title="Sign in to see your chats"
          subtitle="Every game, Circle, booking, program and club you join has a group chat."
          action={<Button onClick={() => navigate(signInHref())}>Sign in</Button>}
        />
      </section>
    );
  }

  return (
    <section className="section-pad" style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px 80px" }}>
      <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(26px, 3.4vw, 34px)", margin: "0 0 6px", letterSpacing: "-.02em" }}>Chats</h1>
      <p style={{ margin: "0 0 20px", color: colors.mutedLight, fontSize: 15 }}>
        {view === "host" ? "Conversations with the people taking part in your listings." : "Group chats for everything you're taking part in."}
      </p>

      {resident && isVendor && (
        <div style={{ marginBottom: 18 }}>
          <Tabs<View>
            value={view}
            onChange={setView}
            options={[
              { key: "personal", label: "Personal" },
              { key: "host", label: "As host" },
            ]}
          />
        </div>
      )}

      {!items ? (
        <PageSpinner />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ChatIcon size={22} />}
          title="No chats yet"
          subtitle={
            view === "host"
              ? "Chats appear here once people book a departure, enrol in a program or register with your club."
              : "Join a game or Circle, book an experience, enrol in a program or register with a club, and its group chat shows up here."
          }
          action={view === "personal" ? <Button onClick={() => navigate("/explore")}>Find something to do</Button> : undefined}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, overflow: "hidden" }}>
          {items.map((i, idx) => (
            <button
              key={`${i.scopeType}:${i.scopeId}`}
              onClick={() => setOpenItem(i)}
              className="dropdown-item"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                width: "100%",
                textAlign: "left",
                background: "none",
                border: "none",
                borderTop: idx === 0 ? "none" : `1px solid ${colors.border}`,
                padding: "14px 16px",
                cursor: "pointer",
                color: colors.text,
              }}
            >
              <span style={{ width: 42, height: 42, borderRadius: 14, background: i.unread > 0 ? colors.greenBg : colors.panel, color: i.unread > 0 ? colors.greenText : colors.muted, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <ChatIcon size={19} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontWeight: i.unread > 0 ? 800 : 700, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.title}</span>
                  {i.lastMessage && <span style={{ fontSize: 12, color: colors.faint, flex: "none" }}>{ago(i.lastMessage.createdAt)}</span>}
                </span>
                <span style={{ display: "block", fontSize: 12, color: colors.faint, marginTop: 1 }}>{i.subtitle}</span>
                <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 3 }}>
                  <span style={{ fontSize: 13.5, color: i.unread > 0 ? colors.text : colors.mutedLight, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {i.lastMessage ? `${i.lastMessage.authorName}: ${i.lastMessage.body}` : "No messages yet"}
                  </span>
                  {i.unread > 0 && (
                    <span style={{ minWidth: 20, height: 20, borderRadius: 10, background: colors.orange, color: "#fff", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 6px", flex: "none" }}>
                      {i.unread > 99 ? "99+" : i.unread}
                    </span>
                  )}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      <ChatModal
        open={!!openItem}
        onClose={() => {
          setOpenItem(null);
          load();
        }}
        scopeType={openItem?.scopeType ?? "game"}
        scopeId={openItem?.scopeId ?? ""}
        title={openItem?.title ?? ""}
        viewHref={openItem?.href}
      />
    </section>
  );
}
