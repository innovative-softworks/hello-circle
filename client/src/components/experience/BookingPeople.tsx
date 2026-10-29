import { useEffect, useState } from "react";
import { ApiError, fetchOrderRegistration, saveOrderAnswers } from "../../api";
import { Button } from "../ui";
import { FormErrorSummary, useFormErrors } from "../form";
import { colors, radius } from "../../theme";
import type { AnswerValue, OrderAttendance, OrderRegistration, OrderSource, RegistrationQuestion } from "../../types";
import { QuestionInput, type AnswersDraft } from "./AttendeeFields";
import { answerLabel, appliesTo, missingAnswers, optionNote, questionFieldId } from "./attendeeSlots";

// Participation Phase 2, Phase I — My Life booking page: who is taking part,
// the answers given (with the question as it was asked and the form version),
// attendance, and what still needs an answer. Any booking type: an
// experience's group, a club's registrant, a programme's participant, or a
// hall booking's once-per-booking answers. Only the booker's device or
// resident account can load it (server). Answers can be changed where the
// organiser's form and the booking allow it; an answer marked "can't be
// changed after booking" stays as given. The organiser reads, never edits.

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" });
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "short" });

const TITLE: Record<OrderSource, string> = { experience: "Who's coming", registration: "Your registration", program: "Your enrolment", booking: "Your booking details" };

function attendanceText(a: OrderAttendance): string | null {
  if (a.kind === "order") return a.status === "attended" ? `Checked in ${a.checkedInAt ? `${dayOf(a.checkedInAt)} · ${timeOf(a.checkedInAt)}` : ""}`.trim() : a.status === "no_show" ? "Marked as not attended" : null;
  if (a.kind === "sessions") return a.sessionsTotal ? `Attended ${a.sessionsAttended ?? 0} of ${a.sessionsTotal} sessions so far` : null;
  return null;
}

