import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  createFormTemplate,
  discardQuestionsDraft,
  draftQuestionsFrom,
  duplicateFormTemplate,
  fetchExperienceQuestions,
  fetchFormTemplates,
  fetchQuestionVersion,
  fetchQuestionVersions,
  publishQuestionsDraft,
  saveQuestionsDraft,
  setFormTemplateArchived,
  FORM_TYPE_OPTIONS,
  type FormRef,
} from "../../api";
import { Button, Card, LoadErrorState, PageSpinner, inputStyle } from "../ui";
import { FieldError, FieldLabel, FormErrorSummary, RequiredNote, useFormErrors, type FormError } from "../form";
import { useConfirm } from "../ConfirmProvider";
import { colors, radius } from "../../theme";
import { AttendeeFields, FormQuestions, type AnswersDraft } from "./AttendeeFields";
import type { FormDraft, FormTemplate, FormVersion, QuestionBuilderOptions, QuestionCategory, QuestionInputType, RegistrationQuestion, VendorRegistrationQuestion } from "../../types";

// Participation Phase 2 + configuration Phases F–G — the partner's registration
// form builder. Partners work on a DRAFT (saved as they go, never seen by anyone
// booking); "Publish" makes it the live form as a new version, after the server
// checks it against the field registry and HelloCircle's policy. Every published
// version stays in the history and can be copied back into a draft; bookings
// already made keep their answers with the wording they saw.
//
// Building blocks: ready-made fields (HelloCircle's wording), the partner's own
// questions in the allowed answer types, sections, and "only show when…" rules
// on an earlier pick-from-a-list or tick-box question. Templates (HelloCircle's,
// or the organisation's own) fill the draft. Preview shows the real form at
// desktop or phone width. No JSON anywhere.

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
const CONDITION_TYPES: QuestionInputType[] = ["select", "multi_select", "radio", "checkbox"];
const LENGTH_TYPES: QuestionInputType[] = ["text", "long_text"];
const PLACEHOLDER_TYPES: QuestionInputType[] = ["text", "long_text", "number", "email", "tel"];
const DEFAULT_TYPES: QuestionInputType[] = ["text", "number", "date", "select", "radio"];
const SPECIAL: { value: QuestionCategory; label: string }[] = [
  { value: "health", label: "Health, allergies or access needs" },
  { value: "religion", label: "Religion or belief" },
  { value: "ethnicity", label: "Ethnicity" },
  { value: "other_special", label: "Other sensitive information" },
];

