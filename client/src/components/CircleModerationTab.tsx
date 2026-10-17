import { useState } from "react";
import { Megaphone, ShieldAlert } from "lucide-react";
import { fetchCircleModeration, hideChatMessage, sendCircleAnnouncement, unmuteCircleMember } from "../api";
import { AdminButton, AdminModal, Box, EmptyMessage, FormField, Loaded, errorMessage, formatDate, useAdminData } from "./admin/adminUi";
import { useToast } from "./Toast";

// OG-18 — moderation for a Circle's organisers: messages members reported
// (what they said, never who reported), messages that were removed, who is
// muted, the mute/announcement history, and a way to tell every member
// something at once.

const HISTORY_LABEL: Record<string, string> = {
  "circle.member_muted": "paused a member's messages",
  "circle.member_unmuted": "let a member post again",
  "circle.announcement_sent": "sent an announcement",
};

export function CircleModerationTab({ circleId }: { circleId: string }) {
  const toast = useToast();
  const state = useAdminData(() => fetchCircleModeration(circleId), [circleId]);
  const [announcing, setAnnouncing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hiding, setHiding] = useState<{ id: number; author: string } | null>(null);
  const [hideReason, setHideReason] = useState("");

  const announce = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await sendCircleAnnouncement(circleId, message.trim());
      toast.success(`Sent to ${r.recipients} member${r.recipients === 1 ? "" : "s"}`);
      setAnnouncing(false);
      setMessage("");
      state.reload();
    } catch (e) {
      setError(errorMessage(e, "Couldn't send that announcement"));
    } finally {
      setBusy(false);
    }
  };
  const hide = async () => {
    if (!hiding) return;
    setBusy(true);
    setError(null);
    try {
      await hideChatMessage(hiding.id, hideReason.trim());
      toast.success("Message removed from the chat");
      setHiding(null);
      setHideReason("");
      state.reload();
    } catch (e) {
      setError(errorMessage(e, "Couldn't remove that message"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adm-stack">
      <Box
        icon={Megaphone}
        title="Announcements"
        subtitle="Tell every member at once. It goes to their notifications and into the Circle chat."
        actions={
          <AdminButton variant="primary" onClick={() => setAnnouncing(true)}>
            Send an announcement
          </AdminButton>
        }
      >
        <span className="adm-note">Members can't reply to an announcement directly; they can reply in the chat.</span>
      </Box>
      <Loaded state={state} title="Couldn't load moderation for this Circle">
        {(m) => (
          <>
            <Box flush icon={ShieldAlert} title={`Reported messages${m.reported.length ? ` (${m.reported.length})` : ""}`} subtitle="What members reported in this Circle's chat. Who reported it is never shown.">
              {m.reported.length === 0 ? (
                <EmptyMessage title="Nothing reported" />
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {m.reported.map((r) => (
                    <li key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "12px 24px", borderTop: "1px solid var(--adm-line)" }}>
                      <div style={{ minWidth: 0, flex: "1 1 260px" }}>
                        <strong>{r.author}</strong> <span className="adm-note">· {formatDate(r.createdAt, true)}</span>
                        <div style={{ margin: "4px 0", overflowWrap: "anywhere" }}>{r.body}</div>
                        <div className="adm-note">
                          Reported {r.reports === 1 ? "once" : `${r.reports} times`} · latest: "{r.latestReason}"
                        </div>
                      </div>
                      {r.hiddenAt ? (
                        <span className="adm-note">Removed</span>
                      ) : (
                        <AdminButton size="sm" onClick={() => setHiding({ id: r.id, author: r.author })}>
                          Remove message
                        </AdminButton>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Box>
            <Box flush title="Muted members">
              {m.muted.length === 0 ? (
                <EmptyMessage title="No one is muted" detail="Mute someone from Members." />
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {m.muted.map((x) => (
                    <li key={x.residentId} style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "12px 24px", borderTop: "1px solid var(--adm-line)" }}>
                      <span>
                        <strong>{x.name}</strong> <span className="adm-note">· until {formatDate(x.mutedUntil, true)}</span>
                      </span>
                      <AdminButton
                        size="sm"
                        onClick={() =>
                          unmuteCircleMember(circleId, x.residentId)
                            .then(() => {
                              toast.success(`${x.name} can post again`);
                              state.reload();
                            })
                            .catch((e) => toast.error(errorMessage(e, "Couldn't unmute")))
                        }
                      >
                        Unmute
                      </AdminButton>
                    </li>
                  ))}
                </ul>
              )}
            </Box>
            <Box flush title="Removed messages">
              {m.hidden.length === 0 ? (
                <EmptyMessage title="No messages removed" />
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {m.hidden.map((h) => (
                    <li key={h.id} style={{ padding: "12px 24px", borderTop: "1px solid var(--adm-line)" }}>
                      <strong>{h.author}</strong> <span className="adm-note">· removed {formatDate(h.hiddenAt, true)} by {h.hiddenByKind === "admin" ? "HelloCircle" : "an organiser"}</span>
                      <div style={{ margin: "4px 0", overflowWrap: "anywhere" }}>{h.body}</div>
                      {h.reason && <div className="adm-note">Reason: {h.reason}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </Box>
            <Box flush title="History">
              {m.history.length === 0 ? (
                <EmptyMessage title="Nothing yet" />
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {m.history.map((h, i) => (
                    <li key={i} style={{ padding: "10px 24px", borderTop: "1px solid var(--adm-line)", fontSize: 13.5 }}>
                      {formatDate(h.createdAt, true)} · <strong>{h.actor}</strong> {HISTORY_LABEL[h.action] ?? h.action}
                      {h.reason ? ` — "${h.reason}"` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </Box>
          </>
        )}
      </Loaded>

      <AdminModal
        open={announcing}
        onClose={() => setAnnouncing(false)}
        dirty={!!message}
        title="Send an announcement"
        subtitle="Every member gets it in their notifications, and it's posted in the Circle chat."
        footer={
          <>
            <AdminButton variant="quiet" onClick={() => setAnnouncing(false)}>
              Cancel
            </AdminButton>
            <AdminButton variant="primary" onClick={announce} disabled={busy || message.trim().length < 3}>
              {busy ? "Sending…" : "Send to all members"}
            </AdminButton>
          </>
        }
      >
        <FormField label="Announcement" required error={error}>
          {(p) => <textarea {...p} rows={4} maxLength={1000} className="adm-input" value={message} onChange={(e) => setMessage(e.target.value)} style={{ resize: "vertical" }} />}
        </FormField>
      </AdminModal>

      <AdminModal
        open={!!hiding}
        onClose={() => setHiding(null)}
        title={`Remove ${hiding?.author ?? "this member"}'s message?`}
        subtitle="It's replaced with “Removed by an organiser” for everyone. HelloCircle keeps the original in case it's needed for a report."
        footer={
          <>
            <AdminButton variant="quiet" onClick={() => setHiding(null)}>
              Cancel
            </AdminButton>
            <AdminButton variant="primary" onClick={hide} disabled={busy || !hideReason.trim()}>
              {busy ? "Removing…" : "Remove message"}
            </AdminButton>
          </>
        }
      >
        <FormField label="Reason" required hint="Kept with the record; not shown to members." error={error}>
          {(p) => <input {...p} className="adm-input" value={hideReason} onChange={(e) => setHideReason(e.target.value)} />}
        </FormField>
      </AdminModal>
    </div>
  );
}
