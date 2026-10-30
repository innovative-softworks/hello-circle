import { useEffect, useState } from "react";
import { ListChecks, Lock } from "lucide-react";
import { fetchAdminFields, saveFieldPolicy, type AdminFieldsView, type FieldDataClass, type FieldInputType, type FieldPolicyView } from "../../api";
import { AdminButton, Badge, Box, ErrorMessage, errorMessage } from "./adminUi";
import { useAdminCan } from "./adminPermissions";
import { useToast } from "../Toast";

// Configuration framework Phase F — admin Settings → Registration fields.
// What partners can put in their registration forms: ready-made fields (the
// ones that collect contact or personal details are admin-only), the answer
// types allowed for their own questions, and per data class how long answers
// are kept after the event and whether they can be exported. Platform-locked
// fields and the sensitive-data rules are shown, never editable here.
// Retention is recorded and reported; nothing is deleted automatically.

const CLASS_NOTE: Record<FieldDataClass, string> = {
  general: "Badge names, sizes, experience levels and similar.",
  logistics: "Arrival, transport, equipment.",
  dietary_preference: "Food preferences only — never allergies.",
  contact: "Email addresses, phone numbers and emergency contacts.",
  personal: "Dates of birth, consents and other personal details.",
};

export function AdminFieldPolicy() {
  const canEdit = useAdminCan()("policies.manage");
  const toast = useToast();
  const [view, setView] = useState<AdminFieldsView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [draft, setDraft] = useState<FieldPolicyView | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    fetchAdminFields()
      .then((v) => {
        setView(v);
        setDraft(structuredClone(v.policy));
        setSaveError(null);
      })
      .catch(setError);
  };
  useEffect(load, []);
  if (error) return <ErrorMessage error={error} title="Couldn't load registration fields" onRetry={load} />;
  if (!view || !draft) return <p className="adm-note" role="status">Loading registration fields…</p>;
  const dirty = JSON.stringify(draft) !== JSON.stringify(view.policy);

  const save = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      await saveFieldPolicy({ version: view.policy.version, library: draft.library, customTypes: draft.customTypes, classes: draft.classes, reason: reason.trim() || undefined });
      toast.success("Registration field policy saved");
      setReason("");
      load();
    } catch (e) {
      setSaveError(errorMessage(e, "Couldn't save"));
    } finally {
      setBusy(false);
    }
  };

  const check = (checked: boolean, onChange: (v: boolean) => void, label: string, disabled = false) => (
    <input type="checkbox" checked={checked} disabled={!canEdit || busy || disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} style={{ accentColor: "var(--color-green)", width: 16, height: 16 }} />
  );

  return (
    <div className="adm-stack">
      <Box icon={ListChecks} title="Ready-made fields" subtitle="Fields partners add to a registration form without writing them. The wording is HelloCircle's. Ones that collect contact or personal details are off until you switch them on.">
        <ul className="wd-rows">
          {view.library.map((f) => (
            <li key={f.key}>
              {check(!!draft.library[f.key], (v) => setDraft({ ...draft, library: { ...draft.library, [f.key]: v } }), `Partners can use ${f.label}`)}
              <div className="wd-rows-main">
                <span className="wd-ctx-name">{f.label}</span>
                <span className="wd-ctx-sub">{f.purpose} · {view.types.find((t) => t.key === f.inputType)?.label} · {f.scope === "booking" ? "once per booking" : "for each person"} · {view.classes.find((c) => c.key === f.dataClass)?.label}</span>
              </div>
              {f.fieldClass === "admin_configurable" && <Badge tone="outline">Admin approval</Badge>}
            </li>
          ))}
        </ul>
      </Box>

      <Box icon={ListChecks} title="Answer types for partners' own questions">
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          {view.types.map((t) => (
            <label key={t.key} style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 13.5 }}>
              {check(!!draft.customTypes[t.key], (v) => setDraft({ ...draft, customTypes: { ...draft.customTypes, [t.key]: v } as Record<FieldInputType, boolean> }), `Allow ${t.label}`, t.key === "text")}
              {t.label}
            </label>
          ))}
        </div>
      </Box>

      <Box icon={ListChecks} title="Keeping and exporting answers" subtitle="How long answers are kept after the event, by kind of information. Answers past this period are counted here; nothing is deleted automatically until the retention review is approved.">
        <ul className="wd-rows">
          {view.classes.map((c) => {
            const cls = draft.classes[c.key];
            return (
              <li key={c.key}>
                <div className="wd-rows-main">
                  <span className="wd-ctx-name">{c.label}</span>
                  <span className="wd-ctx-sub">{CLASS_NOTE[c.key]}{view.pastRetention[c.key] ? ` · ${view.pastRetention[c.key]} answers are past this period` : ""}</span>
                </div>
                <label className="wd-ctx-sub" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  Keep
                  <select
                    className="adm-select"
                    value={cls.retentionDays ?? ""}
                    disabled={!canEdit || busy}
                    aria-label={`Keep ${c.label} answers`}
                    onChange={(e) => setDraft({ ...draft, classes: { ...draft.classes, [c.key]: { ...cls, retentionDays: e.target.value ? Number(e.target.value) : null } } })}
                  >
                    <option value="">Until the retention review</option>
                    {[30, 90, 180, 365, 730].map((d) => <option key={d} value={d}>{d} days after the event</option>)}
                  </select>
                </label>
                <label className="wd-ctx-sub" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {check(cls.exportable, (v) => setDraft({ ...draft, classes: { ...draft.classes, [c.key]: { ...cls, exportable: v } } }), `${c.label} answers can be exported`)}
                  Can be exported
                </label>
              </li>
            );
          })}
        </ul>
      </Box>

      <Box icon={Lock} title="Always HelloCircle's" subtitle="Collected or worked out by the platform. Partners can't add a question that asks for these again.">
        <p style={{ margin: 0, fontSize: 13.5 }}>{view.platformLocked.map((f) => f.label).join(" · ")}</p>
        <p className="adm-note" style={{ margin: "10px 0 0" }}>
          Never collected through registration questions: payment, bank, password and identity-document details. Health, religion, ethnicity and other special-category questions are {view.specialCategoryQuestions ? "switched on" : "locked until a privacy policy for them is approved"}.
        </p>
      </Box>

      {canEdit ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label htmlFor="fp-reason" className="adm-section-label" style={{ marginTop: 0 }}>Reason (optional, kept in the audit log)</label>
          <textarea id="fp-reason" className="adm-input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          {saveError && <p className="adm-callout" role="alert">{saveError}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <AdminButton variant="primary" disabled={!dirty || busy} onClick={save}>{busy ? "Saving…" : "Save field policy"}</AdminButton>
            <AdminButton disabled={!dirty || busy} onClick={() => setDraft(structuredClone(view.policy))}>Discard changes</AdminButton>
          </div>
        </div>
      ) : (
        <p className="adm-note">You can see the field policy; changing it needs Super or Legal.</p>
      )}
    </div>
  );
}
