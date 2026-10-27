import { useEffect, useState } from "react";
import { fetchChatMessages, fetchCircleMembers } from "../../api";
import type { ChatMessage, CircleMemberSummary } from "../../types";
import { ChatIcon, UsersIcon } from "../icons";
import { ChevronRight } from "lucide-react";
import { Avatar, Button, EmptyState, LoadErrorState, Skeleton } from "../ui";

// Circle Home "Conversations" + the Discussions and Members tabs. The Circle
// chat itself stays in ChatModal (report, hide, block and mute all live
// there); this is a read-only glimpse of the latest messages, with
// announcements (posted by organisers with a 📣, routes/circles.ts) picked
// out. Fetched once — the modal is what polls.

const ANNOUNCEMENT = "📣 ";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return days < 8 ? `${days} day${days === 1 ? "" : "s"} ago` : when(iso);
}

/** layout "rows" — Circle Home's compact list (2026-10-23); each row opens the chat. */
export function CircleConversations({ circleId, limit, onOpenChat, refreshKey, layout = "messages" }: { circleId: string; limit: number; onOpenChat: () => void; refreshKey?: unknown; layout?: "messages" | "rows" }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    fetchChatMessages("circle", circleId)
      .then((feed) => setMessages(feed.messages.filter((m) => !m.hidden)))
      .catch(() => setFailed(true));
  };
  useEffect(load, [circleId, refreshKey]);

  if (failed) return <LoadErrorState title="We couldn't load the Circle chat." onRetry={load} />;
  if (!messages) return <Skeleton height={90} />;
  const announcements = messages.filter((m) => m.body.startsWith(ANNOUNCEMENT)).slice(-2).reverse();
  const recent = messages.filter((m) => !m.body.startsWith(ANNOUNCEMENT)).slice(-limit).reverse();
  if (layout === "rows" && (announcements.length > 0 || recent.length > 0)) {
    return (
      <div className="ch-card" style={{ padding: "4px 14px" }}>
        <ul className="ch-list">
          {[...announcements.slice(0, 1), ...recent].slice(0, limit).map((m) => {
            const isAnnouncement = m.body.startsWith(ANNOUNCEMENT);
            const who = m.isMine ? "You" : m.residentName || "A member";
            return (
              <li key={m.id}>
                <button type="button" className="ch-list-row" onClick={onOpenChat} aria-label={`${who}: ${isAnnouncement ? m.body.slice(ANNOUNCEMENT.length) : m.body}. Open the Circle chat`}>
                  <Avatar name={m.residentName || who} size={36} />
                  <span style={{ minWidth: 0 }}>
                    <span className="ch-list-title" style={{ display: "block" }}>
                      {isAnnouncement && <span className="ce-pill ce-pill--orange" style={{ marginRight: 8 }}>Announcement</span>}
                      {isAnnouncement ? m.body.slice(ANNOUNCEMENT.length) : m.body}
                    </span>
                    <span className="ch-list-meta" style={{ display: "block" }}>
                      {who} · {ago(m.createdAt)}
                    </span>
                  </span>
                  <ChevronRight size={18} aria-hidden="true" style={{ color: "var(--color-muted-light)" }} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  return (
    <div>
      {announcements.length === 0 && recent.length === 0 ? (
        <EmptyState icon={<ChatIcon size={20} />} title="No messages yet" subtitle="Say hello, ask a question, or share a plan with the Circle." action={<Button onClick={onOpenChat}>Message Circle</Button>} />
      ) : (
        <>
          <ul className="ce-messages">
            {[...announcements, ...recent].map((m) => {
              const isAnnouncement = m.body.startsWith(ANNOUNCEMENT);
              return (
                <li key={m.id} className={`ce-message${isAnnouncement ? " ce-message--announcement" : ""}`}>
                  <div className="ce-message-head">
                    {isAnnouncement ? "Announcement · " : ""}
                    {m.isMine ? "You" : m.residentName || "A member"} · {when(m.createdAt)}
                  </div>
                  <p>{isAnnouncement ? m.body.slice(ANNOUNCEMENT.length) : m.body}</p>
                </li>
              );
            })}
          </ul>
          <div style={{ marginTop: 14 }}>
            <Button variant="ghost" onClick={onOpenChat}>
              Open the Circle chat
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export function CircleMemberDirectory({ circleId, isOrganiser, onManage }: { circleId: string; isOrganiser: boolean; onManage: () => void }) {
  const [data, setData] = useState<CircleMemberSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    fetchCircleMembers(circleId, true)
      .then(setData)
      .catch(() => setFailed(true));
  };
  useEffect(load, [circleId]);
  if (failed) return <LoadErrorState title="We couldn't load the members." onRetry={load} />;
  if (!data) return <Skeleton height={120} />;
  const organisers = data.members.filter((m) => m.role === "organiser");
  const members = data.members.filter((m) => m.role !== "organiser");
  return (
    <div>
      <div className="ce-section-head">
        <div>
          <h2>Members</h2>
          <p>
            {data.total.toLocaleString()} {data.total === 1 ? "person" : "people"}. Names only — nobody's contact details are shown here.
          </p>
        </div>
        {isOrganiser && (
          <Button variant="ghost" onClick={onManage}>
            Manage members
          </Button>
        )}
      </div>
      {data.members.length === 0 ? (
        <EmptyState icon={<UsersIcon size={20} />} title="No members yet" />
      ) : (
        [
          { label: "Organisers", list: organisers },
          { label: "Members", list: members },
        ]
          .filter((g) => g.list.length > 0)
          .map((g) => (
            <div key={g.label} style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--color-muted-light)", margin: "0 0 10px" }}>{g.label}</h3>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
                {g.list.map((m) => (
                  <li key={m.residentId} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                    <Avatar name={m.name} size={32} />
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))
      )}
    </div>
  );
}
