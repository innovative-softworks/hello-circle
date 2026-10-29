import { useEffect, useState } from "react";
import { ApiError, fetchExperienceQuestions, saveExperienceQuestions } from "../../api";
import { Button, Card, LoadErrorState, PageSpinner, inputStyle } from "../ui";
import { FieldError, FieldLabel, FormErrorSummary, RequiredNote, useFormErrors, type FormError } from "../form";
import { colors } from "../../theme";
import type { QuestionBuilderOptions, QuestionCategory, QuestionInputType, VendorRegistrationQuestion } from "../../types";

// Participation Phase 2 + configuration Phase F — the partner's registration
// questions, built from the field registry: ready-made fields (HelloCircle's
// wording; the partner sets only required / door / export) and the partner's
// own questions in the answer types the platform allows. Every question says
// why it's asked. The server refuses sensitive, financial and identity
// questions and anything that repeats what HelloCircle already collects; this
// form explains, the server decides. Saving replaces the whole set under a
// version; bookings already made keep their answers with the wording they saw.

interface Row extends VendorRegistrationQuestion {
  rowKey: string;
  choicesText: string;
}

const MAX_QUESTIONS = 12;
const TYPE_LABEL: Record<QuestionInputType, string> = {
  text: "Short text",
  long_text: "Long text",
  number: "Number",
  email: "Email address",
  tel: "Phone number",
  date: "Date",
  select: "Pick one from a list",
  multi_select: "Pick several from a list",
  radio: "Pick one (buttons)",
  checkbox: "Tick box",
  info: "Information only (no answer)",
};
const CHOICE_TYPES: QuestionInputType[] = ["select", "multi_select", "radio"];
const LENGTH_TYPES: QuestionInputType[] = ["text", "long_text"];
const PLACEHOLDER_TYPES: QuestionInputType[] = ["text", "long_text", "number", "email", "tel"];
const DEFAULT_TYPES: QuestionInputType[] = ["text", "number", "date", "select", "radio"];
const SPECIAL: { value: QuestionCategory; label: string }[] = [
  { value: "health", label: "Health, allergies or access needs" },
  { value: "religion", label: "Religion or belief" },
  { value: "ethnicity", label: "Ethnicity" },
  { value: "other_special", label: "Other sensitive information" },
];

const toRow = (q: VendorRegistrationQuestion, i: number): Row => ({ ...q, rowKey: q.key || `new-${i}-${Date.now()}`, choicesText: (q.choices ?? []).join("\n") });

const blank = (): Row => ({
  rowKey: `new-${Math.random().toString(36).slice(2)}`,
  key: "",
  fieldKey: null,
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
  placeholder: "",
  defaultValue: null,
  minLength: null,
  maxLength: null,
  editability: "until_start",
  exportable: false,
});

const fid = (r: Row, f: string) => `q-${r.rowKey}-${f}`;

