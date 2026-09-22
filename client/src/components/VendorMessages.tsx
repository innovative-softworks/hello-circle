import { useEffect, useState } from "react";
import { fetchVendorMessages, fetchVendorNotifications, markVendorNotificationRead, sendVendorMessage } from "../api";
import { ChatIcon } from "./icons";
import { Button, ManageCard as Card, EmptyState, inputStyle, labelStyle } from "./ui";
import { formatDate } from "../vendorFormat";
import { colors, fonts, radius } from "../theme";
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
export function MessageComposer({
  listings,
  lockTo,
}: {
  listings: { centres: VendorListingSummary[]; clubs: VendorListingSummary[] };
  lockTo?: { listingType: "centre" | "club"; listingId: string; name: string };
}) {
  const options = lockTo
    ? [lockTo]
    : [
        ...listings.centres.map((c) => ({ listingType: "centre" as const, listingId: c.id, name: c.name })),
        ...listings.clubs.map((c) => ({ listingType: "club" as const, listingId: c.id, name: c.name })),
      ];
  const [target, setTarget] = useState(options[0] ? `${options[0].listingType}:${options[0].listingId}` : "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [sent, setSent] = useState<{ id: number; listingType: string; listingId: string; subject: string; body: string; createdAt: string }[]>([]);

  const loadSent = () => fetchVendorMessages().then(setSent).catch(() => {});
  useEffect(() => {
    loadSent();
  }, []);

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
    setResult(null);
    try {
      const res = await sendVendorMessage({ listingType, listingId, subject: subject.trim(), body: body.trim() });
      setResult(`Sent to ${res.recipientCount} ${res.recipientCount === 1 ? "person" : "people"}.`);
      setSubject("");
      setBody("");
      loadSent();
    } catch {
      setResult("You don't have permission to send messages — this needs the communications role.");
    } finally {
      setSending(false);
    }
  };

  if (options.length === 0) return null;
  const sentForThisListing = lockTo ? sent.filter((m) => m.listingType === lockTo.listingType && m.listingId === lockTo.listingId) : sent;

  return (
    <Card style={{ marginBottom: 20 }}>
      <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Message your participants</h4>
      {!lockTo && (
        <>
          <label style={labelStyle}>Listing</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }}>
            {options.map((o) => (
              <option key={`${o.listingType}:${o.listingId}`} value={`${o.listingType}:${o.listingId}`}>{o.name}</option>
            ))}
          </select>
        </>
      )}
      <label style={labelStyle}>Templates</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {MESSAGE_TEMPLATES.map((t) => (
          <button
            key={t.key}
            onClick={() => applyTemplate(t.key)}
            style={{ fontSize: 11.5, fontWeight: 700, color: colors.muted, background: colors.panel, border: "none", borderRadius: radius.pill, padding: "4px 10px", cursor: "pointer" }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <label style={labelStyle}>Subject</label>
      <input value={subject} onChange={(e) => setSubject(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }} />
      <label style={labelStyle}>Message</label>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} style={{ ...inputStyle, resize: "vertical", marginBottom: 12 }} />
      {result && <p style={{ fontSize: 13, color: colors.greenText, fontWeight: 600, margin: "0 0 12px" }}>{result}</p>}
      <Button onClick={send} disabled={sending || !subject.trim() || !body.trim()}>
        {sending ? "Sending…" : "Send to everyone with a paid booking"}
      </Button>

      {sentForThisListing.length > 0 && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${colors.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, marginBottom: 10 }}>SENT</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sentForThisListing.slice(0, 5).map((m) => (
              <div key={m.id} style={{ fontSize: 13, background: colors.bg, borderRadius: radius.control, padding: "8px 12px" }}>
                <strong>{m.subject}</strong>
                <div style={{ color: colors.mutedLight, fontSize: 12, marginTop: 2 }}>{formatDate(m.createdAt)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export function MessagesTab({ onRead, listings }: { onRead: () => void; listings: { centres: VendorListingSummary[]; clubs: VendorListingSummary[] } }) {
  const [notifications, setNotifications] = useState<VendorNotification[]>([]);

  useEffect(() => {
    fetchVendorNotifications().then(setNotifications);
  }, []);

  const markRead = (n: VendorNotification) => {
    if (n.read) return;
    markVendorNotificationRead(n.id).then(() => {
      setNotifications((rows) => rows.map((r) => (r.id === n.id ? { ...r, read: 1 } : r)));
      onRead();
    });
  };

  return (
    <div className="fade-panel">
      <MessageComposer listings={listings} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {notifications.map((n) => (
        <Card
          key={n.id}
          hover
          onClick={() => markRead(n)}
          style={{ padding: 15, display: "flex", gap: 14, alignItems: "flex-start" }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: n.read ? colors.panel : colors.greenBg,
              color: n.read ? colors.muted : colors.green,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none",
            }}
          >
            <ChatIcon size={16} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{n.title}</span>
              {!n.read && <span style={{ width: 7, height: 7, borderRadius: "50%", background: colors.orange, flex: "none" }} />}
            </div>
            <div style={{ fontSize: 13, color: colors.mutedLight, marginTop: 2 }}>{n.body}</div>
            <div style={{ fontSize: 11, color: colors.faint, marginTop: 4 }}>
              {formatDate(n.createdAt)} · Ref {n.ref}
            </div>
          </div>
        </Card>
      ))}
      {notifications.length === 0 && <EmptyState icon={<ChatIcon size={26} />} title="No notifications yet" subtitle="New bookings and registrations will show up here." />}
      </div>
    </div>
  );
}