export function BookingPeople({ bookingRef, source = "experience" }: { bookingRef: string; source?: OrderSource }) {
  const [d, setD] = useState<OrderRegistration | null>(null);
  const [editing, setEditing] = useState(false);
  const load = () => fetchOrderRegistration(source, bookingRef).then(setD).catch(() => setD(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(), [bookingRef, source]);
  if (!d) return null;
  const people = d.attendees.filter((a) => a.status === "active");
  const anyCheckin = people.some((a) => a.checkedInAt);
  const attendance = attendanceText(d.attendance);
  // Nothing new to show: no form, no answers, no attendance and (for an experience) one person booked before attendee details.
  const nothing = d.answers.length === 0 && d.questions.length === 0 && !anyCheckin && !attendance;
  if (nothing && (source !== "experience" || (!people.some((a) => a.recorded) && people.length <= 1))) return null;
  const bookingAnswers = d.answers.filter((a) => a.attendeeNo === 0);
  const show = (a: { inputType: string; value: string; display?: string }) => a.display ?? (a.inputType === "checkbox" ? "Yes" : a.value);
  const locked = (key: string, no: number) => d.lockedAnswers.some((l) => l.key === key && l.attendeeNo === no);
  const answerRow = (a: (typeof d.answers)[number]) => (
    <div key={`${a.attendeeNo}-${a.key}`} style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>
      {answerLabel(a.label)}
      <span style={{ color: colors.text }}>{show(a)}</span>
      {locked(a.key, a.attendeeNo) && <span style={{ marginLeft: 6, fontSize: 12 }}>· can't be changed</span>}
    </div>
  );
  const versions = d.answeredVersions;
  const showPeople = source === "experience" || people.length > 0;

  return (
    <section aria-labelledby="bp-title" style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 id="bp-title" style={{ fontSize: 17, margin: 0 }}>{TITLE[source]}</h2>
        {anyCheckin && <span style={{ fontSize: 13, color: colors.greenText, fontWeight: 700 }}>{people.filter((p) => p.checkedInAt).length} of {people.length} checked in</span>}
        {attendance && <span style={{ fontSize: 13, color: d.attendance.status === "no_show" ? colors.muted : colors.greenText, fontWeight: 700 }}>{attendance}</span>}
      </div>
      {d.missingAnswers.length > 0 && !editing && (
        <p role="status" style={{ margin: "10px 0 0", fontSize: 13.5, color: colors.orangeDark, fontWeight: 600 }}>
          Needs your attention — the organiser is waiting for: {d.missingAnswers.join("; ")}.
        </p>
      )}
      {editing ? (
        <EditAnswers details={d} source={source} onDone={(next) => { if (next) setD(next); setEditing(false); }} />
      ) : (
        <>
          {showPeople && (
            <ul data-testid="booking-people" style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {people.map((p) => (
                <li key={p.attendeeNo} style={{ background: colors.bg, borderRadius: radius.control, padding: "10px 12px", fontSize: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <span>
                      <strong>{p.name}</strong>
                      <span style={{ color: colors.muted }}>
                        {" · "}{p.personType === "child" ? "Child" : "Adult"}
                        {optionNote(p.lineLabel, p.personType) ? ` · ${optionNote(p.lineLabel, p.personType)}` : ""}
                        {p.guardianName ? ` · with ${p.guardianName}` : ""}
                      </span>
                    </span>
                    {d.attendance.kind === "door" && <span style={{ fontSize: 13, color: p.checkedInAt ? colors.greenText : colors.muted }}>{p.checkedInAt ? `Checked in ${timeOf(p.checkedInAt)}` : "Not checked in yet"}</span>}
                  </div>
                  {d.answers.filter((a) => a.attendeeNo === p.attendeeNo).map(answerRow)}
                </li>
              ))}
            </ul>
          )}
          {bookingAnswers.length > 0 && <div style={{ margin: "10px 0 0", fontSize: 13.5 }}>{bookingAnswers.map(answerRow)}</div>}
          {versions.length > 0 && (
            <p style={{ margin: "10px 0 0", fontSize: 12.5, color: colors.muted }}>
              Answered on form version {versions.join(" and ")}.
              {d.questionsVersion > Math.max(...versions) ? ` The organiser has since updated the form (version ${d.questionsVersion}); your answers are kept as you gave them.` : ""}
            </p>
          )}
          {d.canEditAnswers ? (
            <div style={{ marginTop: 12 }}>
              <Button variant="ghost" onClick={() => setEditing(true)}>{d.missingAnswers.length ? "Answer now" : "Change answers"}</Button>
            </div>
          ) : (
            d.editNote && d.answers.length > 0 && <p style={{ margin: "10px 0 0", fontSize: 12.5, color: colors.muted }}>{d.editNote}, so these answers can't be changed.</p>
          )}
        </>
      )}
    </section>
  );
}

function EditAnswers({ details: d, source, onDone }: { details: OrderRegistration; source: OrderSource; onDone: (next: OrderRegistration | null) => void }) {
  const people = d.attendees.filter((a) => a.status === "active");
  const initial = (): AnswersDraft => {
    const v = (a: { inputType: string; value: string }): AnswerValue => {
      if (a.inputType === "checkbox") return a.value === "yes";
      if (a.inputType === "number") return Number(a.value);
      if (a.inputType === "multi_select") {
        try {
          return JSON.parse(a.value) as string[];
        } catch {
          return [];
        }
      }
      return a.value;
    };
    const booking: Record<string, AnswerValue> = {};
    for (const a of d.answers.filter((x) => x.attendeeNo === 0)) booking[a.key] = v(a);
    const attendees = people.map((p) => Object.fromEntries(d.answers.filter((x) => x.attendeeNo === p.attendeeNo).map((a) => [a.key, v(a)])));
    return { booking, attendees };
  };
  const [answers, setAnswers] = useState<AnswersDraft>(initial);
  const [busy, setBusy] = useState(false);
  const fe = useFormErrors();
  const drafts = people.map((p) => ({ name: p.name, personType: p.personType, guardian: "" as const }));
  const set = (personNo: number, key: string, value: AnswerValue) => {
    fe.clearField(questionFieldId(key, personNo));
    if (personNo === 0) setAnswers((a) => ({ ...a, booking: { ...a.booking, [key]: value } }));
    else setAnswers((a) => ({ ...a, attendees: a.attendees.map((x, i) => (i === personNo - 1 ? { ...x, [key]: value } : x)) }));
  };
  const save = async () => {
    const missing = missingAnswers(d.questions, drafts, answers);
    if (missing.length) return fe.fail(missing.map((m) => ({ field: m.fieldId, fieldId: m.fieldId, message: m.message })));
    setBusy(true);
    try {
      onDone(await saveOrderAnswers(source, d.ref, answers, d.questionsVersion));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        fe.fail([{ field: "answers", message: e.message }]);
      } else fe.fail([{ field: "answers", message: e instanceof Error ? e.message : "Couldn't save your answers" }]);
    } finally {
      setBusy(false);
    }
  };
  const block = (title: string, qs: RegistrationQuestion[], personNo: number, values: Record<string, AnswerValue>) =>
    qs.length > 0 && (
      <div key={`${personNo}`} role="group" aria-label={title} style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: `1px solid ${colors.border}`, paddingTop: 10 }}>
        <strong style={{ fontSize: 14 }}>{title}</strong>
        {qs.map((q) => (
          <QuestionInput
            key={q.key}
            question={q}
            fieldId={questionFieldId(q.key, personNo)}
            value={values[q.key]}
            onChange={(v) => set(personNo, q.key, v)}
            fe={fe}
            // Phase F — an answer marked "can't be changed after booking" stays as given.
            locked={d.lockedAnswers.some((l) => l.key === q.key && l.attendeeNo === personNo)}
          />
        ))}
      </div>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
      <FormErrorSummary errors={fe.errors} focusKey={fe.focusKey} />
      {people.map((p, i) => block(p.name, d.questions.filter((q) => q.scope === "attendee" && appliesTo(q, p.personType)), i + 1, answers.attendees[i] ?? {}))}
      {block("About the booking", d.questions.filter((q) => q.scope === "booking"), 0, answers.booking)}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Button onClick={save} disabled={busy} aria-busy={busy}>{busy ? "Saving…" : "Save answers"}</Button>
        <Button variant="ghost" onClick={() => onDone(null)} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}
