import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { blockResident, fetchChatMessages, postChatMessage, reportChatMessage } from "../api";
import { useConfirm } from "./ConfirmProvider";
import { ChatIcon } from "./icons";
import { Button, ConfirmDialog, Modal, inputStyle } from "./ui";
import { useToast } from "./Toast";
import { colors, fonts, radius } from "../theme";
import type { ChatMessage, ChatScopeType } from "../types";

// Group chat, in a popup — for every kind of conversation (game, Circle,
// experience departure, program, club). Polls only while open (no
// real-time layer in this stack — see server/src/routes/chat.ts). The
// server decides who's allowed in and whether posting is open; this just
// renders what it's told, including the provider's "Host" messages.

const POLL_MS = 4000;

const REPORT_REASONS = ["Harassment or bullying", "Inappropriate content", "Spam or scam", "Safeguarding concern", "Something else"];

const SCOPE_LABEL: Record<ChatScopeType, string> = {
  game: "Session chat",
  circle: "Circle chat",
  experience_session: "Departure chat",
  program: "Program group chat",
  club: "Club members chat",
};

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" });
}

export function ChatModal({
  open,
  onClose,
  scopeType,
  scopeId,
  title,
  viewHref,
}: {
  open: boolean;
  onClose: () => void;
  scopeType: ChatScopeType;
  scopeId: string;
  title: string;
  /** Set when opened away from the activity itself (the Chats inbox). */
  viewHref?: string;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [canPost, setCanPost] = useState(false);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [viewerRole, setViewerRole] = useState<"resident" | "host">("resident");
  const [forbidden, setForbidden] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [reportTarget, setReportTarget] = useState<ChatMessage | null>(null);
  const [reportReason, setReportReason] = useState(REPORT_REASONS[0]);
  const [reporting, setReporting] = useState(false);
  const lastIdRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  // Fresh state each time it opens (or the conversation changes).
  useEffect(() => {
    if (!open) return;
    setMessages([]);
    setLoaded(false);
    setForbidden(false);
    lastIdRef.current = 0;
    let cancelled = false;
    const poll = () => {
      fetchChatMessages(scopeType, scopeId, lastIdRef.current || undefined)
        .then((feed) => {
          if (cancelled) return;
          if (feed.messages.length > 0) {
            setMessages((prev) => [...prev, ...feed.messages.filter((m) => !prev.some((p) => p.id === m.id))]);
            lastIdRef.current = feed.messages[feed.messages.length - 1].id;
          }
          setCanPost(feed.canPost);
          setBlockedReason(feed.postBlockedReason ?? null);
          setViewerRole(feed.viewerRole ?? "resident");
          setLoaded(true);
        })
        .catch((e) => {
          if (cancelled) return;
          if (e instanceof Error && /not part of this conversation|Sign in/.test(e.message)) setForbidden(true);
          setLoaded(true);
        });
    };
    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [open, scopeType, scopeId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, open]);

  // HC-QA-055 — an ordered send queue. Previously Enter was ignored while a
  // send was in flight and the box was cleared when that send *completed*,
  // wiping whatever had been typed in the meantime. Now the text leaves the
  // box the moment it is sent, messages post one at a time in order, and a
  // failed message goes back into the box (ahead of any newer typing) so
  // nothing typed is ever lost.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef(0);
  const send = () => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    setSendError(null);
    pendingRef.current += 1;
    setSending(true);
    queueRef.current = queueRef.current.then(async () => {
      try {
        const msg = await postChatMessage(scopeType, scopeId, body);
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        lastIdRef.current = Math.max(lastIdRef.current, msg.id);
      } catch (e) {
        setDraft((current) => (current.trim() ? `${body}\n${current}` : body));
        setSendError(e instanceof Error ? e.message : "Couldn't send — try again");
      } finally {
        pendingRef.current -= 1;
        if (pendingRef.current === 0) setSending(false);
      }
    });
  };

  const block = async (m: ChatMessage) => {
    const ok = await confirm({
      title: `Block ${m.residentName}?`,
      message: "You won't see each other's messages any more. You can review who you've blocked in Profile → Safety Centre.",
      confirmLabel: "Block",
      tone: "danger",
    });
    if (!ok) return;
    await blockResident(m.residentId);
    setBlockedIds((s) => new Set(s).add(m.residentId));
    setMessages((prev) => prev.filter((x) => x.residentId !== m.residentId || x.authorType === "host"));
    toast.success(`${m.residentName} is blocked`);
  };

  const submitReport = async () => {
    if (!reportTarget) return;
    setReporting(true);
    try {
      await reportChatMessage(reportTarget.id, reportReason);
      toast.success("Thanks — our team will review it");
      setReportTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send the report");
    } finally {
      setReporting(false);
    }
  };

  const footer = forbidden ? undefined : canPost ? (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={Math.min(4, Math.max(1, draft.split("\n").length))}
          maxLength={2000}
          placeholder={viewerRole === "host" ? "Message everyone as the host…" : "Write a message…"}
          aria-label="Message"
          style={{ ...inputStyle, flex: 1, resize: "none", lineHeight: 1.4, fontFamily: fonts.body }}
        />
        <Button onClick={send} disabled={!draft.trim()} style={{ flex: "none" }}>
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>
      {sendError && (
        <div role="alert" style={{ fontSize: 12.5, color: colors.danger, marginTop: 6 }}>
          {sendError}
        </div>
      )}
    </div>
  ) : loaded ? (
    <div style={{ color: colors.mutedLight, fontSize: 13, textAlign: "center" }}>{blockedReason || "Chat isn't open right now."}</div>
  ) : undefined;

  let lastDay = "";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={`${SCOPE_LABEL[scopeType]}${viewerRole === "host" ? " · you're the host" : ""}`}
      toolbar={
        scopeType === "club" || viewHref ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {viewHref && (
              <Link to={viewHref} onClick={onClose} style={{ fontSize: 13, fontWeight: 700, color: colors.greenText }}>
                View details →
              </Link>
            )}
            {scopeType === "club" && (
              <div style={{ fontSize: 12.5, color: colors.muted, lineHeight: 1.45 }}>
                For parents, guardians and adult members. Please don't share children's personal details. The club can see this chat, and any message can be reported.
              </div>
            )}
          </div>
        ) : undefined
      }
      footer={footer}
    >
      {forbidden ? (
        <div style={{ textAlign: "center", color: colors.mutedLight, fontSize: 14, padding: "24px 0" }}>This chat is only for people taking part.</div>
      ) : !loaded ? (
        <div style={{ color: colors.faint, fontSize: 13 }}>Loading…</div>
      ) : messages.length === 0 ? (
        <div style={{ textAlign: "center", padding: "28px 0", color: colors.mutedLight }}>
          <ChatIcon size={26} />
          <div style={{ fontWeight: 700, color: colors.text, marginTop: 8 }}>No messages yet</div>
          <div style={{ fontSize: 13.5, marginTop: 4 }}>{canPost ? "Say hello — introduce yourself or ask a question." : blockedReason}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {messages.map((m) => {
            const day = dayLabel(m.createdAt);
            const showDay = day !== lastDay;
            lastDay = day;
            const mine = !!m.isMine;
            const host = m.authorType === "host";
            return (
              <div key={m.id}>
                {showDay && (
                  <div style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700, color: colors.faint, margin: "6px 0 10px", textTransform: "uppercase", letterSpacing: ".04em" }}>{day}</div>
                )}
                <div style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start" }}>
                  {!mine && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: colors.text, marginBottom: 3 }}>
                      {m.residentName}
                      {host && <span style={{ fontSize: 10.5, fontWeight: 800, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "1px 7px" }}>HOST</span>}
                    </div>
                  )}
                  <div
                    style={{
                      maxWidth: "82%",
                      background: mine ? colors.green : host ? colors.greenBg : colors.surface,
                      color: mine ? "#fff" : colors.text,
                      border: mine ? "none" : `1px solid ${colors.border}`,
                      borderRadius: mine ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                      padding: "8px 12px",
                      fontSize: 14,
                      lineHeight: 1.45,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {m.body}
                  </div>
                  <div style={{ display: "flex", gap: 10, fontSize: 11, color: colors.faint, marginTop: 3 }}>
                    <span>{timeLabel(m.createdAt)}</span>
                    {!mine && (
                      <button onClick={() => setReportTarget(m)} style={{ background: "none", border: "none", padding: 0, fontSize: 11, color: colors.faint, textDecoration: "underline", cursor: "pointer" }}>
                        Report
                      </button>
                    )}
                    {!mine && !host && viewerRole === "resident" && (
                      <button
                        onClick={() => block(m)}
                        disabled={blockedIds.has(m.residentId)}
                        style={{ background: "none", border: "none", padding: 0, fontSize: 11, color: colors.faint, textDecoration: "underline", cursor: "pointer" }}
                      >
                        Block
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      )}

      <ConfirmDialog
        open={!!reportTarget}
        title="Report this message?"
        message="Our team will review it. The person won't be told who reported it."
        confirmLabel={reporting ? "Sending…" : "Report"}
        busy={reporting}
        tone="danger"
        onConfirm={submitReport}
        onCancel={() => setReportTarget(null)}
      >
        <select value={reportReason} onChange={(e) => setReportReason(e.target.value)} aria-label="Reason" style={inputStyle}>
          {REPORT_REASONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </ConfirmDialog>
    </Modal>
  );
}

/** A "Group chat" button that opens the conversation in a popup. */
export function ChatButton({
  scopeType,
  scopeId,
  title,
  label = "Group chat",
  variant = "ghost",
  unread = 0,
  full,
}: {
  scopeType: ChatScopeType;
  scopeId: string;
  title: string;
  label?: string;
  variant?: "primary" | "ghost" | "dark";
  unread?: number;
  full?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} full={full} onClick={() => setOpen(true)}>
        <ChatIcon size={15} /> {label}
        {unread > 0 && (
          <span style={{ marginLeft: 6, minWidth: 18, height: 18, borderRadius: 9, background: colors.orange, color: "#fff", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>
      <ChatModal open={open} onClose={() => setOpen(false)} scopeType={scopeType} scopeId={scopeId} title={title} />
    </>
  );
}

