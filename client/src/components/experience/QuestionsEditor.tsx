import { useEffect, useState } from "react";
import { ApiError, fetchExperienceQuestions, saveExperienceQuestions } from "../../api";
import { Button, Card, LoadErrorState, PageSpinner, inputStyle } from "../ui";
import { FieldError, FieldLabel, FormErrorSummary, RequiredNote, useFormErrors, type FormError } from "../form";
import { colors } from "../../theme";
import type { QuestionCategory, QuestionInputType, VendorRegistrationQuestion } from "../../types";

// Participation Phase 2 — the partner's Questions tab: a small visual builder
// for registration questions, asked once per booking or for each person.
// Each question says why it's asked (people see that before answering), and
// questions about health, religion, ethnicity and other sensitive data are
// refused until a privacy policy for them is approved — the server checks the
// category and the wording, this form only explains it. Saving replaces the
// whole set under a version; bookings already made keep the answers they gave,
// with the question as it was worded then.

interface Row extends VendorRegistrationQuestion {
  rowKey: string;
  choicesText: string;
}

const MAX_QUESTIONS = 12;

const TYPES: { value: QuestionInputType; label: string }[] = [
  { value: "text", label: "Short text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Pick one from a list" },
  { value: "checkbox", label: "Tick box" },
];

const CATEGORIES: { value: QuestionCategory; label: string; special?: boolean }[] = [
  { value: "general", label: "General" },
  { value: "logistics", label: "Arrival, transport or kit" },
  { value: "dietary_preference", label: "Food preference (not allergies)" },
  { value: "health", label: "Health, allergies or access needs", special: true },
  { value: "religion", label: "Religion or belief", special: true },
  { value: "ethnicity", label: "Ethnicity", special: true },
  { value: "other_special", label: "Other sensitive information", special: true },
];

const toRow = (q: VendorRegistrationQuestion, i: number): Row => ({ ...q, rowKey: q.key || `new-${i}-${Date.now()}`, choicesText: (q.choices ?? []).join("\n") });

const blank = (): Row => ({
  rowKey: `new-${Math.random().toString(36).slice(2)}`,
  key: "",
  scope: "attendee",
  inputType: "text",
  label: "",
  help: "",
  purpose: "",
  required: false,
  choices: [],
  choicesText: "",
  min: null,
  max: null,
  appliesTo: "all",
  doorVisible: false,
  category: "general",
});

const fid = (r: Row, f: string) => `q-${r.rowKey}-${f}`;

