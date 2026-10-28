import { useEffect, useRef, useState } from "react";
import { useInWorkspace } from "./workspace/inWorkspace";
import { SectionSaveContext, useSectionSave, type SectionSave } from "./workspace/sectionSave";
import { fetchLinkableCircles, fetchVendorParticipation, saveVendorParticipation, type VendorParticipation, type VendorParticipationType } from "../api";
import { attributeLabel, splitAttributes } from "../participationVocab";
import { colors } from "../theme";
import { AttributePicker } from "./AttributePicker";
import { SettingsSection } from "./form";
import { Button, inputStyle, labelStyle } from "./ui";
import { ErrorMessage } from "./admin/adminUi";

// "Participation experience" for vendor listings (Release 2) — a section
// that sits alongside the program/experience/club editor's own sections but
// saves on its own (server/src/routes/vendorParticipation.ts), so it can
// never overwrite, or be overwritten by, the main form's Save. Its button
// says so. Fields shown depend on what each type was missing.

// Trust & Retention — "Who welcomes newcomers" on every type: a role or first
// name and where to find them. Public, so the server refuses phone numbers
// and email addresses.
const NEWCOMER = {
  key: "newcomerWelcome" as const,
  label: "Who welcomes newcomers",
  placeholder: "e.g. Our coach Ciara meets first-timers at the front desk 10 minutes before the start.",
  help: "Shown publicly. Use a role or first name and where to find them — no phone numbers or email addresses.",
  maxLength: 300,
};
const FIELDS: Record<VendorParticipationType, { key: "arrivalInstructions" | "accessibilityInfo" | "newcomerWelcome"; label: string; placeholder: string; help?: string; maxLength?: number }[]> = {
  program: [
    { key: "arrivalInstructions", label: "Arrival instructions", placeholder: "e.g. Come to the main reception 10 minutes early for your first session." },
    NEWCOMER,
    { key: "accessibilityInfo", label: "Accessibility", placeholder: "e.g. Studio is on the ground floor; accessible changing room available." },
  ],
  experience: [NEWCOMER, { key: "accessibilityInfo", label: "Accessibility", placeholder: "e.g. Suitable for all-terrain wheelchairs on the first 2 km; accessible parking at the start." }],
  club: [NEWCOMER],
};

export function VendorParticipationEditor({ type, id }: { type: VendorParticipationType; id: string }) {
  const [data, setData] = useState<VendorParticipation | null>(null);
  const [circles, setCircles] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outer = useSectionSave();
  const inWorkspace = useInWorkspace();
  const snapshot = useRef<VendorParticipation | null>(null);

  // A record that failed to load never becomes a blank, saveable form (it
  // would overwrite the real settings on save).
  const [loadError, setLoadError] = useState<unknown>(null);
  const [circlesFailed, setCirclesFailed] = useState(false);
  const load = () => {
    setLoadError(null);
    fetchVendorParticipation(type, id).then(setData).catch(setLoadError);
    setCirclesFailed(false);
    fetchLinkableCircles()
      .then(setCircles)
      .catch(() => {
        setCircles([]);
        setCirclesFailed(true);
      });
  };
  useEffect(load, [type, id]);

  if (loadError && !data) return <ErrorMessage error={loadError} onRetry={load} title="Couldn't load participation settings" />;
  if (!data) return null;

  const update = (patch: Partial<VendorParticipation>) => {
    setData((d) => (d ? { ...d, ...patch } : d));
    setSaved(false);
  };

  const save = async (): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      setData(await saveVendorParticipation(type, id, data));
      setSaved(true);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const { primary, rest } = splitAttributes(data.attributes);
  const summary = primary.length ? [...primary.map(attributeLabel), ...(rest.length ? [`+${rest.length} more`] : [])].join(" · ") : "Not added";

  // In a workspace editor this section is a card with its own popup: it saves
  // separately from the rest of the form, so it gets its own SectionSave.
  const own: SectionSave = {
    save,
    saving,
    errors: error ? [{ field: "save", message: error }] : [],
    isDirty: () => JSON.stringify(snapshot.current) !== JSON.stringify(data),
    openKey: outer?.openKey,
    setOpenKey: outer?.setOpenKey,
    begin: () => {
      snapshot.current = data;
    },
    cancel: () => {
      if (snapshot.current) setData(snapshot.current);
      setError(null);
    },
  };
  const popup = inWorkspace;
  return (
    <SectionSaveContext.Provider value={popup ? own : outer}>
    <SettingsSection title="Participation experience" summary={summary}>
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: 0 }}>
        Helps people who've never been feel comfortable coming. Tick only what's true of how this runs — the first three show on your listing.
      </p>
      <AttributePicker value={data.attributes} onChange={(attributes) => update({ attributes })} />
      {FIELDS[type].map((f) => (
        <div key={f.key}>
          <label htmlFor={`participation-${type}-${f.key}`} style={labelStyle}>{f.label} (optional)</label>
          <textarea
            id={`participation-${type}-${f.key}`}
            value={data[f.key] ?? ""}
            onChange={(e) => update({ [f.key]: e.target.value })}
            placeholder={f.placeholder}
            maxLength={f.maxLength}
            aria-describedby={f.help ? `participation-${type}-${f.key}-help` : undefined}
            rows={2}
            style={{ ...inputStyle, resize: "vertical" }}
          />
          {f.help && (
            <p id={`participation-${type}-${f.key}-help`} style={{ fontSize: 12, color: colors.mutedLight, margin: "4px 0 0" }}>
              {f.help}
            </p>
          )}
        </div>
      ))}
      <div>
        <label style={labelStyle}>Official Circle (optional)</label>
        {circlesFailed ? (
          <p role="alert" style={{ fontSize: 12.5, color: colors.danger, margin: 0 }}>
            Couldn't load the Circles you can link. The current link is kept.{" "}
            <button type="button" className="btn-reset" style={{ textDecoration: "underline", fontWeight: 700 }} onClick={load}>
              Try again
            </button>
          </p>
        ) : circles.length > 0 ? (
          <select value={data.circleId ?? ""} onChange={(e) => update({ circleId: e.target.value || null })} style={inputStyle}>
            <option value="">None</option>
            {circles.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        ) : (
          <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: 0 }}>
            People who come can join your Circle afterwards. To connect one, link your personal HelloCircle account (Manage → Personal) and create or organise the Circle there.
          </p>
        )}
      </div>
      {!popup && error && <div style={{ fontSize: 12.5, color: colors.danger }}>{error}</div>}
      {!popup && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : saved ? "Saved" : "Save participation details"}</Button>
          <span style={{ fontSize: 12, color: colors.faint }}>Saves separately from the rest of this form.</span>
        </div>
      )}
    </SettingsSection>
    </SectionSaveContext.Provider>
  );
}
