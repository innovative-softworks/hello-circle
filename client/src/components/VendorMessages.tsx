import { BulkBar, RowMenu, useRowSelection } from "./admin/adminUi";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Award, Bell, CalendarDays, CheckCheck, Compass, GraduationCap, MessageSquare, Send, type LucideIcon } from "lucide-react";
import {
  fetchMessageTemplates,
  fetchVendorExperienceSessions,
  fetchVendorExperiences,
  fetchVendorMessages,
  fetchVendorNotifications,
  fetchVendorProgram,
  fetchVendorPrograms,
  markVendorNotificationRead,
  previewVendorMessage,
  sendTestVendorMessage,
  sendVendorMessage,
  type MessageAudience,
  type MessageListingType,
  type MessagePreview,
  type MessageTemplate,
} from "../api";
import { ConfirmDialog, EmptyState, LoadErrorState } from "./ui";
import { AdminButton, AdminModal, Box, FormField, IconTabs } from "./admin/adminUi";
import { agoLabel } from "./admin/timeLabels";
import { useToast } from "./Toast";
import { useUrlParam } from "../useUrlTab";
import { formatDate } from "../vendorFormat";
import type { VendorListingSummary, VendorNotification } from "../types";

// Notifications feed (new bookings/registrations) + the vendor-authored
// message composer — split out of the original single VendorDashboard.tsx
// (see CLAUDE.md).

// Phase K (docs/participation-expansion/22) — the partner's message to the
// people booked on one of their listings. The audience (listing, date or
// session, and who: everyone confirmed, checked in, not checked in, or still
// owing answers) is resolved by the server from the organisation's own
// listing; the preview shows how many people and first names, never
// addresses. Approved templates come from the server ({name} and {listing}
// are filled in per person). "Send me a test" reaches only the sender. Each
// compose has one idempotency key, so a double click or retry sends once.
type ListingOption = { listingType: MessageListingType; listingId: string; name: string };
type SentMessage = Awaited<ReturnType<typeof fetchVendorMessages>>[number];

function listingOptions(listings: { centres: VendorListingSummary[]; clubs: VendorListingSummary[] }): ListingOption[] {
  return [
    ...listings.centres.map((c) => ({ listingType: "centre" as const, listingId: c.id, name: c.name })),
    ...listings.clubs.map((c) => ({ listingType: "club" as const, listingId: c.id, name: c.name })),
  ];
}