/** Keys are made here so a new question can be the target of a condition before it's saved. */
const newKey = () => `q_${Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
const toRow = (q: Partial<VendorRegistrationQuestion>): Row => {
  // Rows from templates or drafts can be partial; fill every field the builder reads.
  const key = q.key || newKey();
  return { ...blank(), ...q, key, rowKey: key, label: q.label ?? "", purpose: q.purpose ?? "", help: q.help ?? "", choices: q.choices ?? [], choicesText: (q.choices ?? []).join("\n") } as Row;
};
const blank = (): Row => {
  const key = newKey();
  return { rowKey: key, key, fieldKey: null, scope: "attendee", inputType: "text", label: "", help: "", purpose: "", required: false, choices: [], choicesText: "", min: null, max: null, appliesTo: "all", doorVisible: false, category: "general", placeholder: "", defaultValue: null, minLength: null, maxLength: null, editability: "until_start", exportable: false, section: null, showIf: null };
};
const fid = (r: Row, f: string) => `q-${r.rowKey}-${f}`;
const toPayload = (rows: Row[]): VendorRegistrationQuestion[] =>
  rows.map(({ rowKey: _k, choicesText, ...rest }) => ({ ...rest, choices: choicesText.split("\n").map((c) => c.trim()).filter(Boolean), placeholder: rest.placeholder?.trim() ?? "", defaultValue: rest.defaultValue || null, section: rest.section?.trim() || null }));
const time = (iso: string) => new Date(iso).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Who the preview shows: a group (experiences), the one registrant or participant (clubs, programmes), or nobody (halls). */
type PreviewPeople = "group" | "one" | "none";

/**
 * Phase H — the same builder for every listing that takes a form: an
 * experience (`experienceId`) or a club, programme or hall (`listing`).
 */
export function QuestionsEditor({ experienceId, listing }: { experienceId?: string; listing?: Exclude<FormRef, string> }) {
  const ref: FormRef = listing ?? experienceId!;
  const formId = listing ? `${listing.listingType}-${listing.id}` : experienceId!;
  const previewPeople: PreviewPeople = !listing ? "group" : listing.listingType === "centre" ? "none" : "one";
  const confirm = useConfirm();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [liveVersion, setLiveVersion] = useState(0);
  const [liveCount, setLiveCount] = useState(0);
  const [draft, setDraft] = useState<FormDraft | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [specialOn, setSpecialOn] = useState(false);
  const [options, setOptions] = useState<QuestionBuilderOptions>({ library: [], allowedTypes: ["text"], classes: [] });
  const [suggested, setSuggested] = useState<string | null>(null);
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [pickLibrary, setPickLibrary] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<"desktop" | "phone" | null>(null);
  const [personQuestions, setPersonQuestions] = useState(true);
  const fe = useFormErrors();

  const loadTemplates = () => fetchFormTemplates(true).then((r) => setTemplates(r.templates)).catch(() => setTemplates([]));
  const load = () => {
    setLoadError(false);
    fetchExperienceQuestions(ref)
      .then((r) => {
        setLiveVersion(r.version);
        setLiveCount(r.questions.length);
        setDraft(r.draft ?? null);
        setRows((r.draft ? r.draft.questions : r.questions).map(toRow));
        setEnabled(r.enabled);
        setSpecialOn(r.specialCategoryEnabled);
        setOptions({ library: r.library ?? [], allowedTypes: r.allowedTypes ?? ["text"], classes: r.classes ?? [] });
        setSuggested(r.suggestedFormType ?? null);
        setPersonQuestions(r.personQuestions ?? true);
        setDirty(false);
      })
      .catch(() => setLoadError(true));
    void loadTemplates();
  };
  useEffect(load, [formId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loadError) return <LoadErrorState title="Couldn't load the registration form" onRetry={load} />;
  if (!rows) return <PageSpinner />;

  const update = (key: string, patch: Partial<Row>) => {
    setRows((list) => (list ?? []).map((r) => (r.rowKey === key ? { ...r, ...patch } : r)));
    setDirty(true);
    setNotice(null);
  };
  const setAll = (next: Row[]) => {
    setRows(next);
    setDirty(true);
    setNotice(null);
  };
  const move = (i: number, by: number) => {
    const next = [...rows];
    const [r] = next.splice(i, 1);
    next.splice(i + by, 0, r);
    // A condition must point at a question above it; drop any that no longer do.
    setAll(next.map((x, j) => (x.showIf && !next.slice(0, j).some((y) => y.key === x.showIf!.key) ? { ...x, showIf: null } : x)));
  };
  const remove = (r: Row) => setAll(rows.filter((x) => x.rowKey !== r.rowKey).map((x) => (x.showIf?.key === r.key ? { ...x, showIf: null } : x)));
  const usedLibrary = new Set(rows.map((r) => r.fieldKey).filter(Boolean));
  const addLibrary = () => {
    const f = options.library.find((x) => x.key === pickLibrary);
    if (!f) return;
    setAll([...rows, { ...blank(), fieldKey: f.key, label: f.label, purpose: f.purpose, help: f.help, scope: f.scope, inputType: f.inputType, choices: f.choices, choicesText: f.choices.join("\n"), appliesTo: f.appliesTo, category: f.dataClass as QuestionCategory }]);
    setPickLibrary("");
  };
  const sections = Array.from(new Set(rows.map((r) => r.section?.trim()).filter((s): s is string => !!s)));

  const clientErrors = (): FormError[] => {
    const errors: FormError[] = [];
    rows.forEach((r, i) => {
      const n = `Question ${i + 1}`;
      if (r.fieldKey) return;
      if (!r.label.trim()) errors.push({ field: `${n} wording`, fieldId: fid(r, "label"), message: `${n}: write the question` });
      if (!r.purpose.trim()) errors.push({ field: `${n} why`, fieldId: fid(r, "purpose"), message: `${n}: say why you're asking` });
      if (CHOICE_TYPES.includes(r.inputType) && r.choicesText.split("\n").filter((c) => c.trim()).length < 2) errors.push({ field: `${n} choices`, fieldId: fid(r, "choices"), message: `${n}: add at least two choices, one per line` });
      if (r.showIf && r.showIf.values.length === 0) errors.push({ field: `${n} rule`, fieldId: fid(r, "showif"), message: `${n}: tick which answers show it` });
    });
    return errors;
  };
  const serverError = (e: unknown, fallback: string) => {
    const m = e instanceof Error ? e.message : fallback;
    const index = /^Question (\d+)/.exec(m);
    const row = index ? rows[Number(index[1]) - 1] : null;
    fe.fail([{ field: "Form", fieldId: row ? fid(row, row.fieldKey ? "required" : "label") : undefined, message: m }]);
  };

  const saveDraft = async (): Promise<boolean> => {
    setBusy("draft");
    try {
      const r = await saveQuestionsDraft(ref, toPayload(rows));
      setDraft(r.draft);
      setDirty(false);
      setNotice(`Draft saved ${time(r.draft.updatedAt)}. It isn't live until you publish it.`);
      return true;
    } catch (e) {
      serverError(e, "Couldn't save the draft");
      return false;
    } finally {
      setBusy(null);
    }
  };
  const publish = async () => {
    const errors = clientErrors();
    if (errors.length) return fe.fail(errors);
    fe.clear();
    if ((dirty || !draft) && !(await saveDraft())) return;
    setBusy("publish");
    try {
      const r = await publishQuestionsDraft(ref);
      setNotice(`Published as version ${r.version}. New bookings answer this form; bookings already made keep the answers they gave.`);
      load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setNotice(e.message);
      serverError(e, "Couldn't publish");
    } finally {
      setBusy(null);
    }
  };
  const discard = async () => {
    if (!(await confirm({ title: "Discard this draft?", message: "Your unpublished changes will be lost. The live form doesn't change.", confirmLabel: "Discard draft", tone: "danger" }))) return;
    await discardQuestionsDraft(ref);
    setNotice("Draft discarded. Showing the live form.");
    load();
  };
  const startFrom = async (from: { templateId: string } | { version: number }, what: string) => {
    if ((rows.length > 0 || draft) && !(await confirm({ title: `Start the draft from ${what}?`, message: "It replaces what's in the draft now. The live form doesn't change until you publish.", confirmLabel: "Replace draft", tone: "neutral" }))) return;
    setBusy("from");
    try {
      const r = await draftQuestionsFrom(ref, from);
      setDraft(r.draft);
      setRows(r.draft.questions.map(toRow));
      setDirty(false);
      setNotice(`Draft filled from ${what}. Review it, preview it, then publish.`);
    } catch (e) {
      serverError(e, "Couldn't fill the draft");
    } finally {
      setBusy(null);
    }
  };

  const available = options.library.filter((f) => !usedLibrary.has(f.key));
  const activeTemplates = templates.filter((t) => t.status === "active");
  const ordered = [...activeTemplates].sort((a, b) => Number(b.formType === suggested && b.scope === "platform") - Number(a.formType === suggested && a.scope === "platform"));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 820 }}>
      <div>
        <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>Registration form</h2>
        <p style={{ margin: 0, color: colors.muted, fontSize: 14, lineHeight: 1.5 }}>
          Ask only what you need to run the day. HelloCircle already collects names, contact details, who is coming and payment — don't ask for those again. People see why you're asking before they answer.
        </p>
      </div>

      <div role="status" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", padding: "10px 12px", background: colors.panel, border: `1px solid ${colors.border}`, borderRadius: radius.control, fontSize: 13.5 }}>
        <span><strong>Live:</strong> {liveVersion ? `version ${liveVersion} · ${liveCount} ${liveCount === 1 ? "question" : "questions"}` : "no questions yet"}</span>
        <span aria-hidden="true">·</span>
        <span>
          <strong>Draft:</strong> {draft ? `saved ${time(draft.updatedAt)}${dirty ? " · unsaved changes" : ""}` : dirty ? "unsaved changes" : "none — editing starts one"}
        </span>
      </div>
      {draft && draft.issues.length > 0 && !dirty && (
        <p role="note" style={{ margin: 0, fontSize: 13.5, color: colors.orangeDark }}>Before publishing: {draft.issues.join("; ")}</p>
      )}
      {!enabled && (
        <p role="status" style={{ margin: 0, fontSize: 13.5 }}>Attendee details and questions aren't switched on yet. You can see the form here, but you can't change it, and nobody is asked these questions until they are.</p>
      )}
      <p style={{ margin: 0, fontSize: 13, color: colors.muted, lineHeight: 1.5 }}>
        Never asked here: payment, bank, password or identity-document details{specialOn ? "" : ", or health, allergies, religion, ethnicity and other sensitive information (these need an approved privacy policy first)"}.
      </p>

      {enabled && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ minWidth: 260 }}>
            <FieldLabel htmlFor={`tpl-${formId}`}>Start from a template</FieldLabel>
            <select
              id={`tpl-${formId}`}
              value=""
              disabled={!!busy}
              onChange={(e) => {
                const t = activeTemplates.find((x) => x.id === e.target.value);
                if (t) void startFrom({ templateId: t.id }, `"${t.name}"`);
              }}
              style={inputStyle}
            >
              <option value="">Choose a template…</option>
              {ordered.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.scope === "organisation" ? " (yours)" : ""}{t.formType === suggested && t.scope === "platform" ? " — suggested for this category" : ""}
                </option>
              ))}
            </select>
          </div>
          <Button variant="ghost" disabled={!!busy} onClick={() => setPreview(preview ? null : "desktop")} aria-pressed={!!preview}>{preview ? "Close preview" : "Preview"}</Button>
        </div>
      )}

      {preview && <FormPreview questions={toPayload(rows)} width={preview} onWidth={setPreview} people={previewPeople} />}

      <FormErrorSummary errors={fe.errors} focusKey={fe.focusKey} />
      {rows.length > 0 && <RequiredNote style={{ margin: 0 }} />}
      {rows.length === 0 && <p style={{ margin: 0, fontSize: 14, color: colors.muted }}>No questions. People only give their names and who is coming.</p>}
      {rows.map((r, i) => (
        <div key={r.rowKey} style={{ display: "contents" }}>
          {r.section && r.section !== rows[i - 1]?.section && <h3 style={{ fontSize: 15, margin: "8px 0 -4px" }}>{r.section}</h3>}
          <QuestionCard
            row={r}
            index={i}
            count={rows.length}
            earlier={rows.slice(0, i)}
            sections={sections}
            disabled={!enabled}
            specialOn={specialOn}
            personQuestions={personQuestions}
            options={options}
            fe={fe}
            onChange={(p) => update(r.rowKey, p)}
            onRemove={() => remove(r)}
            onMove={(by) => move(i, by)}
          />
        </div>
      ))}
      {enabled && rows.length < MAX_QUESTIONS && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Button variant="ghost" onClick={() => setAll([...rows, personQuestions ? blank() : { ...blank(), scope: "booking" }])}>Add your own question</Button>
          {available.length > 0 && (
            <>
              <div style={{ minWidth: 220 }}>
                <FieldLabel htmlFor={`lib-${formId}`}>Or a ready-made field</FieldLabel>
                <select id={`lib-${formId}`} value={pickLibrary} onChange={(e) => setPickLibrary(e.target.value)} style={inputStyle}>
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
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button size="lg" onClick={publish} disabled={!!busy || (!dirty && !draft)} aria-busy={busy === "publish"}>{busy === "publish" ? "Publishing…" : "Publish"}</Button>
          <Button variant="ghost" onClick={() => void saveDraft()} disabled={!!busy || !dirty} aria-busy={busy === "draft"}>{busy === "draft" ? "Saving…" : "Save draft"}</Button>
          {draft && <Button variant="ghost" onClick={discard} disabled={!!busy}>Discard draft</Button>}
        </div>
      )}

      {enabled && (
        <TemplatesPanel
          templates={templates}
          canSave={rows.length > 0}
          onSave={async (name, formType) => {
            const errors = clientErrors();
            if (errors.length) {
              fe.fail(errors);
              return false;
            }
            try {
              await createFormTemplate({ name, formType, questions: toPayload(rows) });
              setNotice(`Saved as template "${name}".`);
              void loadTemplates();
              return true;
            } catch (e) {
              serverError(e, "Couldn't save the template");
              return false;
            }
          }}
          onChanged={loadTemplates}
        />
      )}
      <HistoryPanel formRef={ref} liveVersion={liveVersion} canCopy={enabled} onCopy={(v) => startFrom({ version: v }, `version ${v}`)} />
    </div>
  );
}

