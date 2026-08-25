import { useEffect, useRef, useState } from "react";
import { blockResident, fetchChatMessages, postChatMessage } from "../api";
import { ChatIcon } from "./icons";
import { colors, fonts } from "../theme";
import type { ChatMessage, ChatScopeType } from "../types";

// Participation Chat (implementation plan Phase 11) — polling, not
// WebSocket (see server/src/routes/chat.ts's own reasoning). Shared between
// GameDetail.tsx ('game' scope, temporary — opens 24h before, archives
// after) and CircleDetail.tsx ('circle' scope, persistent). The caller is
// responsible for only rendering this to an actual member — a 403 here
// just renders nothing rather than an error state, since it means the
// caller's own membership check was stale.

const POLL_MS = 4000;

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });
}

export function ChatPanel({ scopeType, scopeId, residentId }: { scopeType: ChatScopeType; scopeId: string; residentId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [canPost, setCanPost] = useState(false);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const lastIdRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Safety Centre (IA spec §13) — block right from the conversation where
  // the problem actually happened, rather than only via a resident-id
  // lookup. Doesn't affect this chat itself (no per-thread filtering yet —
  // see blocked_residents' own comment in db/index.ts); it's the "who have
  // I blocked" list surfaced in My Life → Safety Centre.
  const handleBlock = async (targetId: string) => {
    await blockResident(targetId);
    setBlockedIds((s) => new Set(s).add(targetId));
  };

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetchChatMessages(scopeType, scopeId, lastIdRef.current || undefined)
        .then((feed) => {
          if (cancelled) return;
          if (feed.messages.length > 0) {
            setMessages((prev) => [...prev, ...feed.messages]);
            lastIdRef.current = feed.messages[feed.messages.length - 1].id;
          }
          setCanPost(feed.canPost);
          setBlockedReason(feed.postBlockedReason ?? null);
          setLoaded(true);
        })
        .catch((e) => {
          // Matches the exact message server/src/routes/chat.ts's 403
          // returns — ApiError doesn't carry a status code, so this is the
          // same "match the known error text" pattern other callers in
          // this codebase already use (see registrations.ts's `full` flag).
          if (!cancelled && e instanceof Error && e.message === "You're not part of this conversation") setForbidden(true);
        });
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeType, scopeId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const msg = await postChatMessage(scopeType, scopeId, body);
      setMessages((prev) => [...prev, msg]);
      lastIdRef.current = msg.id;
      setDraft("");
    } catch {
      // Left in the input so the resident can retry — a failed send
      // shouldn't silently discard what they typed.
    } finally {
      setSending(false);
    }
  };

  if (forbidden) return null;

  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 16, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: `1px solid ${colors.border}`, fontWeight: 700, fontSize: 14.5 }}>
        <ChatIcon size={16} /> Chat
      </div>
      <div ref={listRef} style={{ maxHeight: 260, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {!loaded ? (
          <div style={{ color: colors.faint, fontSize: 13 }}>Loading…</div>
        ) : messages.length === 0 ? (
          <div style={{ color: colors.faint, fontSize: 13 }}>No messages yet — say hello.</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} style={{ fontSize: 13.5 }}>
              <span style={{ fontWeight: 700, color: m.residentId === residentId ? colors.greenText : colors.text }}>
                {m.residentName || "A resident"}
              </span>{" "}
              <span style={{ color: colors.faint, fontSize: 11 }}>{timeLabel(m.createdAt)}</span>
              {m.residentId !== residentId && (
                <button
                  onClick={() => handleBlock(m.residentId)}
                  disabled={blockedIds.has(m.residentId)}
                  style={{ background: "none", border: "none", padding: 0, marginLeft: 6, fontSize: 11, color: colors.faint, textDecoration: "underline", cursor: blockedIds.has(m.residentId) ? "default" : "pointer" }}
                >
                  {blockedIds.has(m.residentId) ? "Blocked" : "Block"}
                </button>
              )}
              <div style={{ color: colors.muted, marginTop: 1, wordBreak: "break-word" }}>{m.body}</div>
            </div>
          ))
        )}
      </div>
      <div style={{ borderTop: `1px solid ${colors.border}`, padding: "10px 12px" }}>
        {canPost ? (
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Write a message…"
              style={{ flex: 1, border: `1px solid ${colors.border}`, borderRadius: 10, padding: "8px 12px", fontSize: 13.5, fontFamily: fonts.body }}
            />
            <button
              onClick={handleSend}
              disabled={sending || !draft.trim()}
              style={{ background: colors.green, color: "#fff", border: "none", borderRadius: 10, padding: "8px 16px", fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}
            >
              Send
            </button>
          </div>
        ) : (
          loaded && <div style={{ color: colors.faint, fontSize: 12.5, textAlign: "center" }}>{blockedReason || "Chat isn't open right now."}</div>
        )}
      </div>
    </div>
  );
}
