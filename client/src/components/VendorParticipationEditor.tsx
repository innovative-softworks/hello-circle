import { useEffect, useState } from "react";
import { fetchLinkableCircles, fetchVendorParticipation, saveVendorParticipation, type VendorParticipation, type VendorParticipationType } from "../api";
import { attributeLabel, splitAttributes } from "../participationVocab";
import { colors } from "../theme";
import { AttributePicker } from "./AttributePicker";
import { SettingsSection } from "./form";
import { Button, inputStyle, labelStyle } from "./ui";

// "Participation experience" for vendor listings (Release 2) — a section
// that sits alongside the program/experience/club editor's own sections but
// saves on its own (server/src/routes/vendorParticipation.ts), so it can
// never overwrite, or be overwritten by, the main form's Save. Its button
// says so. Fields shown depend on what each type was missing.

const FIELDS: Record<VendorParticipationType, { key: "arrivalInstructions" | "accessibilityInfo"; label: string; placeholder: string }[]> = {
  program: [
    { key: "arrivalInstructions", label: "Arrival instructions", placeholder: "e.g. Come to the main reception 10 minutes early for your first session." },
    { key: "accessibilityInfo", label: "Accessibility", placeholder: "e.g. Studio is on the ground floor; accessible changing room available." },
  ],
  experience: [{ key: "accessibilityInfo", label: "Accessibility", placeholder: "e.g. Suitable for all-terrain wheelchairs on the first 2 km; accessible parking at the start." }],
  club: [],
};

export function VendorParticipationEditor({ type, id }: { type: VendorParticipationType; id: string }) {
  const [data, setData] = useState<VendorParticipation | null>(null);
  const [circles, setCircles] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchVendorParticipation(type, id)
      .then(setData)
      .catch(() => setData({ attributes: [] }));
    fetchLinkableCircles()
      .then(setCircles)
      .catch(() => setCircles([]));
  }, [type, id]);

  if (!data) return null;

  const update = (patch: Partial<VendorParticipation>) => {
    setData((d) => (d ? { ...d, ...patch } : d));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      setData(await saveVendorParticipation(type, id, data));
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const { primary, rest } = splitAttributes(data.attributes);
  const summary = primary.length ? [...primary.map(attributeLabel), ...(rest.length ? [`+${rest.length} more`] : [])].join(" · ") : "Not added";

  return (
    <SettingsSection title="Participation experience" summary={summary}>
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: 0 }}>
        Helps people who've never been feel comfortable coming. Tick only what's true of how this runs — the first three show on your listing.
      </p>
      <AttributePicker value={data.attributes} onChange={(attributes) => update({ attributes })} />
      {FIELDS[type].map((f) => (
        <div key={f.key}>
          <label style={labelStyle}>{f.label} (optional)</label>
          <textarea
            value={data[f.key] ?? ""}
            onChange={(e) => update({ [f.key]: e.target.value })}
            placeholder={f.placeholder}
            rows={2}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </div>
      ))}
      <div>
        <label style={labelStyle}>Official Circle (optional)</label>
        {circles.length > 0 ? (
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
      {error && <div style={{ fontSize: 12.5, color: colors.danger }}>{error}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : saved ? "Saved" : "Save participation details"}</Button>
        <span style={{ fontSize: 12, color: colors.faint }}>Saves separately from the rest of this form.</span>
      </div>
    </SettingsSection>
  );
}
