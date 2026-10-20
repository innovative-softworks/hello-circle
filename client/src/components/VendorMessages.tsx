import { BulkBar, RowMenu, useRowSelection } from "./admin/adminUi";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Award, Bell, CalendarDays, CheckCheck, Compass, GraduationCap, MessageSquare, Send, type LucideIcon } from "lucide-react";
import { fetchVendorMessages, fetchVendorNotifications, markVendorNotificationRead, sendVendorMessage } from "../api";
import { EmptyState, LoadErrorState } from "./ui";
import { AdminButton, AdminModal, Box, FormField, IconTabs } from "./admin/adminUi";
import { agoLabel } from "./admin/timeLabels";
import { useToast } from "./Toast";
import { useUrlParam } from "../useUrlTab";
import { formatDate } from "../vendorFormat";
import type { VendorListingSummary, VendorNotification } from "../types";

// Notifications feed (new bookings/registrations) + the vendor-authored
// message composer — split out of the original single VendorDashboard.tsx
// (see CLAUDE.md).

// Preset copy (Host Manage spec §13) — plain client-side string templates,
// not a server-managed template system: prefills subject/body with the
// selected listing's name, the vendor edits from there. Attachments stay
// out of scope — sendVendorMessage/vendor_messages have no attachment
// column or upload path, and adding one is a separate feature.
const MESSAGE_TEMPLATES: { key: string; label: string; subject: (name: string) => string; body: (name: string) => string }[] = [
  { key: "reminder", label: "Event reminder", subject: (name) => `Reminder: your session at ${name} is coming up`, body: (name) => `Just a quick reminder that your upcoming session at ${name} is coming up soon — looking forward to seeing you.` },
  { key: "location", label: "Location info", subject: (name) => `How to find ${name}`, body: (name) => `Here's how to find us at ${name}: [add directions, parking, and which entrance to use].` },
  { key: "weather", label: "Weather update", subject: (name) => `Weather update — ${name}`, body: (name) => `A quick weather update ahead of your session at ${name}: [add whether it's still on, moved indoors, etc.].` },
  { key: "cancellation", label: "Cancellation", subject: (name) => `${name} — cancelled`, body: (name) => `Unfortunately we need to cancel your upcoming session at ${name}. [add the reason and any next steps].` },
  { key: "schedule", label: "Schedule change", subject: (name) => `${name} — schedule change`, body: (name) => `There's been a change to the schedule at ${name}: [add the new date/time].` },
];

// Composer (Tier 3) — sendVendorMessage/fetchVendorMessages existed with no
// form anywhere to use them. Distinct from the automatic notification feed
// below: this is a vendor-authored message to everyone with a paid
// booking/registration on one listing. `lockTo` (Host Manage spec §8's
// per-listing workspace) pins the composer to one listing and hides the
// picker — used by VendorCentreEditPage.tsx/VendorClubEditPage.tsx's own
// Messages sub-tab; the dashboard-wide MessagesTab below still passes the
// full `listings` picker.
type ListingOption = { listingType: "centre" | "club"; listingId: string; name: string };
type SentMessage = { id: number; listingType: string; listingId: string; subject: string; body: string; createdAt: string };

function listingOptions(listings: { centres: VendorListingSummary[]; clubs: VendorListingSummary[] }): ListingOption[] {
  return [
    ...listings.centres.map((c) => ({ listingType: "centre" as const, listingId: c.id, name: c.name })),
    ...listings.clubs.map((c) => ({ listingType: "club" as const, listingId: c.id, name: c.name })),
  ];
}

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

/** Listing picker (unless locked), templates, subject, message, send. */
function ComposerFields({ options, locked, onSent }: { options: ListingOption[]; locked: boolean; onSent: (summary: string) => void }) {
  const [target, setTarget] = useState(options[0] ? `${options[0].listingType}:${options[0].listingId}` : "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetOption = options.find((o) => `${o.listingType}:${o.listingId}` === target);

  const applyTemplate = (key: string) => {
    const template = MESSAGE_TEMPLATES.find((t) => t.key === key);
    if (!template || !targetOption) return;
    setSubject(template.subject(targetOption.name));
    setBody(template.body(targetOption.name));
  };

  const send = async () => {
    const [listingType, listingId] = target.split(":") as ["centre" | "club", string];
    if (!listingType || !listingId || !subject.trim() || !body.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await sendVendorMessage({ listingType, listingId, subject: subject.trim(), body: body.trim() });
      setSubject("");
      setBody("");
      onSent(`Sent to ${res.recipientCount} ${res.recipientCount === 1 ? "person" : "people"}.`);
    } catch {
      setError("You don't have permission to send messages — this needs the communications role.");
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      {!locked && (
        <FormField label="Listing">
          {(p) => (
            <select {...p} className="adm-select" value={target} onChange={(e) => setTarget(e.target.value)}>
              {options.map((o) => (
                <option key={`${o.listingType}:${o.listingId}`} value={`${o.listingType}:${o.listingId}`}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </FormField>
      )}
      <div className="adm-field">
        <span>Start from a template</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {MESSAGE_TEMPLATES.map((t) => (
            <button key={t.key} type="button" className="adm-chip ws-fchip" onClick={() => applyTemplate(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <FormField label="Subject" required>
        {(p) => <input {...p} className="adm-input" value={subject} onChange={(e) => setSubject(e.target.value)} />}
      </FormField>
      <FormField label="Message" required>
        {(p) => <textarea {...p} className="adm-input" rows={5} value={body} onChange={(e) => setBody(e.target.value)} style={{ resize: "vertical" }} />}
      </FormField>
      {error && (
        <p role="alert" className="adm-field-error" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <div>
        <AdminButton type="submit" variant="primary" disabled={sending || !subject.trim() || !body.trim()}>
          {sending ? "Sending…" : "Send to everyone with a paid booking"}
        </AdminButton>
      </div>
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
      {sent.slice(0, 10).map((m) => (
        <li key={m.id} className="adm-ov-row ws-q-row">
          <span className="adm-ov-tile">
            <Send size={17} strokeWidth={1.9} aria-hidden="true" />
          </span>
          <div className="adm-ov-main">
            <div className="adm-ov-title">{m.subject}</div>
            <div className="adm-ov-detail">{[names?.get(`${m.listingType}:${m.listingId}`), m.body].filter(Boolean).join(" · ")}</div>
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

      <AdminModal open={composeOpen} onClose={onCloseCompose} title="New message" subtitle="Goes by email to everyone with a paid booking or registration on the listing you pick." wide>
        {options.length === 0 ? (
          <p className="adm-note">You need an approved listing before you can message participants.</p>
        ) : (
          <ComposerFields
            options={options}
            locked={false}
            onSent={(summary) => {
              toast.success(summary);
              loadSent();
              onCloseCompose();
            }}
          />
        )}
      </AdminModal>
    </div>
  );
}
