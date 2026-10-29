import { useEffect, useState } from "react";
import {
  ApiError,
  cancelVendorEnrollment,
  cancelVendorExperienceBooking,
  cancelVendorRegistration,
  fetchVendorOrder,
  refundVendorEnrollment,
  refundVendorExperienceBooking,
  refundVendorRegistration,
  type VendorOrderRecord,
} from "../../api";
import { dateLabel } from "../../euro";
import { ConfirmDialog } from "../ui";
import { AdminButton, Badge, Facts, SectionLabel, formatDate } from "../admin/adminUi";
import { answerLabel } from "../experience/attendeeSlots";
import { RecordState, RecordView } from "./RecordView";
import { DetailStats } from "./DetailParts";
import type { OrderAttendance, OrderSource } from "../../types";

// Phase J (docs/participation-expansion/20) — one partner record for any
// booking: status, people, attendance, registration answers (only for the
// people who run the listing; finance sees that answers exist, not what they
// say), notes, the actions this person may take, and the change history.
// The 70/30 record page; no drawer. Reads one endpoint over existing rows.

const TYPE_LABEL: Record<OrderSource, string> = { experience: "Experience booking", registration: "Club registration", program: "Programme enrolment", booking: "Hall booking" };

function attendanceLine(a: OrderAttendance, people: VendorOrderRecord["people"]): string {
  if (a.kind === "door") {
    const active = people.filter((p) => p.status === "active");
    const n = active.filter((p) => p.checkedInAt).length;
    return a.status === "no_show" ? "Marked as not attended" : `${n} of ${active.length} checked in`;
  }
  if (a.kind === "order") return a.status === "attended" ? `Checked in ${formatDate(a.checkedInAt, true)}` : a.status === "no_show" ? "Marked as not attended" : "Not checked in";
  if (a.kind === "sessions") return `${a.sessionsAttended ?? 0} of ${a.sessionsTotal ?? 0} sessions attended${a.sessionsMarked ? ` (${a.sessionsMarked} marked)` : ""}`;
  return "—";
}

const show = (a: { inputType: string; value: string; display?: string }) => a.display ?? (a.inputType === "checkbox" ? "Yes" : a.value);

