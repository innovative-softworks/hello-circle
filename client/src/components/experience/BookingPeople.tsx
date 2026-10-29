import { useEffect, useState } from "react";
import { ApiError, fetchBookingPeople, saveBookingAnswers } from "../../api";
import { Button } from "../ui";
import { FormErrorSummary, useFormErrors } from "../form";
import { colors, radius } from "../../theme";
import type { AnswerValue, BookingPeopleDetails, RegistrationQuestion } from "../../types";
import { QuestionInput, type AnswersDraft } from "./AttendeeFields";
import { answerLabel, appliesTo, missingAnswers, optionNote, questionFieldId } from "./attendeeSlots";

// Participation Phase 2 — My Life booking page: who is coming, the answers
// given (with the question as it was asked), and who has checked in at the
// door. Only the booker's device or resident account can load it (server).
// Answers can be changed until the start while the organiser asks questions;
// the organiser can read them but never change them.

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" });

export function BookingPeople({ bookingRef }: { bookingRef: string }) {
  const [d, setD] = useState<BookingPeopleDetails | null>(null);
  const [editing, setEditing] = useState(false);
  const load = () => fetchBookingPeople(bookingRef).then(setD).catch(() => setD(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(), [bookingRef]);
  if (!d) return null;
  const people = d.attendees.filter((a) => a.status === "active");
  const anyCheckin = people.some((a) => a.checkedInAt);
  // Nothing new to show for a one-person booking made before attendee details.
  if (!people.some((a) => a.recorded) && d.answers.length === 0 && d.questions.length === 0 && !anyCheckin && people.length <= 1) return null;
  const bookingAnswers = d.answers.filter((a) => a.attendeeNo === 0);
  const show = (a: { inputType: string; value: string; display?: string }) => a.display ?? (a.inputType === "checkbox" ? "Yes" : a.value);

  return (
    <section aria-labelledby="bp-title" style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 id="bp-title" style={{ fontSize: 17, margin: 0 }}>Who's coming</h2>
        {anyCheckin && <span style={{ fontSize: 13, color: colors.greenText, fontWeight: 700 }}>{people.filter((p) => p.checkedInAt).length} of {people.length} checked in</span>}
      </div>
      {d.missingAnswers.length > 0 && !editing && (
        <p role="status" style={{ margin: "10px 0 0", fontSize: 13.5, color: colors.orangeDark }}>
          The organiser has a new question for you: {d.missingAnswers.join("; ")}.
        </p>
      )}
      {editing ? (
        <EditAnswers details={d} onDone={(next) => { if (next) setD(next); setEditing(false); }} />
      ) : (
        <>
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
                  <span style={{ fontSize: 13, color: p.checkedInAt ? colors.greenText : colors.muted }}>{p.checkedInAt ? `Checked in ${timeOf(p.checkedInAt)}` : "Not checked in yet"}</span>
                </div>
                {d.answers.filter((a) => a.attendeeNo === p.attendeeNo).map((a) => (
                  <div key={a.key} style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>{answerLabel(a.label)}<span style={{ color: colors.text }}>{show(a)}</span></div>
                ))}
              </li>
            ))}
          </ul>
          {bookingAnswers.length > 0 && (
            <dl style={{ margin: "10px 0 0", fontSize: 13.5 }}>
              {bookingAnswers.map((a) => (
                <div key={a.key}><dt style={{ display: "inline", color: colors.muted }}>{answerLabel(a.label)}</dt><dd style={{ display: "inline", margin: 0 }}>{show(a)}</dd></div>
              ))}
            </dl>
          )}
          {d.canEditAnswers && (
            <div style={{ marginTop: 12 }}>
              <Button variant="ghost" onClick={() => setEditing(true)}>{d.missingAnswers.length ? "Answer now" : "Change answers"}</Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function EditAnswers({ details: d, onDone }: { details: BookingPeopleDetails; onDone: (next: BookingPeopleDetails | null) => void }) {
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
      onDone(await saveBookingAnswers(d.ref, answers, d.questionsVersion));
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
            locked={q.editability === "locked" && d.answers.some((a) => a.key === q.key && a.attendeeNo === personNo)}
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