export function QuestionsEditor({ experienceId }: { experienceId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [version, setVersion] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [specialOn, setSpecialOn] = useState(false);
  const [options, setOptions] = useState<QuestionBuilderOptions>({ library: [], allowedTypes: ["text"], classes: [] });
  const [pickLibrary, setPickLibrary] = useState("");
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
        setOptions({ library: r.library ?? [], allowedTypes: r.allowedTypes ?? ["text"], classes: r.classes ?? [] });
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
  const usedLibrary = new Set(rows.map((r) => r.fieldKey).filter(Boolean));
  const addLibrary = () => {
    const f = options.library.find((x) => x.key === pickLibrary);
    if (!f) return;
    setRows([...rows, { ...blank(), fieldKey: f.key, label: f.label, purpose: f.purpose, help: f.help, scope: f.scope, inputType: f.inputType, choices: f.choices, choicesText: f.choices.join("\n"), appliesTo: f.appliesTo, category: f.dataClass as QuestionCategory }]);
    setPickLibrary("");
    setDirty(true);
  };

  const save = async () => {
    const errors: FormError[] = [];
    const payload: VendorRegistrationQuestion[] = rows.map((r, i) => {
      const n = `Question ${i + 1}`;
      const choices = r.choicesText.split("\n").map((c) => c.trim()).filter(Boolean);
      if (!r.fieldKey) {
        if (!r.label.trim()) errors.push({ field: `${n} wording`, fieldId: fid(r, "label"), message: `${n}: write the question` });
        if (!r.purpose.trim()) errors.push({ field: `${n} why`, fieldId: fid(r, "purpose"), message: `${n}: say why you're asking` });
        if (CHOICE_TYPES.includes(r.inputType) && choices.length < 2) errors.push({ field: `${n} choices`, fieldId: fid(r, "choices"), message: `${n}: add at least two choices, one per line` });
      }
      const { rowKey: _k, choicesText: _c, ...rest } = r;
      return { ...rest, label: r.label.trim(), purpose: r.purpose.trim(), help: r.help.trim(), choices, placeholder: r.placeholder?.trim() ?? "", defaultValue: r.defaultValue || null };
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
        fe.fail([{ field: "Questions", fieldId: row ? fid(row, row.fieldKey ? "required" : "label") : undefined, message: m }]);
      }
    } finally {
      setSaving(false);
    }
  };

  const available = options.library.filter((f) => !usedLibrary.has(f.key));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
      <div>
        <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>Registration questions</h2>
        <p style={{ margin: 0, color: colors.muted, fontSize: 14, lineHeight: 1.5 }}>
          Ask only what you need to run the day. HelloCircle already collects names, contact details, who is coming and payment — don't ask for those again. People see why you're asking before they answer.
        </p>
      </div>
      {!enabled && (
        <p role="status" style={{ margin: 0, padding: "10px 12px", background: colors.panel, border: `1px solid ${colors.border}`, borderRadius: "var(--radius-control)", fontSize: 13.5 }}>
          Attendee details and questions aren't switched on yet. You can see the questions here, but you can't change them, and nobody is asked them until they are.
        </p>
      )}
      <p style={{ margin: 0, fontSize: 13, color: colors.muted, lineHeight: 1.5 }}>
        Never asked here: payment, bank, password or identity-document details{specialOn ? "" : ", or health, allergies, religion, ethnicity and other sensitive information (these need an approved privacy policy first)"}.
      </p>
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
          options={options}
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
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Button variant="ghost" onClick={() => { setRows([...rows, blank()]); setDirty(true); }}>Add your own question</Button>
          {available.length > 0 && (
            <>
              <div style={{ minWidth: 220 }}>
                <FieldLabel htmlFor={`lib-${experienceId}`}>Or a ready-made field</FieldLabel>
                <select id={`lib-${experienceId}`} value={pickLibrary} onChange={(e) => setPickLibrary(e.target.value)} style={inputStyle}>
                  <option value="">Choose…</option>
                  {available.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </div>
              <Button variant="ghost" disabled={!pickLibrary} onClick={addLibrary}>Add field</Button>
            </>
          )}
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

function QuestionCard({ row, index, count, disabled, specialOn, options, fe, onChange, onRemove, onMove }: {
  row: Row;
  index: number;
  count: number;
  disabled: boolean;
  specialOn: boolean;
  options: QuestionBuilderOptions;
  fe: ReturnType<typeof useFormErrors>;
  onChange: (p: Partial<Row>) => void;
  onRemove: () => void;
  onMove: (by: number) => void;
}) {
  const id = (f: string) => fid(row, f);
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 } as const;
  const name = row.label || `question ${index + 1}`;
  const ready = !!row.fieldKey;
  const info = row.inputType === "info";
  const types = Array.from(new Set([...options.allowedTypes, row.inputType]));
  const cls = options.classes.find((c) => c.key === row.category);
  const exportBlocked = !!cls && !cls.exportable;
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14 }}>
          Question {index + 1}
          {ready && <span style={{ fontWeight: 500, fontSize: 12.5, color: colors.muted }}> · Ready-made (HelloCircle's wording)</span>}
        </strong>
        {!disabled && (
          <div style={{ display: "flex", gap: 6 }}>
            <Button variant="ghost" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move ${name} up`}>Up</Button>
            <Button variant="ghost" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Move ${name} down`}>Down</Button>
            <Button variant="ghost" onClick={onRemove} aria-label={`Remove ${name}`}>Remove</Button>
          </div>
        )}
      </div>
      <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {ready ? (
          <div style={{ fontSize: 14 }}>
            <div><strong>{row.label}</strong></div>
            <div style={{ color: colors.muted, fontSize: 13 }}>Why we ask: {row.purpose} · {TYPE_LABEL[row.inputType]} · {row.scope === "booking" ? "once per booking" : "for each person"}{row.choices.length ? ` · ${row.choices.join(", ")}` : ""}</div>
          </div>
        ) : (
          <>
            <div>
              <FieldLabel htmlFor={id("label")} required>{info ? "Information" : "Question"}</FieldLabel>
              <input {...fe.control(id("label"))} value={row.label} maxLength={200} onChange={(e) => onChange({ label: e.target.value })} placeholder={info ? "e.g. Bring a packed lunch" : "e.g. Name on your badge"} style={inputStyle} />
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
                  {types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel htmlFor={id("category")}>About</FieldLabel>
                <select id={id("category")} value={row.category} onChange={(e) => onChange({ category: e.target.value as QuestionCategory })} style={inputStyle}>
                  {options.classes.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  {SPECIAL.map((c) => <option key={c.value} value={c.value} disabled={!specialOn}>{c.label}{!specialOn ? " — needs policy approval" : ""}</option>)}
                </select>
              </div>
            </div>
            {CHOICE_TYPES.includes(row.inputType) && (
              <div>
                <FieldLabel htmlFor={id("choices")} required>Choices (one per line)</FieldLabel>
                <textarea {...fe.control(id("choices"))} value={row.choicesText} rows={4} onChange={(e) => onChange({ choicesText: e.target.value })} style={{ ...inputStyle, minHeight: 90 }} />
                <FieldError fieldId={id("choices")} message={fe.messageFor(id("choices"))} />
              </div>
            )}
            {(row.inputType === "number" || LENGTH_TYPES.includes(row.inputType)) && (
              <div style={grid}>
                <div>
                  <FieldLabel htmlFor={id("min")} optional>{row.inputType === "number" ? "Lowest answer" : "Shortest answer (characters)"}</FieldLabel>
                  <input id={id("min")} type="number" value={(row.inputType === "number" ? row.min : row.minLength) ?? ""} onChange={(e) => { const v = e.target.value === "" ? null : Math.floor(Number(e.target.value)); onChange(row.inputType === "number" ? { min: v } : { minLength: v }); }} style={inputStyle} />
                </div>
                <div>
                  <FieldLabel htmlFor={id("max")} optional>{row.inputType === "number" ? "Highest answer" : "Longest answer (characters)"}</FieldLabel>
                  <input id={id("max")} type="number" value={(row.inputType === "number" ? row.max : row.maxLength) ?? ""} onChange={(e) => { const v = e.target.value === "" ? null : Math.floor(Number(e.target.value)); onChange(row.inputType === "number" ? { max: v } : { maxLength: v }); }} style={inputStyle} />
                </div>
              </div>
            )}
            <div style={grid}>
              {PLACEHOLDER_TYPES.includes(row.inputType) && (
                <div>
                  <FieldLabel htmlFor={id("placeholder")} optional>Example shown in the box</FieldLabel>
                  <input id={id("placeholder")} value={row.placeholder ?? ""} maxLength={120} onChange={(e) => onChange({ placeholder: e.target.value })} style={inputStyle} />
                </div>
              )}
              {DEFAULT_TYPES.includes(row.inputType) && (
                <div>
                  <FieldLabel htmlFor={id("default")} optional>Pre-filled answer</FieldLabel>
                  <input id={id("default")} value={row.defaultValue ?? ""} maxLength={200} onChange={(e) => onChange({ defaultValue: e.target.value })} style={inputStyle} />
                </div>
              )}
              <div>
                <FieldLabel htmlFor={id("help")} optional>Hint</FieldLabel>
                <input id={id("help")} value={row.help} maxLength={300} onChange={(e) => onChange({ help: e.target.value })} style={inputStyle} />
              </div>
            </div>
          </>
        )}
        {!info && (
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 14 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input id={id("required")} type="checkbox" checked={row.required} onChange={(e) => onChange({ required: e.target.checked })} /> {row.inputType === "checkbox" ? "Must be ticked" : "Must be answered"}
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={row.doorVisible} onChange={(e) => onChange({ doorVisible: e.target.checked })} /> Show the answer to door staff
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={row.editability === "locked"} onChange={(e) => onChange({ editability: e.target.checked ? "locked" : "until_start" })} /> Can't be changed after booking
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }} title={exportBlocked ? "HelloCircle doesn't allow this kind of information in exports" : undefined}>
              <input type="checkbox" checked={!!row.exportable && !exportBlocked} disabled={exportBlocked} onChange={(e) => onChange({ exportable: e.target.checked })} /> Include in the attendee export{exportBlocked ? " (not allowed for this kind of information)" : ""}
            </label>
          </div>
        )}
      </fieldset>
    </Card>
  );
}