/** People, answers and history — the body of the record, also embedded in the hall booking record. */
export function OrderRegistrationBody({ record: r }: { record: VendorOrderRecord }) {
  const bookingAnswers = r.answers?.filter((a) => a.attendeeNo === 0) ?? [];
  const versions = r.answers ? [...new Set(r.answers.map((a) => a.version))].sort((a, b) => a - b) : [];
  return (
    <>
      {r.people.length > 0 && (
        <>
          <SectionLabel>{r.source === "experience" ? "People" : "Taking part"}</SectionLabel>
          <ul style={{ listStyle: "none", margin: "0 0 16px", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {r.people.map((p) => (
              <li key={p.attendeeNo} className="adm-box" style={{ padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 14 }}>
                  <span>
                    <strong>{p.name}</strong>
                    <span style={{ color: "var(--adm-muted)" }}>
                      {" · "}{p.personType === "child" ? "Child" : "Adult"}
                      {p.lineLabel ? ` · ${p.lineLabel}` : ""}
                      {p.guardianName ? ` · with ${p.guardianName}` : ""}
                      {p.status === "removed" ? " · removed" : ""}
                    </span>
                  </span>
                  {r.attendance.kind === "door" && <span style={{ fontSize: 13 }}>{p.checkedInAt ? `Checked in ${formatDate(p.checkedInAt, true)}` : "Not checked in"}</span>}
                </div>
                {r.answers?.filter((a) => a.attendeeNo === p.attendeeNo).map((a) => (
                  <div key={a.key} style={{ fontSize: 13, color: "var(--adm-muted)", marginTop: 2 }}>
                    {answerLabel(a.label)}
                    <span style={{ color: "var(--adm-text)" }}>{show(a)}</span>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
      <SectionLabel>Registration answers</SectionLabel>
      {!r.answersVisible ? (
        <p className="adm-note" style={{ marginTop: 0 }}>
          {r.answerCount ? `${r.answerCount} ${r.answerCount === 1 ? "answer" : "answers"} given.` : "No answers given."} Only the managers who run this listing can read them.
        </p>
      ) : r.answers && r.answers.length === 0 ? (
        <p className="adm-note" style={{ marginTop: 0 }}>No answers given{r.questionsVersion ? "" : " — this listing doesn't ask questions"}.</p>
      ) : (
        <>
          {bookingAnswers.length > 0 && (
            <Facts rows={bookingAnswers.map((a) => [a.label, show(a)] as [string, string])} />
          )}
          {versions.length > 0 && (
            <p className="adm-note" style={{ marginTop: 6 }}>
              Answered on form version {versions.join(" and ")}{r.questionsVersion > Math.max(...versions) ? ` · the live form is version ${r.questionsVersion}` : ""}. Answers keep the wording they were given on.
            </p>
          )}
        </>
      )}
      {r.missingAnswers.length > 0 && (
        <p role="status" style={{ fontSize: 13.5, margin: "8px 0 0", color: "var(--adm-warn, #9a5b00)" }}>
          Waiting for: {r.missingAnswers.join("; ")}.
        </p>
      )}
    </>
  );
}

function HistoryList({ items }: { items: VendorOrderRecord["history"] }) {
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6, fontSize: 13.5 }}>
      {items.map((h, i) => (
        <li key={i}>
          <strong style={{ fontWeight: 600 }}>{h.label}</strong>
          <div style={{ color: "var(--adm-muted)", fontSize: 12.5 }}>{formatDate(h.at, true)}</div>
        </li>
      ))}
    </ol>
  );
}

/** Answers + history inside another record (the hall booking record keeps its own page). */
export function OrderRegistrationSection({ source, bookingRef }: { source: OrderSource; bookingRef: string }) {
  const [r, setR] = useState<VendorOrderRecord | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setR(null);
    setFailed(false);
    fetchVendorOrder(source, bookingRef).then(setR).catch(() => setFailed(true));
  }, [source, bookingRef]);
  if (failed) return <p className="adm-note">Couldn't load the registration answers.</p>;
  if (!r) return null;
  if (!r.answersVisible && r.answerCount === 0 && !r.questionsVersion) return null;
  return (
    <div style={{ marginTop: 20 }}>
      <OrderRegistrationBody record={r} />
    </div>
  );
}

/** The full record page for one booking of any type. */
export function OrderRecordView({ source, orderRef, backLabel, onBack }: { source: OrderSource; orderRef: string; backLabel: string; onBack: () => void }) {
  const [r, setR] = useState<VendorOrderRecord | null>(null);
  const [state, setState] = useState<"loading" | "missing" | "restricted" | "error" | "ok">("loading");
  const [confirm, setConfirm] = useState<"cancel" | "refund" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = () => {
    setState("loading");
    fetchVendorOrder(source, orderRef)
      .then((x) => {
        setR(x);
        setState("ok");
      })
      .catch((e) => setState(e instanceof ApiError && e.status === 404 ? "missing" : e instanceof ApiError && e.status === 403 ? "restricted" : "error"));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [source, orderRef]);
  if (state !== "ok" || !r) return <RecordState state={state === "ok" ? "loading" : state} backLabel={backLabel} onBack={onBack} onRetry={load} />;

  const run = async (what: "cancel" | "refund") => {
    if (r.source === "registration") await (what === "cancel" ? cancelVendorRegistration(r.ref) : refundVendorRegistration(r.ref));
    else if (r.source === "program") await (what === "cancel" ? cancelVendorEnrollment(r.listingId, r.orderId!) : refundVendorEnrollment(r.listingId, r.orderId!));
    else if (r.source === "experience") await (what === "cancel" ? cancelVendorExperienceBooking(r.listingId, r.orderId!) : refundVendorExperienceBooking(r.listingId, r.orderId!));
    setConfirm(null);
    setNotice(what === "cancel" ? "Cancelled. The person who booked has been notified." : "Refund issued.");
    load();
  };
  const when = r.date ? `${dateLabel(r.date)}${r.time ? ` · ${r.time}` : ""}` : "Ongoing";
  const statusTone = r.status === "cancelled" ? "bad" : "good";
  return (
    <RecordView
      title={r.people[0]?.name ?? r.contact.name}
      reference={<>{TYPE_LABEL[r.source]} · {r.title} · <span className="adm-mono">{r.ref}</span></>}
      backLabel={backLabel}
      onBack={onBack}
      statuses={
        <>
          <Badge tone={statusTone}>{r.status === "cancelled" ? "Cancelled" : "Confirmed"}</Badge>
          <Badge tone={r.paymentStatus === "paid" ? "good" : r.paymentStatus === "refunded" ? "neutral" : "warn"}>Payment: {r.paymentStatus}</Badge>
          {r.missingAnswers.length > 0 && <Badge tone="warn">Answers missing</Badge>}
        </>
      }
      actions={
        <>
          {r.actions.refund && <AdminButton onClick={() => setConfirm("refund")}>Issue refund</AdminButton>}
          {r.actions.cancel && <AdminButton variant="danger" onClick={() => setConfirm("cancel")}>Cancel</AdminButton>}
        </>
      }
      stats={
        <DetailStats
          items={[
            { label: "When", value: when },
            { label: "People", value: String(r.people.filter((p) => p.status === "active").length || r.partySize) },
            { label: "Attendance", value: attendanceLine(r.attendance, r.people) },
            { label: "Answers", value: r.answersVisible ? String(r.answers?.length ?? 0) : `${r.answerCount} (restricted)` },
          ]}
        />
      }
      aside={
        <>
          <SectionLabel>Contact</SectionLabel>
          <Facts rows={[["Booked by", r.contact.name], ["Email", r.contact.email], ["Phone", r.contact.phone || "—"]]} />
          <SectionLabel>History</SectionLabel>
          <HistoryList items={r.history} />
        </>
      }
    >
      {notice && <p role="status" className="adm-note" style={{ marginTop: 0 }}>{notice}</p>}
      <OrderRegistrationBody record={r} />
      {r.notes && (
        <>
          <SectionLabel>Notes from the booking</SectionLabel>
          <p style={{ margin: 0, fontSize: 14, whiteSpace: "pre-wrap" }}>{r.notes}</p>
        </>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "cancel" ? `Cancel ${r.people[0]?.name ?? r.contact.name}'s ${TYPE_LABEL[r.source].toLowerCase()}?` : `Refund ${r.contact.name}?`}
        message={confirm === "cancel" ? "The person who booked is notified. A payment made online is refunded under your organisation's policy." : "This refunds what's still refundable through Stripe. It can't be undone and doesn't cancel the booking."}
        confirmLabel={confirm === "cancel" ? "Cancel" : "Issue refund"}
        cancelLabel="Keep it"
        onConfirm={() => run(confirm!)}
        onCancel={() => setConfirm(null)}
      />
    </RecordView>
  );
}
