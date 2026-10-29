import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { ApiError, assignCheckinStaff, fetchAttendanceSummary, fetchCheckinStaff, fetchExperienceAttendees, revokeCheckinStaff } from "../../api";
import { Button, Card, EmptyState, LoadErrorState, PageSpinner, RouteLinkButton, inputStyle } from "../ui";
import { FieldLabel } from "../form";
import { DetailStats } from "../workspace/DetailParts";
import { UsersIcon } from "../icons";
import { colors } from "../../theme";
import { dateLabel } from "../../euro";
import { irelandToday } from "../../irelandDate";
import { optionNote, plural } from "./attendeeSlots";
import type { AttendanceSummaryRow, CheckinStaffAssignment, VendorAttendeeBooking } from "../../types";

// Participation Phase 2 — the partner's Attendees tab for an experience or
// event: the attendance summary per date, every person with their type,
// guardian, option and answers, who has checked in, and who may check people
// in at the door. Reached only by the owner and the two manager roles (the
// Experiences tab's own roles), which are also the roles the server allows
// for the attendee list (ROSTER_ROLES) and for assigning check-in staff.

const PAYMENT_LABEL: Record<string, string> = { paid: "Paid", refunded: "Refunded", pending: "Payment not finished" };

export function AttendeesPanel({ experienceId, checkinOn }: { experienceId: string; checkinOn: boolean }) {
  const [summary, setSummary] = useState<AttendanceSummaryRow[] | null>(null);
  const [sessionId, setSessionId] = useState<string>("");
  const [data, setData] = useState<{ bookings: VendorAttendeeBooking[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const today = irelandToday();

  const load = () => {
    setFailed(false);
    Promise.all([fetchAttendanceSummary(experienceId), fetchExperienceAttendees(experienceId, sessionId || undefined)])
      .then(([s, a]) => {
        setSummary(s.sessions);
        setData(a);
      })
      .catch(() => setFailed(true));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [experienceId, sessionId]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = data?.bookings ?? [];
    if (!q) return list;
    return list.filter((b) => b.ref.toLowerCase().includes(q) || b.participantName.toLowerCase().includes(q) || b.attendees.some((a) => a.name.toLowerCase().includes(q)));
  }, [data, query]);

  if (failed) return <LoadErrorState title="Couldn't load the attendees" onRetry={load} />;
  if (!summary || !data) return <PageSpinner />;

  const rows = sessionId ? summary.filter((s) => s.sessionId === sessionId) : summary;
  const sum = (k: keyof Pick<AttendanceSummaryRow, "people" | "adults" | "children" | "checkedIn" | "bookings">) => rows.reduce((n, s) => n + s[k], 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <DetailStats
        label="Attendance"
        items={[
          { label: "Bookings", value: String(sum("bookings")) },
          { label: "People", value: String(sum("people")), sub: `${plural(sum("adults"), "adult", "adults")} · ${plural(sum("children"), "child", "children")}` },
          { label: "Checked in", value: String(sum("checkedIn")), sub: `${Math.max(0, sum("people") - sum("checkedIn"))} not arrived` },
        ]}
      />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ minWidth: 220 }}>
          <FieldLabel htmlFor="att-session">Date</FieldLabel>
          <select id="att-session" value={sessionId} onChange={(e) => setSessionId(e.target.value)} style={inputStyle}>
            <option value="">All dates</option>
            {summary.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {dateLabel(s.date)} · {s.time} — {s.people} people{s.status === "cancelled" ? " (cancelled)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: "1 1 220px" }}>
          <FieldLabel htmlFor="att-search">Search</FieldLabel>
          <input id="att-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or reference" style={inputStyle} />
        </div>
        {checkinOn && rows.filter((s) => s.date === today && s.status !== "cancelled").map((s) => (
          <RouteLinkButton key={s.sessionId} to={`/vendor/door/${s.sessionId}`}>Open door mode · {s.time}</RouteLinkButton>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={<UsersIcon size={20} />} title={query ? "Nobody matches that search" : "No bookings yet"} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {shown.map((b) => <AttendeeBookingCard key={b.ref} booking={b} />)}
        </div>
      )}

      {checkinOn && <CheckinStaffSection experienceId={experienceId} sessions={summary} />}
    </div>
  );
}

function AttendeeBookingCard({ booking: b }: { booking: VendorAttendeeBooking }) {
  const inactive = b.status === "cancelled" || b.paymentStatus !== "paid";
  const bookingAnswers = b.answers.filter((a) => a.attendeeNo === 0);
  const arrived = b.attendees.filter((a) => a.status === "active" && a.checkedInAt).length;
  const active = b.attendees.filter((a) => a.status === "active");
  return (
    <Card style={{ padding: 14, opacity: inactive ? 0.75 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <Link to={`/vendor/orders/experience/${encodeURIComponent(b.ref)}`} style={{ fontSize: 14.5, fontWeight: 700, color: "inherit" }}>{b.participantName}</Link>
          <span style={{ fontSize: 13, color: colors.muted }}> · {b.ref} · {dateLabel(b.date)} {b.time}</span>
          <div style={{ fontSize: 13, color: colors.muted }}>{[b.email, b.phone].filter(Boolean).join(" · ")}</div>
        </div>
        <div style={{ fontSize: 13, textAlign: "right" }}>
          <div>{b.status === "cancelled" ? "Cancelled" : PAYMENT_LABEL[b.paymentStatus] ?? b.paymentStatus}</div>
          <div style={{ color: colors.muted }}>{arrived} of {active.length} checked in</div>
        </div>
      </div>
      {b.issues.length > 0 && (
        <p role="note" style={{ margin: "8px 0 0", fontSize: 13, color: colors.orangeDark }}>Head count doesn't add up: {b.issues.join("; ")}</p>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "flex", flexDirection: "column", gap: 6 }}>
        {b.attendees.map((a) => {
          const answers = b.answers.filter((x) => x.attendeeNo === a.attendeeNo);
          return (
            <li key={a.attendeeNo} style={{ fontSize: 13.5, background: colors.bg, borderRadius: "var(--radius-control)", padding: "8px 10px", textDecoration: a.status === "removed" ? "line-through" : undefined }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span>
                  <strong>{a.name}</strong> · {a.personType === "child" ? "Child" : "Adult"}
                  {optionNote(a.lineLabel, a.personType) ? ` · ${optionNote(a.lineLabel, a.personType)}` : ""}
                  {a.guardianName ? ` · looked after by ${a.guardianName}` : ""}
                  {!a.recorded ? " · from seat names" : ""}
                </span>
                <span style={{ color: a.checkedInAt ? colors.greenText : colors.muted }}>
                  {a.status === "removed" ? "Removed" : a.checkedInAt ? `Checked in ${new Date(a.checkedInAt).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })}` : "Not checked in"}
                </span>
              </div>
              {answers.length > 0 && (
                <dl style={{ margin: "4px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px", fontSize: 13, color: colors.muted }}>
                  {answers.map((x) => (
                    <div key={x.key} style={{ display: "contents" }}>
                      <dt>{x.label}</dt>
                      <dd style={{ margin: 0, color: colors.text }}>{x.display ?? (x.inputType === "checkbox" ? "Yes" : x.value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
      </ul>
      {bookingAnswers.length > 0 && (
        <dl style={{ margin: "8px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px", fontSize: 13, color: colors.muted }}>
          {bookingAnswers.map((x) => (
            <div key={x.key} style={{ display: "contents" }}>
              <dt>{x.label}</dt>
              <dd style={{ margin: 0, color: colors.text }}>{x.display ?? (x.inputType === "checkbox" ? "Yes" : x.value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

function CheckinStaffSection({ experienceId, sessions }: { experienceId: string; sessions: AttendanceSummaryRow[] }) {
  const [data, setData] = useState<{ assignments: CheckinStaffAssignment[]; members: { id: string; name: string; email: string }[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [userId, setUserId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const load = () => {
    setFailed(false);
    fetchCheckinStaff(experienceId).then(setData).catch(() => setFailed(true));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [experienceId]);
  if (failed) return <LoadErrorState title="Couldn't load check-in staff" onRetry={load} />;
  if (!data) return null;
  const assign = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await assignCheckinStaff(experienceId, userId, sessionId || null);
      setMessage("Assigned.");
      setUserId("");
      load();
    } catch (e) {
      setMessage(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't assign");
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (a: CheckinStaffAssignment) => {
    setBusy(true);
    try {
      await revokeCheckinStaff(experienceId, a.id);
      setMessage(`${a.name} can no longer check people in${a.date ? ` on ${dateLabel(a.date)}` : " for this listing"}.`);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Couldn't remove");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="checkin-staff-h" style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 18 }}>
      <h2 id="checkin-staff-h" style={{ fontSize: 16, margin: "0 0 4px" }}>Check-in staff</h2>
      <p style={{ margin: "0 0 12px", fontSize: 13.5, color: colors.muted, lineHeight: 1.5 }}>
        Team members with the <strong>Check-in only</strong> role can check people in for the dates you assign here. They see names, who has arrived and answers marked for the door — never payments or contact details. Managers can always check people in.
      </p>
      {data.assignments.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          {data.assignments.map((a) => (
            <li key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", fontSize: 13.5, background: colors.bg, borderRadius: "var(--radius-control)", padding: "8px 10px", flexWrap: "wrap" }}>
              <span>{a.name} · {a.date ? `${dateLabel(a.date)} ${a.time}` : "All dates"}</span>
              <Button variant="ghost" disabled={busy} onClick={() => revoke(a)} aria-label={`Remove ${a.name}${a.date ? ` from ${a.date}` : ""}`}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      {data.members.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13.5, color: colors.muted }}>Nobody in your organisation has the Check-in only role yet. Invite them under Organisation → Staff.</p>
      ) : (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ minWidth: 200 }}>
            <FieldLabel htmlFor="cs-user">Team member</FieldLabel>
            <select id="cs-user" value={userId} onChange={(e) => setUserId(e.target.value)} style={inputStyle}>
              <option value="">Choose…</option>
              {data.members.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.email})</option>)}
            </select>
          </div>
          <div style={{ minWidth: 200 }}>
            <FieldLabel htmlFor="cs-session">Dates</FieldLabel>
            <select id="cs-session" value={sessionId} onChange={(e) => setSessionId(e.target.value)} style={inputStyle}>
              <option value="">All dates</option>
              {sessions.filter((s) => s.status !== "cancelled").map((s) => <option key={s.sessionId} value={s.sessionId}>{dateLabel(s.date)} · {s.time}</option>)}
            </select>
          </div>
          <Button onClick={assign} disabled={!userId || busy}>Assign</Button>
        </div>
      )}
      {message && <p role="status" style={{ margin: "10px 0 0", fontSize: 13.5, color: colors.muted }}>{message}</p>}
    </section>
  );
}