// --- preview ----------------------------------------------------------------------------

function FormPreview({ questions, width, onWidth, people: who }: { questions: VendorRegistrationQuestion[]; width: "desktop" | "phone"; onWidth: (w: "desktop" | "phone") => void; people: PreviewPeople }) {
  const [answers, setAnswers] = useState<AnswersDraft>({ booking: {}, attendees: [{}, {}] });
  const all = useMemo(() => [{ name: "Sample adult", personType: "adult" as const, guardian: "" as const }, { name: "Sample child", personType: "child" as const, guardian: "contact" as const }], []);
  const allSlots = [{ lineLabel: null, fixedType: "adult" as const }, { lineLabel: null, fixedType: "child" as const }];
  // A club or programme registers one person (a child here, so child-only questions show); a hall booking has no people list.
  const people = who === "group" ? all : who === "one" ? all.slice(1) : [];
  const slots = who === "group" ? allSlots : who === "one" ? allSlots.slice(1) : [];
  const noop = { control: (id: string) => ({ id }), messageFor: () => undefined, clearField: () => undefined };
  return (
    <section aria-label="Form preview" style={{ border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: 14, background: colors.bg }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <strong style={{ fontSize: 14 }}>Preview — how people booking see it{who === "group" ? " (a sample adult and child)" : who === "one" ? " (a sample child)" : ""}</strong>
        <div role="radiogroup" aria-label="Preview width" style={{ display: "flex", gap: 12, fontSize: 13.5 }}>
          {(["desktop", "phone"] as const).map((w) => (
            <label key={w} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="radio" name="preview-width" checked={width === w} onChange={() => onWidth(w)} /> {w === "desktop" ? "Desktop" : "Phone"}
            </label>
          ))}
        </div>
      </div>
      <div style={{ maxWidth: width === "phone" ? 375 : 640, margin: "0 auto", background: colors.surface, borderRadius: radius.card, padding: 16, border: `1px solid ${colors.border}` }}>
        {questions.length === 0 ? (
          <p style={{ margin: 0, color: colors.muted, fontSize: 14 }}>{who === "group" ? "No questions — people only give names and who is coming." : "No questions — the form is the usual one."}</p>
        ) : (
          who === "group" ? (
            <AttendeeFields slots={slots} people={people} onPeople={() => undefined} questions={questions as RegistrationQuestion[]} answers={answers} onAnswers={setAnswers} contactName="Sample adult" fe={noop} />
          ) : (
            <FormQuestions questions={questions as RegistrationQuestion[]} answers={answers} onAnswers={setAnswers} person={who === "one" ? people[0] : null} fe={noop} />
          )
        )}
      </div>
    </section>
  );
}

// --- templates and history -----------------------------------------------------------

function TemplatesPanel({ templates, canSave, onSave, onChanged }: { templates: FormTemplate[]; canSave: boolean; onSave: (name: string, formType: string) => Promise<boolean>; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [formType, setFormType] = useState<string>(FORM_TYPE_OPTIONS[0].key);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const own = templates.filter((t) => t.scope === "organisation");
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      setMessage(done);
      onChanged();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Couldn't do that");
    } finally {
      setBusy(false);
    }
  };
  return (
    <details style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
      <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 14 }}>Your templates ({own.filter((t) => t.status === "active").length})</summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 10 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ minWidth: 220, flex: "1 1 220px" }}>
            <FieldLabel htmlFor="tpl-name">Save this form as a template</FieldLabel>
            <input id="tpl-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pooja registration" style={inputStyle} />
          </div>
          <div style={{ minWidth: 200 }}>
            <FieldLabel htmlFor="tpl-type">For</FieldLabel>
            <select id="tpl-type" value={formType} onChange={(e) => setFormType(e.target.value)} style={inputStyle}>
              {FORM_TYPE_OPTIONS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </div>
          <Button variant="ghost" disabled={busy || !canSave || !name.trim()} onClick={async () => { setBusy(true); if (await onSave(name.trim(), formType)) setName(""); setBusy(false); }}>Save as template</Button>
        </div>
        {own.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13.5, color: colors.muted }}>No templates of your own yet. HelloCircle's templates are in "Start from a template" above.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {own.map((t) => (
              <li key={t.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13.5, background: colors.bg, borderRadius: radius.control, padding: "8px 10px", opacity: t.status === "archived" ? 0.7 : 1 }}>
                <span><strong>{t.name}</strong> · {t.questions.length} questions{t.status === "archived" ? " · archived" : ""}</span>
                <span style={{ display: "flex", gap: 6 }}>
                  <Button variant="ghost" disabled={busy} onClick={() => act(() => duplicateFormTemplate(t.id), `Copied "${t.name}".`)} aria-label={`Duplicate ${t.name}`}>Duplicate</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => act(() => setFormTemplateArchived(t.id, t.status === "active"), t.status === "active" ? `Archived "${t.name}".` : `Restored "${t.name}".`)} aria-label={`${t.status === "active" ? "Archive" : "Restore"} ${t.name}`}>{t.status === "active" ? "Archive" : "Restore"}</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {message && <p role="status" style={{ margin: 0, fontSize: 13.5, color: colors.muted }}>{message}</p>}
      </div>
    </details>
  );
}