const TYPE_NOUN: Record<MessageListingType, string> = { centre: "Hall", club: "Club", program: "Programme", experience: "Event or experience" };
const newKey = () => `msg-${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

function useSentMessages() {
  const [sent, setSent] = useState<SentMessage[]>([]);
  const [failed, setFailed] = useState(false);
  const load = () =>
    fetchVendorMessages()
      .then((rows) => {
        setSent(rows);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  useEffect(() => {
    load();
  }, []);
  return { sent, failed, load };
}

/** "12 people · in the app 5 sent · email 10 sent, 2 failed" — counts only. */
export function deliveryLine(m: Pick<SentMessage, "recipientCount" | "delivery">): string {
  const parts: string[] = [];
  if (typeof m.recipientCount === "number") parts.push(`${m.recipientCount} ${m.recipientCount === 1 ? "person" : "people"}`);
  const label: Record<string, string> = { sent: "sent", failed: "failed", queued: "waiting", sending: "sending", held_test_environment: "held (test site)", skipped_no_transport: "not sent (email off)", skipped_no_email: "no email" };
  for (const [channel, counts] of Object.entries(m.delivery ?? {})) {
    const bits = Object.entries(counts).map(([st, n]) => `${n} ${label[st] ?? st}`);
    if (bits.length) parts.push(`${channel === "in_app" ? "in the app" : "email"} ${bits.join(", ")}`);
  }
  return parts.join(" · ");
}

/** Listing (unless locked), audience, template, subject, message, preview, test and send. */
function ComposerFields({ options, locked, onSent }: { options: ListingOption[]; locked: boolean; onSent: (summary: string) => void }) {
  const [extra, setExtra] = useState<ListingOption[]>([]);
  const [extraLoaded, setExtraLoaded] = useState(locked);
  const all = useMemo(() => [...options, ...extra], [options, extra]);
  const [target, setTarget] = useState(options[0] ? `${options[0].listingType}:${options[0].listingId}` : "");
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [templateKey, setTemplateKey] = useState("custom");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sessions, setSessions] = useState<{ id: string; label: string }[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [date, setDate] = useState("");
  const [filter, setFilter] = useState<NonNullable<MessageAudience["filter"]>>("all");
  const [preview, setPreview] = useState<MessagePreview | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"test" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(newKey);
  const targetOption = all.find((o) => `${o.listingType}:${o.listingId}` === target);

  // The organisation's programmes and experiences/events (the dashboard list holds halls and clubs only).
  useEffect(() => {
    if (locked) return;
    Promise.all([fetchVendorPrograms().catch(() => []), fetchVendorExperiences().catch(() => [])]).then(([programs, experiences]) => {
      setExtra([
        ...programs.filter((p) => p.status !== "archived").map((p) => ({ listingType: "program" as const, listingId: p.id, name: p.title })),
        ...experiences.filter((e) => e.status !== "deleted").map((e) => ({ listingType: "experience" as const, listingId: e.id, name: e.title })),
      ]);
      setExtraLoaded(true);
    });
  }, [locked]);
  // With no hall or club, start on the first programme or event once they load.
  useEffect(() => {
    if (!target && all[0]) setTarget(`${all[0].listingType}:${all[0].listingId}`);
  }, [all, target]);
  useEffect(() => {
    fetchMessageTemplates().then((r) => setTemplates(r.templates)).catch(() => setTemplates([]));
  }, []);
  // Sessions to narrow to, for events/experiences and programmes.
  useEffect(() => {
    setSessions([]);
    setSessionId("");
    setDate("");
    if (!targetOption) return;
    const label = (d: { date: string; time: string }) => `${formatDate(d.date)} · ${d.time}`;
    if (targetOption.listingType === "experience")
      fetchVendorExperienceSessions(targetOption.listingId).then((rows) => setSessions(rows.map((x) => ({ id: x.id, label: label(x) })))).catch(() => undefined);
    if (targetOption.listingType === "program")
      fetchVendorProgram(targetOption.listingId).then((p) => setSessions((p.sessions ?? []).map((x) => ({ id: x.id, label: label(x) })))).catch(() => undefined);
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  const audience = (): MessageAudience | null =>
    targetOption ? { listingType: targetOption.listingType, listingId: targetOption.listingId, sessionId: sessionId || null, date: date || null, filter } : null;
  useEffect(() => {
    const a = audience();
    setPreview(null);
    setPreviewError(false);
    if (!a) return;
    previewVendorMessage(a).then(setPreview).catch(() => setPreviewError(true));
  }, [target, sessionId, date, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyTemplate = (key: string) => {
    setTemplateKey(key);
    const t = templates.find((x) => x.key === key);
    if (!t || key === "custom") return;
    setSubject(t.subject);
    setBody(t.body);
  };

  const test = async () => {
    const a = audience();
    if (!a) return;
    setBusy("test");
    setError(null);
    try {
      const r = await sendTestVendorMessage({ audience: a, subject, body });
      setNote(r.sent === "sent" ? `Test sent to ${r.to} only.` : `Test prepared for ${r.to} — email isn't switched on here, so nothing was delivered.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send the test");
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    const a = audience();
    if (!a) return;
    const r = await sendVendorMessage({ audience: a, templateKey, subject: subject.trim(), body: body.trim(), idempotencyKey: idemKey });
    setConfirming(false);
    setSubject("");
    setBody("");
    setTemplateKey("custom");
    setIdemKey(newKey());
    onSent(`${r.duplicate ? "Already sent" : "Sent"}: ${deliveryLine({ recipientCount: r.recipientCount, delivery: r.delivery })}.`);
  };

  const ready = !!targetOption && subject.trim() && body.trim();
  if (extraLoaded && all.length === 0) return <p className="adm-note">You need an approved listing before you can message participants.</p>;
  const listingName = targetOption?.name ?? "";
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && preview && preview.recipients > 0) setConfirming(true);
      }}
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      {!locked && (
        <FormField label="Listing">
          {(p) => (
            <select {...p} className="adm-select" value={target} onChange={(e) => setTarget(e.target.value)}>
              {all.map((o) => (
                <option key={`${o.listingType}:${o.listingId}`} value={`${o.listingType}:${o.listingId}`}>
                  {TYPE_NOUN[o.listingType]}: {o.name}
                </option>
              ))}
            </select>
          )}
        </FormField>
      )}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {targetOption?.listingType === "centre" && (
          <FormField label="Booking date (optional)">
            {(p) => <input {...p} type="date" className="adm-input" value={date} onChange={(e) => setDate(e.target.value)} />}
          </FormField>
        )}
        {sessions.length > 0 && (
          <FormField label="Date (optional)">
            {(p) => (
              <select {...p} className="adm-select" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                <option value="">All dates</option>
                {sessions.map((x) => (
                  <option key={x.id} value={x.id}>{x.label}</option>
                ))}
              </select>
            )}
          </FormField>
        )}
        <FormField label="Who">
          {(p) => (
            <select {...p} className="adm-select" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option value="all">Everyone with a confirmed booking</option>
              <option value="checked_in">Only people checked in</option>
              <option value="not_checked_in">Only people not checked in</option>
              <option value="waiting_answers">Only people we're waiting on for answers</option>
            </select>
          )}
        </FormField>
      </div>
      <p role="status" className="adm-note" style={{ margin: 0 }} data-testid="message-preview">
        {previewError
          ? "Couldn't work out who this goes to."
          : !preview
            ? "Working out who this goes to…"
            : preview.recipients === 0
              ? "Nobody matches yet."
              : `Goes to ${preview.recipients} ${preview.recipients === 1 ? "person" : "people"} (${preview.inApp} also in the app): ${preview.sample.join(", ")}${preview.more ? ` and ${preview.more} more` : ""}.${preview.emailHeldBack ? ` On this test site, ${preview.emailHeldBack} email${preview.emailHeldBack === 1 ? " is" : "s are"} held back.` : ""}`}
      </p>
      {templates.length > 0 && (
        <FormField label="Template">
          {(p) => (
            <select {...p} className="adm-select" value={templateKey} onChange={(e) => applyTemplate(e.target.value)}>
              {templates.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          )}
        </FormField>
      )}
      <FormField label="Subject" required>
        {(p) => <input {...p} className="adm-input" value={subject} onChange={(e) => setSubject(e.target.value)} />}
      </FormField>
      <FormField label="Message" required>
        {(p) => <textarea {...p} className="adm-input" rows={7} value={body} onChange={(e) => setBody(e.target.value)} style={{ resize: "vertical" }} />}
      </FormField>
      <p className="adm-note" style={{ margin: 0 }}>{"{name}"} becomes each person's first name and {"{listing}"} becomes {listingName || "the listing name"}. Replace anything in [brackets]. Email addresses are never shown to you or to other participants.</p>
      {note && <p role="status" className="adm-note" style={{ margin: 0 }}>{note}</p>}
      {error && (
        <p role="alert" className="adm-field-error" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <AdminButton type="submit" variant="primary" disabled={!ready || !preview || preview.recipients === 0}>
          Review and send
        </AdminButton>
        <AdminButton onClick={test} disabled={!ready || busy === "test"} aria-busy={busy === "test" || undefined}>
          {busy === "test" ? "Sending test…" : "Send me a test"}
        </AdminButton>
      </div>
      <ConfirmDialog
        open={confirming}
        title={`Send to ${preview?.recipients ?? 0} ${preview?.recipients === 1 ? "person" : "people"}?`}
        message={`"${subject.trim()}" goes to the people booked on ${listingName}${preview?.inApp ? `, ${preview.inApp} of them also in the app` : ""}. This can't be undone.`}
        confirmLabel="Send"
        cancelLabel="Not yet"
        onConfirm={send}
        onCancel={() => setConfirming(false)}
      />
    </form>
  );
}

function SentList({ sent, failed, onRetry, names }: { sent: SentMessage[]; failed: boolean; onRetry: () => void; names?: Map<string, string> }) {
  if (failed)
    return (
      <p role="alert" className="adm-note" style={{ padding: 16, margin: 0 }}>
        Couldn't load messages you've already sent.{" "}
        <button type="button" className="adm-linkish" onClick={onRetry}>
          Try again
        </button>
      </p>
    );
  return (
    <ul className="adm-ov-list">
      {sent.slice(0, 20).map((m) => (
        <li key={m.id} className="adm-ov-row ws-q-row">
          <span className="adm-ov-tile">
            <Send size={17} strokeWidth={1.9} aria-hidden="true" />
          </span>
          <div className="adm-ov-main">
            <div className="adm-ov-title">{m.subject}</div>
            <div className="adm-ov-detail">{[names?.get(`${m.listingType}:${m.listingId}`), deliveryLine(m)].filter(Boolean).join(" · ")}</div>
          </div>
          <span className="adm-ov-kind">{formatDate(m.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

// Composer (Tier 3) — a vendor-authored message to everyone with a paid
// booking/registration on one listing. `lockTo` (Host Manage spec §8's
// per-listing workspace) pins it to one listing: used by
// VendorCentreEditPage.tsx/VendorClubEditPage.tsx's own Messages sub-tab.
// The dashboard-wide Messages page opens the same fields in a popup instead.
export function MessageComposer({
  listings,
  lockTo,
}: {
  listings: { centres: VendorListingSummary[]; clubs: VendorListingSummary[] };
  lockTo?: ListingOption;
}) {
  const options = lockTo ? [lockTo] : listingOptions(listings);
  const { sent, failed, load } = useSentMessages();
  const [result, setResult] = useState<string | null>(null);
  if (options.length === 0) return null;
  const sentHere = lockTo ? sent.filter((m) => m.listingType === lockTo.listingType && m.listingId === lockTo.listingId) : sent;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 20 }}>
      <Box title="Message your participants" icon={MessageSquare}>
        <ComposerFields
          options={options}
          locked={Boolean(lockTo)}
          onSent={(summary) => {
            setResult(summary);
            load();
          }}
        />
        {result && (
          <p role="status" style={{ margin: "12px 0 0", fontWeight: 600, color: "var(--color-green-text)" }}>
            {result}
          </p>
        )}
      </Box>
      {(sentHere.length > 0 || failed) && (
        <Box title="Sent" flush>
          <SentList sent={sentHere} failed={failed} onRetry={load} />
        </Box>
      )}
    </div>
  );
}

const KIND_ICON: Record<VendorNotification["kind"], LucideIcon> = {
  booking: CalendarDays,
  registration: Award,
  program: GraduationCap,
  experience: Compass,
};

/** Where a notification's order lives in the partner workspace. */
function notificationLink(n: VendorNotification): string {
  switch (n.kind) {
    case "booking":
      return `/vendor?tab=bookings&record=${encodeURIComponent(`booking:${n.ref}`)}`;
    case "registration":
      return "/vendor?tab=bookings&bsec=registrations";
    case "program":
      return "/vendor?tab=programs";
    case "experience":
      return "/vendor?tab=experiences";
  }
}

export function MessagesTab({
  onRead,
  listings,
  composeOpen,
  onCloseCompose,
}: {
  onRead: () => void;
  listings: { centres: VendorListingSummary[]; clubs: VendorListingSummary[] };
  composeOpen: boolean;
  onCloseCompose: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [notifications, setNotifications] = useState<VendorNotification[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [show, setShow] = useUrlParam<"all" | "unread">("mshow", "all");
  const [section, setSection] = useUrlParam<"inbox" | "sent">("msec", "inbox");
  const { sent, failed: sentFailed, load: loadSent } = useSentMessages();
  const options = listingOptions(listings);
  const names = new Map(options.map((o) => [`${o.listingType}:${o.listingId}`, o.name]));

  const load = () => {
    setLoadFailed(false);
    fetchVendorNotifications()
      .then(setNotifications)
      .catch(() => setLoadFailed(true));
  };
  useEffect(load, []);

  const markRead = async (n: VendorNotification) => {
    if (n.read) return;
    await markVendorNotificationRead(n.id);
    setNotifications((rows) => rows && rows.map((r) => (r.id === n.id ? { ...r, read: 1 } : r)));
    onRead();
  };
  const open = (n: VendorNotification) => {
    markRead(n).catch(() => {});
    navigate(notificationLink(n));
  };
  const unread = (notifications ?? []).filter((n) => !n.read);
  const markAllRead = async () => {
    try {
      await Promise.all(unread.map((n) => markVendorNotificationRead(n.id)));
      setNotifications((rows) => rows && rows.map((r) => ({ ...r, read: 1 })));
      onRead();
    } catch {
      toast.error("Couldn't mark every notification read — try again");
    }
  };
  const rows = (notifications ?? []).filter((n) => show === "all" || !n.read);
  // Select unread notifications to mark them read: the same call as opening one.
  const sel = useRowSelection(rows.filter((n) => !n.read).map((n) => String(n.id)));
  const markSelectedRead = async () => {
    const chosen = rows.filter((n) => sel.has(String(n.id)));
    try {
      await Promise.all(chosen.map((n) => markVendorNotificationRead(n.id)));
      setNotifications((list) => list && list.map((r) => (sel.has(String(r.id)) ? { ...r, read: 1 } : r)));
      sel.clear();
      onRead();
    } catch {
      toast.error("Couldn't mark every selected notification read — try again");
    }
  };

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <IconTabs
        label="Messages"
        value={section}
        onChange={setSection}
        items={[
          { key: "inbox", label: "Notifications", icon: Bell, count: unread.length || undefined },
          { key: "sent", label: "Sent messages", icon: Send },
        ]}
      />
      {section === "inbox" ? (
        <Box
          flush
          title={show === "unread" ? `Unread · ${rows.length}` : "All notifications"}
          actions={
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div className="ws-seg" role="group" aria-label="Show">
                {(["all", "unread"] as const).map((v) => (
                  <button key={v} type="button" aria-pressed={show === v} onClick={() => setShow(v)}>
                    {v === "all" ? "All" : `Unread${unread.length ? ` (${unread.length})` : ""}`}
                  </button>
                ))}
              </div>
              <AdminButton size="sm" disabled={unread.length === 0} onClick={markAllRead}>
                <CheckCheck size={15} aria-hidden="true" /> Mark all read
              </AdminButton>
            </div>
          }
        >
          {loadFailed ? (
            <div style={{ padding: 16 }}>
              <LoadErrorState title="Couldn't load notifications." onRetry={load} />
            </div>
          ) : notifications === null ? (
            <p role="status" className="adm-note" style={{ padding: 16, margin: 0 }}>
              Loading…
            </p>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Bell size={20} />}
              title={show === "unread" ? "No unread notifications" : "No notifications yet"}
              subtitle={show === "unread" ? undefined : "New bookings and registrations will show up here."}
            />
          ) : (
            <>
            <BulkBar sel={sel} noun="notification">
              <AdminButton variant="primary" size="sm" onClick={markSelectedRead}>
                <CheckCheck size={15} aria-hidden="true" /> Mark {sel.count} read
              </AdminButton>
            </BulkBar>
            <ul className="adm-ov-list">
              {rows.map((n) => {
                const Icon = KIND_ICON[n.kind] ?? Bell;
                return (
                  <li key={n.id} className="adm-ov-row ws-note-row ws-note-row--select" data-unread={!n.read || undefined}>
                    <span className="ws-row-check">
                      {!n.read && <input type="checkbox" className="adm-check" checked={sel.has(String(n.id))} onChange={() => sel.toggle(String(n.id))} aria-label={`Select ${n.title}`} />}
                    </span>
                    <span className="adm-ov-tile">
                      <Icon size={17} strokeWidth={1.9} aria-hidden="true" />
                    </span>
                    <button type="button" className="btn-reset adm-ov-main ws-note-main" onClick={() => open(n)}>
                      <span className="adm-ov-title">
                        {!n.read && <span className="ws-dot" aria-label="Unread" />}
                        {n.title}
                      </span>
                      <span className="adm-ov-detail">
                        {[names.get(`${n.listingType}:${n.listingId}`), n.body].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                    <span className="adm-ov-kind" title={formatDate(n.createdAt)}>
                      {agoLabel(n.createdAt)}
                    </span>
                    <span className="adm-ov-kind">Ref {n.ref}</span>
                    <RowMenu
                      name={n.title}
                      items={[{ label: "Open", onSelect: () => open(n) }, ...(!n.read ? [{ label: "Mark read", onSelect: () => void markRead(n).catch(() => toast.error("Couldn't mark it read — try again")) }] : [])]}
                      copy={{ value: n.ref }}
                    />
                  </li>
                );
              })}
            </ul>
            </>
          )}
        </Box>
      ) : (
        <Box flush title="Sent messages" subtitle="What you've sent to people with a paid booking.">
          {sent.length === 0 && !sentFailed ? (
            <EmptyState icon={<Send size={20} />} title="Nothing sent yet" subtitle="Use New message to write to everyone booked on a listing." />
          ) : (
            <SentList sent={sent} failed={sentFailed} onRetry={loadSent} names={names} />
          )}
        </Box>
      )}

      <AdminModal open={composeOpen} onClose={onCloseCompose} title="New message" subtitle="Goes to the people booked on the listing you choose — in the app for signed-in residents, and by email." wide>
        {/* Final validation: halls and clubs come from the dashboard; programmes and
            events/experiences load inside the composer, so it renders either way. */}
        <ComposerFields
          options={options}
          locked={false}
          onSent={(summary) => {
            toast.success(summary);
            loadSent();
            onCloseCompose();
          }}
        />
      </AdminModal>
    </div>
  );
}