export function QuestionsEditor({ experienceId }: { experienceId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [version, setVersion] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [specialOn, setSpecialOn] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fe = useFormErrors();

  const load = () => {
    setLoadError(false);
    fetchExperienceQuestions(experienceId)
      .then((r) => {
        setRows(r.questions.map(toRow));
        setVersion(r.version);
        setEnabled(r.enabled);
        setSpecialOn(r.specialCategoryEnabled);
        setDirty(false);
      })
      .catch(() => setLoadError(true));
  };
  useEffect(load, [experienceId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loadError) return <LoadErrorState title="Couldn't load the registration questions" onRetry={load} />;
  if (!rows) return <PageSpinner />;

  const update = (key: string, patch: Partial<Row>) => {
    setRows((list) => (list ?? []).map((r) => (r.rowKey === key ? { ...r, ...patch } : r)));
    setDirty(true);
    setNotice(null);
  };
  const move = (i: number, by: number) => {
    const next = [...rows];
    const [r] = next.splice(i, 1);
    next.splice(i + by, 0, r);
    setRows(next);
    setDirty(true);
  };

  const save = async () => {
    const errors: FormError[] = [];
    const payload: VendorRegistrationQuestion[] = rows.map((r, i) => {
      const n = `Question ${i + 1}`;
      if (!r.label.trim()) errors.push({ field: `${n} wording`, fieldId: fid(r, "label"), message: `${n}: write the question` });
      if (!r.purpose.trim()) errors.push({ field: `${n} why`, fieldId: fid(r, "purpose"), message: `${n}: say why you're asking` });
      const choices = r.choicesText.split("\n").map((c) => c.trim()).filter(Boolean);
      if (r.inputType === "select" && choices.length < 2) errors.push({ field: `${n} choices`, fieldId: fid(r, "choices"), message: `${n}: add at least two choices, one per line` });
      const { rowKey: _k, choicesText: _c, ...rest } = r;
      return { ...rest, label: r.label.trim(), purpose: r.purpose.trim(), help: r.help.trim(), choices };
    });
    if (errors.length) return fe.fail(errors);
    fe.clear();
    setSaving(true);
    try {
      const r = await saveExperienceQuestions(experienceId, payload, version);
      setRows(r.questions.map(toRow));
      setVersion(r.version);
      setDirty(false);
      setNotice("Saved. New bookings answer these questions; bookings already made keep the answers they gave.");
    } catch (e) {
      const status = e instanceof ApiError ? e.status : undefined;
      if (status === 409) {
        setNotice("Someone else saved these questions while you were editing. We've loaded their version — make your change again.");
        load();
      } else {
        const m = e instanceof Error ? e.message : "Couldn't save the questions";
        const index = /^Question (\d+)/.exec(m);
        const row = index ? rows[Number(index[1]) - 1] : null;
        fe.fail([{ field: "Questions", fieldId: row ? fid(row, "label") : undefined, message: m }]);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
      <div>
        <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>Registration questions</h2>
        <p style={{ margin: 0, color: colors.muted, fontSize: 14, lineHeight: 1.5 }}>
          Ask only what you need to run the day — for example a name for the badge or how people will arrive. People see why you're asking before they answer, and can change their answers until it starts.
        </p>
      </div>
      {!enabled && (
        <p role="status" style={{ margin: 0, padding: "10px 12px", background: colors.panel, border: `1px solid ${colors.border}`, borderRadius: "var(--radius-control)", fontSize: 13.5 }}>
          Attendee details and questions aren't switched on yet. You can see the questions here, but you can't change them, and nobody is asked them until they are.
        </p>
      )}
      {!specialOn && (
        <p style={{ margin: 0, fontSize: 13, color: colors.muted, lineHeight: 1.5 }}>
          Questions about health, allergies, religion, ethnicity or other sensitive information can't be asked yet — they need an approved privacy policy first.
        </p>
      )}
      <FormErrorSummary errors={fe.errors} focusKey={fe.focusKey} />
      {rows.length > 0 && <RequiredNote style={{ margin: 0 }} />}
      {rows.length === 0 && <p style={{ margin: 0, fontSize: 14, color: colors.muted }}>No questions. People only give their names and who is coming.</p>}
      {rows.map((r, i) => (
        <QuestionCard
          key={r.rowKey}
          row={r}
          index={i}
          count={rows.length}
          disabled={!enabled}
          specialOn={specialOn}
          fe={fe}
          onChange={(p) => update(r.rowKey, p)}
          onRemove={() => {
            setRows(rows.filter((x) => x.rowKey !== r.rowKey));
            setDirty(true);
          }}
          onMove={(by) => move(i, by)}
        />
      ))}
      {enabled && rows.length < MAX_QUESTIONS && (
        <div>
          <Button variant="ghost" onClick={() => { setRows([...rows, blank()]); setDirty(true); }}>Add a question</Button>
        </div>
      )}
      {notice && <p role="status" style={{ margin: 0, fontSize: 13.5, color: colors.muted }}>{notice}</p>}
      {enabled && (
        <div>
          <Button size="lg" onClick={save} disabled={saving || !dirty} aria-busy={saving}>{saving ? "Saving…" : "Save questions"}</Button>
        </div>
      )}
    </div>
  );
}

function QuestionCard({ row, index, count, disabled, specialOn, fe, onChange, onRemove, onMove }: {
  row: Row;
  index: number;
  count: number;
  disabled: boolean;
  specialOn: boolean;
  fe: ReturnType<typeof useFormErrors>;
  onChange: (p: Partial<Row>) => void;
  onRemove: () => void;
  onMove: (by: number) => void;
}) {
  const id = (f: string) => fid(row, f);
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 } as const;
  const name = row.label || `question ${index + 1}`;
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14 }}>Question {index + 1}</strong>
        {!disabled && (
          <div style={{ display: "flex", gap: 6 }}>
            <Button variant="ghost" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move ${name} up`}>Up</Button>
            <Button variant="ghost" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Move ${name} down`}>Down</Button>
            <Button variant="ghost" onClick={onRemove} aria-label={`Remove ${name}`}>Remove</Button>
          </div>
        )}
      </div>
      <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <FieldLabel htmlFor={id("label")} required>Question</FieldLabel>
          <input {...fe.control(id("label"))} value={row.label} maxLength={200} onChange={(e) => onChange({ label: e.target.value })} placeholder="e.g. Name on your badge" style={inputStyle} />
          <FieldError fieldId={id("label")} message={fe.messageFor(id("label"))} />
        </div>
        <div>
          <FieldLabel htmlFor={id("purpose")} required>Why you're asking</FieldLabel>
          <input {...fe.control(id("purpose"))} value={row.purpose} maxLength={300} onChange={(e) => onChange({ purpose: e.target.value })} placeholder="e.g. We print it on your badge" style={inputStyle} />
          <FieldError fieldId={id("purpose")} message={fe.messageFor(id("purpose"))} />
        </div>
        <div style={grid}>
          <div>
            <FieldLabel htmlFor={id("scope")}>Asked</FieldLabel>
            <select id={id("scope")} value={row.scope} onChange={(e) => onChange({ scope: e.target.value as Row["scope"], appliesTo: "all" })} style={inputStyle}>
              <option value="attendee">For each person</option>
              <option value="booking">Once per booking</option>
            </select>
          </div>
          {row.scope === "attendee" && (
            <div>
              <FieldLabel htmlFor={id("applies")}>Who answers</FieldLabel>
              <select id={id("applies")} value={row.appliesTo} onChange={(e) => onChange({ appliesTo: e.target.value as Row["appliesTo"] })} style={inputStyle}>
                <option value="all">Everyone</option>
                <option value="adult">Adults only</option>
                <option value="child">Children only</option>
              </select>
            </div>
          )}
          <div>
            <FieldLabel htmlFor={id("type")}>Answer</FieldLabel>
            <select id={id("type")} value={row.inputType} onChange={(e) => onChange({ inputType: e.target.value as QuestionInputType })} style={inputStyle}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor={id("category")}>About</FieldLabel>
            <select id={id("category")} value={row.category} onChange={(e) => onChange({ category: e.target.value as QuestionCategory })} style={inputStyle}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value} disabled={c.special && !specialOn}>
                  {c.label}{c.special && !specialOn ? " — needs policy approval" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        {row.inputType === "select" && (
          <div>
            <FieldLabel htmlFor={id("choices")} required>Choices (one per line)</FieldLabel>
            <textarea {...fe.control(id("choices"))} value={row.choicesText} rows={4} onChange={(e) => onChange({ choicesText: e.target.value })} style={{ ...inputStyle, minHeight: 90 }} />
            <FieldError fieldId={id("choices")} message={fe.messageFor(id("choices"))} />
          </div>
        )}
        {row.inputType === "number" && (
          <div style={grid}>
            <div>
              <FieldLabel htmlFor={id("min")} optional>Lowest answer</FieldLabel>
              <input id={id("min")} type="number" value={row.min ?? ""} onChange={(e) => onChange({ min: e.target.value === "" ? null : Math.floor(Number(e.target.value)) })} style={inputStyle} />
            </div>
            <div>
              <FieldLabel htmlFor={id("max")} optional>Highest answer</FieldLabel>
              <input id={id("max")} type="number" value={row.max ?? ""} onChange={(e) => onChange({ max: e.target.value === "" ? null : Math.floor(Number(e.target.value)) })} style={inputStyle} />
            </div>
          </div>
        )}
        <div>
          <FieldLabel htmlFor={id("help")} optional>Hint</FieldLabel>
          <input id={id("help")} value={row.help} maxLength={300} onChange={(e) => onChange({ help: e.target.value })} style={inputStyle} />
        </div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 14 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={row.required} onChange={(e) => onChange({ required: e.target.checked })} /> {row.inputType === "checkbox" ? "Must be ticked" : "Must be answered"}
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={row.doorVisible} onChange={(e) => onChange({ doorVisible: e.target.checked })} /> Show the answer to door staff
          </label>
        </div>
      </fieldset>
    </Card>
  );
}
