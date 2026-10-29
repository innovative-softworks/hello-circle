import { inputStyle, labelStyle } from "../ui";
import { FieldError } from "../form";
import { colors, radius } from "../../theme";
import type { AnswerValue, RegistrationQuestion } from "../../types";
import { appliesTo, questionFieldId, questionShown, type PersonDraft, type PersonSlot } from "./attendeeSlots";

// Participation Phase 2 — "Who's coming" in the booking popup: a name for
// each person, adult or child (fixed when the option is for one or the
// other), who looks after each child, and the organiser's questions — per
// person under that person, once-per-booking ones after. Each question shows
// why it's asked; answers the door will see say so.

export type AnswersDraft = { booking: Record<string, AnswerValue>; attendees: Record<string, AnswerValue>[] };

interface Fe {
  control: (id: string) => Record<string, unknown>;
  messageFor: (id: string) => string | undefined;
  clearField: (id: string) => void;
}

export function AttendeeFields({ slots, people, onPeople, questions, answers, onAnswers, contactName, fe }: {
  slots: PersonSlot[];
  people: PersonDraft[];
  onPeople: (p: PersonDraft[]) => void;
  questions: RegistrationQuestion[];
  answers: AnswersDraft;
  onAnswers: (a: AnswersDraft) => void;
  contactName: string;
  fe: Fe;
}) {
  const set = (i: number, patch: Partial<PersonDraft>) => onPeople(people.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const adults = people.map((p, i) => ({ p, no: i + 1 })).filter((x) => x.p.personType === "adult");
  const personQs = questions.filter((q) => q.scope === "attendee");
  const bookingQs = questions.filter((q) => q.scope === "booking");
  const setAnswer = (personNo: number, key: string, v: AnswerValue) => {
    fe.clearField(questionFieldId(key, personNo));
    if (personNo === 0) onAnswers({ ...answers, booking: { ...answers.booking, [key]: v } });
    else {
      const list = people.map((_, i) => ({ ...(answers.attendees[i] ?? {}) }));
      list[personNo - 1][key] = v;
      onAnswers({ ...answers, attendees: list });
    }
  };
  return (
    <fieldset style={{ border: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
      <legend style={{ ...labelStyle, padding: 0, fontSize: 15 }}>Who's coming</legend>
      {people.map((p, i) => {
        const no = i + 1;
        const slot = slots[i];
        const nameId = `exp-person-${no}`;
        return (
          <div key={i} role="group" aria-label={`Person ${no}`} style={{ border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, color: colors.muted, fontWeight: 700 }}>Person {no}{slot?.lineLabel ? ` · ${slot.lineLabel}` : ""}</div>
            <div>
              <label htmlFor={nameId} style={labelStyle}>Name for person {no}</label>
              <input {...fe.control(nameId)} autoComplete="off" value={p.name} onChange={(e) => { fe.clearField(nameId); set(i, { name: e.target.value }); }} style={inputStyle} />
              <FieldError fieldId={nameId} message={fe.messageFor(nameId)} />
            </div>
            {slot?.fixedType ? null : (
              <div role="radiogroup" aria-label={`Is person ${no} an adult or a child?`} style={{ display: "flex", gap: 16, fontSize: 14 }}>
                {(["adult", "child"] as const).map((t) => (
                  <label key={t} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="radio" name={`ptype-${no}`} checked={p.personType === t} onChange={() => set(i, { personType: t, guardian: t === "child" ? p.guardian : "" })} /> {t === "adult" ? "Adult" : "Child (under 18)"}
                  </label>
                ))}
              </div>
            )}
            {p.personType === "child" && (
              <div>
                <label htmlFor={`exp-guardian-${no}`} style={labelStyle}>Who looks after {p.name || `person ${no}`}?</label>
                <select
                  {...fe.control(`exp-guardian-${no}`)}
                  value={p.guardian === "" ? "" : String(p.guardian)}
                  onChange={(e) => { fe.clearField(`exp-guardian-${no}`); set(i, { guardian: e.target.value === "contact" ? "contact" : e.target.value === "" ? "" : Number(e.target.value) }); }}
                  style={inputStyle}
                >
                  <option value="">Choose…</option>
                  <option value="contact">Me{contactName ? ` (${contactName})` : ""}, the person booking</option>
                  {adults.filter((a) => a.no !== no).map((a) => <option key={a.no} value={a.no}>{a.p.name || `Person ${a.no}`}</option>)}
                </select>
                <FieldError fieldId={`exp-guardian-${no}`} message={fe.messageFor(`exp-guardian-${no}`)} />
              </div>
            )}
            <QuestionList
              questions={personQs.filter((q) => appliesTo(q, p.personType) && questionShown(q, answers.booking, answers.attendees[i] ?? {}))}
              render={(q) => <QuestionInput key={q.key} question={q} fieldId={questionFieldId(q.key, no)} value={answers.attendees[i]?.[q.key]} onChange={(v) => setAnswer(no, q.key, v)} fe={fe} />}
            />
          </div>
        );
      })}
      {bookingQs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <QuestionList
            questions={bookingQs.filter((q) => questionShown(q, answers.booking, {}))}
            render={(q) => <QuestionInput key={q.key} question={q} fieldId={questionFieldId(q.key, 0)} value={answers.booking[q.key]} onChange={(v) => setAnswer(0, q.key, v)} fe={fe} />}
          />
        </div>
      )}
    </fieldset>
  );
}

/** Phase G — questions in order, with a heading where a section starts. */
export function QuestionList({ questions, render }: { questions: RegistrationQuestion[]; render: (q: RegistrationQuestion) => JSX.Element }) {
  let last: string | null = null;
  return (
    <>
      {questions.map((q) => {
        const heading = q.section && q.section !== last ? q.section : null;
        last = q.section ?? last;
        return (
          <div key={q.key} style={{ display: "contents" }}>
            {heading && <h3 style={{ fontSize: 14, margin: "6px 0 0", color: colors.text }}>{heading}</h3>}
            {render(q)}
          </div>
        );
      })}
    </>
  );
}

export function QuestionInput({ question: q, fieldId, value: given, onChange, fe, locked = false }: { question: RegistrationQuestion; fieldId: string; value: AnswerValue | undefined; onChange: (v: AnswerValue) => void; fe: Fe; locked?: boolean }) {
  const hintId = `${fieldId}-why`;
  // Phase F — a pre-filled answer shows until the person changes it (and is sent as given).
  const value = given === undefined && q.defaultValue ? (q.inputType === "number" ? Number(q.defaultValue) : q.defaultValue) : given;
  if (q.inputType === "info") {
    return (
      <div role="note" style={{ fontSize: 14, background: colors.panel, borderRadius: radius.control, padding: "10px 12px" }}>
        <strong>{q.label}</strong>
        {q.help && <div style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>{q.help}</div>}
      </div>
    );
  }
  const label = `${q.label}${q.required ? "" : " (optional)"}`;
  const why = (
    <div id={hintId} style={{ fontSize: 12, color: colors.faint, marginTop: 4 }}>
      {q.help ? `${q.help} · ` : ""}Why we ask: {q.purpose}
      {q.doorVisible ? " · Door staff see this answer" : ""}
      {q.editability === "locked" ? " · Can't be changed after booking" : ""}
    </div>
  );
  const control = { ...fe.control(fieldId), disabled: locked, "aria-describedby": [fe.messageFor(fieldId) ? `${fieldId}-error` : null, hintId].filter(Boolean).join(" ") };
  if (q.inputType === "checkbox") {
    return (
      <div>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14 }}>
          <input {...control} type="checkbox" checked={value === true || value === "yes"} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
          <span>{label}</span>
        </label>
        {why}
        <FieldError fieldId={fieldId} message={fe.messageFor(fieldId)} />
      </div>
    );
  }
  if (q.inputType === "radio" || q.inputType === "multi_select") {
    const multi = q.inputType === "multi_select";
    const picked = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
    return (
      <fieldset style={{ border: "none", margin: 0, padding: 0 }} aria-describedby={control["aria-describedby"]} aria-invalid={fe.messageFor(fieldId) ? true : undefined}>
        <legend style={{ ...labelStyle, padding: 0 }} id={fieldId}>{label}</legend>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {q.choices.map((c) => (
            <label key={c} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, minHeight: 28 }}>
              <input
                type={multi ? "checkbox" : "radio"}
                name={fieldId}
                disabled={locked}
                checked={picked.includes(c)}
                onChange={(e) => onChange(multi ? (e.target.checked ? q.choices.filter((x) => x === c || picked.includes(x)) : picked.filter((x) => x !== c)) : c)}
              />
              {c}
            </label>
          ))}
        </div>
        {why}
        <FieldError fieldId={fieldId} message={fe.messageFor(fieldId)} />
      </fieldset>
    );
  }
  const text = typeof value === "string" ? value : value === undefined ? "" : String(value);
  return (
    <div>
      <label htmlFor={fieldId} style={labelStyle}>{label}</label>
      {q.inputType === "select" ? (
        <select {...control} value={text} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
          <option value="">Choose…</option>
          {q.choices.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      ) : q.inputType === "number" ? (
        <input {...control} type="number" inputMode="numeric" min={q.min ?? undefined} max={q.max ?? undefined} placeholder={q.placeholder || undefined} value={text} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} style={inputStyle} />
      ) : q.inputType === "date" ? (
        <input {...control} type="date" value={text} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
      ) : q.inputType === "long_text" ? (
        <textarea {...control} rows={3} minLength={q.minLength ?? undefined} maxLength={q.maxLength ?? 1000} placeholder={q.placeholder || undefined} value={text} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, minHeight: 80 }} />
      ) : (
        <input
          {...control}
          type={q.inputType === "email" ? "email" : q.inputType === "tel" ? "tel" : "text"}
          inputMode={q.inputType === "email" ? "email" : q.inputType === "tel" ? "tel" : undefined}
          autoComplete="off"
          minLength={q.minLength ?? undefined}
          maxLength={q.maxLength ?? 500}
          placeholder={q.placeholder || undefined}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      )}
      {why}
      <FieldError fieldId={fieldId} message={fe.messageFor(fieldId)} />
    </div>
  );
}