function HistoryPanel({ formRef, liveVersion, canCopy, onCopy }: { formRef: FormRef; liveVersion: number; canCopy: boolean; onCopy: (v: number) => void }) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<FormVersion[] | null>(null);
  const [viewing, setViewing] = useState<{ version: number; questions: VendorRegistrationQuestion[] } | null>(null);
  useEffect(() => {
    if (open) fetchQuestionVersions(formRef).then((r) => setVersions(r.versions)).catch(() => setVersions([]));
  }, [open, typeof formRef === "string" ? formRef : `${formRef.listingType}:${formRef.id}`, liveVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <details onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
      <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 14 }}>Version history</summary>
      {!versions ? (
        <p role="status" style={{ fontSize: 13.5, color: colors.muted }}>Loading…</p>
      ) : versions.length === 0 ? (
        <p style={{ fontSize: 13.5, color: colors.muted }}>Nothing published yet.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {versions.map((v) => (
            <li key={v.version} style={{ fontSize: 13.5, background: colors.bg, borderRadius: radius.control, padding: "8px 10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span>
                  <strong>Version {v.version}</strong>{v.live ? " · live" : ""} · {v.questions} questions · {time(v.publishedAt)}{v.publishedBy ? ` · ${v.publishedBy}` : ""}
                </span>
                <span style={{ display: "flex", gap: 6 }}>
                  <Button variant="ghost" onClick={async () => setViewing(viewing?.version === v.version ? null : await fetchQuestionVersion(formRef, v.version))} aria-label={`View version ${v.version}`}>{viewing?.version === v.version ? "Hide" : "View"}</Button>
                  {canCopy && !v.live && <Button variant="ghost" onClick={() => onCopy(v.version)} aria-label={`Copy version ${v.version} into the draft`}>Copy into draft</Button>}
                </span>
              </div>
              {viewing?.version === v.version && (
                <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                  {viewing.questions.map((q) => <li key={q.key}>{q.label} <span style={{ color: colors.muted }}>· {TYPE_LABEL[q.inputType]}{q.required ? " · required" : ""}</span></li>)}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

// --- one question ----------------------------------------------------------------------

function QuestionCard({ row, index, count, earlier, sections, disabled, specialOn, personQuestions, options, fe, onChange, onRemove, onMove }: {
  row: Row;
  /** false = a hall form: every question is asked once per booking. */
  personQuestions: boolean;
  index: number;
  count: number;
  earlier: Row[];
  sections: string[];
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
  // "Only show when" can use an earlier pick-from-a-list or tick-box question (a per-booking question can't depend on one person).
  const targets = earlier.filter((q) => CONDITION_TYPES.includes(q.inputType) && !(row.scope === "booking" && q.scope === "attendee"));
  const target = row.showIf ? earlier.find((q) => q.key === row.showIf!.key) : undefined;
  const targetChoices = target ? (target.inputType === "checkbox" ? ["yes"] : target.choicesText.split("\n").map((c) => c.trim()).filter(Boolean)) : [];
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14 }}>
          Question {index + 1}
          {ready && <span style={{ fontWeight: 500, fontSize: 12.5, color: colors.muted }}> · Ready-made (HelloCircle's wording)</span>}
          {row.showIf && <span style={{ fontWeight: 500, fontSize: 12.5, color: colors.muted }}> · shown only sometimes</span>}
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
                  {(personQuestions || row.scope === "attendee") && <option value="attendee">{personQuestions ? "For each person" : "For each person (not on this form)"}</option>}
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
        <div style={grid}>
          <div>
            <FieldLabel htmlFor={id("section")} optional>Section</FieldLabel>
            <input id={id("section")} list={`sections-${row.rowKey}`} value={row.section ?? ""} maxLength={120} onChange={(e) => onChange({ section: e.target.value })} placeholder="e.g. Getting there" style={inputStyle} />
            <datalist id={`sections-${row.rowKey}`}>{sections.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
          {targets.length > 0 && (
            <div>
              <FieldLabel htmlFor={id("showif")} optional>Only show when</FieldLabel>
              <select id={id("showif")} value={row.showIf?.key ?? ""} onChange={(e) => onChange({ showIf: e.target.value ? { key: e.target.value, values: [] } : null })} style={inputStyle}>
                <option value="">Always show</option>
                {targets.map((t) => <option key={t.key} value={t.key}>{t.label || "(untitled question)"}</option>)}
              </select>
            </div>
          )}
        </div>
        {row.showIf && target && (
          <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
            <legend style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>…the answer to "{target.label}" is</legend>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 14 }}>
              {targetChoices.map((c) => (
                <label key={c} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={row.showIf!.values.includes(c)}
                    onChange={(e) => onChange({ showIf: { key: row.showIf!.key, values: e.target.checked ? [...row.showIf!.values, c] : row.showIf!.values.filter((v) => v !== c) } })}
                  />
                  {target.inputType === "checkbox" ? "Ticked" : c}
                </label>
              ))}
            </div>
            <FieldError fieldId={id("showif")} message={fe.messageFor(id("showif"))} />
          </fieldset>
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
