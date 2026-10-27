import { useEffect, useRef, useState } from "react";
import { DISCOVERY_TAG_LABELS, fetchVendorClassification, saveVendorClassification, type DiscoveryTag, type VendorClassifiableType, type VendorClassification } from "../api";
import { colors } from "../theme";
import { ErrorMessage } from "./admin/adminUi";
import { CategoryPicker, describeCategory, TagPicker, type CategoryValue } from "./categories/CategoryPicker";
import { SettingsSection } from "./form";
import { Button } from "./ui";
import { useInWorkspace } from "./workspace/inWorkspace";
import { SectionSaveContext, useSectionSave, type SectionSave } from "./workspace/sectionSave";

// Category system — "Category" section for vendor programme / experience /
// club / venue editors. Saves on its own endpoint
// (server/src/routes/vendorParticipation.ts → /vendor/classification), the
// same way VendorParticipationEditor does, so the main form's Save can never
// overwrite it. Vendors pick from approved categories only.

interface Draft {
  category: CategoryValue | null;
  tags: string[];
}

export function VendorCategoryEditor({ type, id }: { type: VendorClassifiableType; id: string }) {
  const [data, setData] = useState<VendorClassification | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outer = useSectionSave();
  const inWorkspace = useInWorkspace();
  const snapshot = useRef<Draft | null>(null);

  const load = () => {
    setLoadError(null);
    fetchVendorClassification(type, id)
      .then((d) => {
        setData(d);
        setDraft({ category: d.taxonomy ? { categoryId: d.taxonomy.categoryId, subcategoryId: d.taxonomy.subcategoryId } : null, tags: d.tags });
      })
      .catch(setLoadError);
  };
  useEffect(load, [type, id]);

  // A record that failed to load never becomes a blank, saveable form.
  if (loadError && !data) return <ErrorMessage error={loadError} onRetry={load} title="Couldn't load the category" />;
  if (!data || !draft) return null;

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setSaved(false);
  };

  const save = async (): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const res = await saveVendorClassification(type, id, { categoryId: draft.category?.categoryId ?? null, subcategoryId: draft.category?.subcategoryId ?? null, tags: draft.tags });
      setData({ ...data, taxonomy: res.taxonomy, tags: res.tags });
      setSaved(true);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const described = describeCategory(data.options, draft.category, data.taxonomy);
  const summary = described
    ? [described.sub ? `${described.name} › ${described.sub}` : described.name, ...draft.tags.map((t) => DISCOVERY_TAG_LABELS[t as DiscoveryTag] ?? t)].join(" · ")
    : "Not added";

  const own: SectionSave = {
    save,
    saving,
    errors: error ? [{ field: "save", message: error }] : [],
    isDirty: () => JSON.stringify(snapshot.current) !== JSON.stringify(draft),
    openKey: outer?.openKey,
    setOpenKey: outer?.setOpenKey,
    begin: () => {
      snapshot.current = draft;
    },
    cancel: () => {
      if (snapshot.current) setDraft(snapshot.current);
      setError(null);
    },
  };
  const popup = inWorkspace;
  return (
    <SectionSaveContext.Provider value={popup ? own : outer}>
      <SettingsSection title="Category" summary={summary}>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: 0 }}>
          Where people find this when they browse by activity. Your listing title stays as you wrote it.
        </p>
        <CategoryPicker
          family={data.family}
          categories={data.options}
          current={data.taxonomy}
          value={draft.category}
          onChange={(category) => update({ category })}
          error={error && /categor/i.test(error) ? error : undefined}
        />
        <TagPicker value={draft.tags} onChange={(tags) => update({ tags })} />
        {!popup && error && !/categor/i.test(error) && <div style={{ fontSize: 12.5, color: colors.danger }}>{error}</div>}
        {!popup && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : saved ? "Saved" : "Save category"}</Button>
            <span style={{ fontSize: 12, color: colors.faint }}>Saves separately from the rest of this form.</span>
          </div>
        )}
      </SettingsSection>
    </SectionSaveContext.Provider>
  );
}
