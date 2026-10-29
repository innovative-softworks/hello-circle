import { useEffect, useMemo, useState } from "react";
import { fetchOrgCategoryAccess, saveOrgCategoryAccess, FAMILY_LABELS, type OrgCategoryAccessView } from "../../api";
import { AdminButton, Badge, ErrorMessage, errorMessage } from "./adminUi";
import { useAdminCan } from "./adminPermissions";
import { useToast } from "../Toast";

// Configuration framework Phase E — "Allowed categories" on the admin
// organisation record page. Either every active category (today's default),
// or only chosen ones; any category can be narrowed to some subcategories,
// and "approved organisations only" categories need an explicit tick. The
// server validates every id and enforces the result on partner forms; a
// listing that already has a category keeps it whatever is changed here.

type Grant = "*" | string[];

export function OrgCategories({ orgId, orgName }: { orgId: string; orgName: string }) {
  const canManage = useAdminCan()("orgs.manage");
  const toast = useToast();
  const [view, setView] = useState<OrgCategoryAccessView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [mode, setMode] = useState<"all" | "restricted">("all");
  const [grants, setGrants] = useState<Record<string, Grant>>({});
  const [family, setFamily] = useState<string>("all");
  const [reviewing, setReviewing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const reset = (v: OrgCategoryAccessView) => {
    setView(v);
    setMode(v.mode);
    setGrants(Object.fromEntries(v.grants.map((g) => [g.categoryId, g.subcategoryIds])));
    setReviewing(false);
    setSaveError(null);
  };
  const load = () => {
    setError(null);
    fetchOrgCategoryAccess(orgId).then(reset).catch(setError);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [orgId]);

  const families = useMemo(() => [...new Set((view?.categories ?? []).flatMap((c) => c.families))], [view]);
  if (error) return <ErrorMessage error={error} title="Couldn't load allowed categories" onRetry={load} />;
  if (!view) return <p className="adm-note" role="status">Loading categories…</p>;

  const savedGrants = Object.fromEntries(view.grants.map((g) => [g.categoryId, g.subcategoryIds]));
  const dirty = mode !== view.mode || JSON.stringify(Object.entries(grants).sort()) !== JSON.stringify(Object.entries(savedGrants).sort());
  const shown = view.categories.filter((c) => family === "all" || c.families.includes(family as never));
  const canUse = (id: string, g: Record<string, Grant>, m: "all" | "restricted") => {
    const c = view.categories.find((x) => x.id === id)!;
    return !!g[id] || (m === "all" && c.moderationPolicy !== "eligible_only");
  };
  // Categories with listings that partners could choose before but not after (they keep them).
  const losing = view.categories.filter((c) => (view.usage[c.id] ?? 0) > 0 && canUse(c.id, savedGrants, view.mode) && !canUse(c.id, grants, mode));

  const toggle = (id: string, on: boolean) => {
    setGrants((g) => {
      const next = { ...g };
      if (on) next[id] = "*";
      else delete next[id];
      return next;
    });
    setReviewing(false);
  };
  const setSubs = (id: string, subs: Grant) => {
    setGrants((g) => ({ ...g, [id]: subs }));
    setReviewing(false);
  };
  const useTemplate = () => {
    setMode("restricted");
    setGrants(Object.fromEntries(view.templateCategories.filter((id) => view.categories.some((c) => c.id === id)).map((id) => [id, "*" as Grant])));
    setReviewing(false);
  };
  const save = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      const v = await saveOrgCategoryAccess(orgId, { mode, grants: Object.entries(grants).map(([categoryId, subcategoryIds]) => ({ categoryId, subcategoryIds })), configVersion: view.configVersion, reason: reason.trim() || undefined });
      toast.success(`Allowed categories saved for ${orgName}`);
      setReason("");
      reset(v);
    } catch (e) {
      setSaveError(errorMessage(e, "Couldn't save"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <fieldset style={{ border: "none", margin: 0, padding: 0 }} disabled={!canManage || busy}>
        <legend className="adm-section-label" style={{ marginTop: 0 }}>Partners can choose</legend>
        {(["all", "restricted"] as const).map((m) => (
          <label key={m} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, minHeight: 30 }}>
            <input type="radio" name={`catmode-${orgId}`} checked={mode === m} onChange={() => { setMode(m); setReviewing(false); }} />
            {m === "all" ? "Every active category (except ones for approved organisations only, unless ticked)" : "Only the categories ticked below"}
          </label>
        ))}
      </fieldset>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label className="adm-note" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          Listing type
          <select className="adm-select" value={family} onChange={(e) => setFamily(e.target.value)}>
            <option value="all">All</option>
            {families.map((f) => <option key={f} value={f}>{FAMILY_LABELS[f] ?? f}</option>)}
          </select>
        </label>
        {canManage && view.templateCategories.length > 0 && <AdminButton size="sm" disabled={busy} onClick={useTemplate}>Use the template's categories</AdminButton>}
      </div>
      <ul className="wd-rows">
        {shown.map((c) => {
          const g = grants[c.id];
          const inputId = `oc-${orgId}-${c.id}`;
          return (
            <li key={c.id} style={{ alignItems: "flex-start" }}>
              <input id={inputId} type="checkbox" checked={!!g} disabled={!canManage || busy} onChange={(e) => toggle(c.id, e.target.checked)} style={{ accentColor: "var(--color-green)", width: 16, height: 16, marginTop: 3 }} />
              <div className="wd-rows-main">
                <label htmlFor={inputId} className="wd-ctx-name">{c.name}</label>
                <span className="wd-ctx-sub">
                  {c.families.map((f) => FAMILY_LABELS[f] ?? f).join(", ")}
                  {view.usage[c.id] ? ` · ${view.usage[c.id]} of this organisation's listings use it` : ""}
                  {!canUse(c.id, grants, mode) ? " · not available to its partners" : ""}
                </span>
                {g && c.subcategories.length > 0 && (
                  <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                    <label className="wd-ctx-sub" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={g === "*"} disabled={!canManage || busy} onChange={(e) => setSubs(c.id, e.target.checked ? "*" : c.subcategories.map((s) => s.id))} /> All subcategories
                    </label>
                    {g !== "*" && (
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", paddingLeft: 22 }}>
                        {c.subcategories.map((s) => (
                          <label key={s.id} className="wd-ctx-sub" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input
                              type="checkbox"
                              checked={g.includes(s.id)}
                              disabled={!canManage || busy || (g.length === 1 && g.includes(s.id))}
                              onChange={(e) => setSubs(c.id, e.target.checked ? [...g, s.id] : g.filter((x) => x !== s.id))}
                            />
                            {s.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {c.moderationPolicy === "eligible_only" && <Badge tone="outline">Approved organisations only</Badge>}
                {c.moderationPolicy === "review_required" && <Badge tone="outline">Moves are reviewed</Badge>}
                {!c.active && <Badge tone="warn">Inactive</Badge>}
              </div>
            </li>
          );
        })}
      </ul>
      {canManage && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, borderTop: "1px solid var(--color-border)", paddingTop: 14 }}>
          {!reviewing ? (
            <div>
              <AdminButton variant="primary" disabled={!dirty || busy || (mode === "restricted" && Object.keys(grants).length === 0)} onClick={() => setReviewing(true)}>Review category changes</AdminButton>
              {mode === "restricted" && Object.keys(grants).length === 0 && <span className="adm-note" style={{ marginLeft: 10 }}>Tick at least one category.</span>}
            </div>
          ) : (
            <div role="region" aria-label="Review category changes" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {losing.length > 0 ? (
                <p style={{ margin: 0, fontSize: 13.5 }}>
                  Partners will no longer be able to choose: {losing.map((c) => `${c.name} (${view.usage[c.id]} listings keep it)`).join(", ")}. Nothing is moved or hidden.
                </p>
              ) : (
                <p className="adm-note" style={{ margin: 0 }}>No category this organisation already uses becomes unavailable.</p>
              )}
              <label htmlFor={`oc-reason-${orgId}`} className="adm-section-label" style={{ marginTop: 0 }}>Reason (optional, kept in the audit log)</label>
              <textarea id={`oc-reason-${orgId}`} className="adm-input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              {saveError && <p className="adm-callout" role="alert">{saveError}</p>}
              <div style={{ display: "flex", gap: 10 }}>
                <AdminButton variant="primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save allowed categories"}</AdminButton>
                <AdminButton disabled={busy} onClick={() => setReviewing(false)}>Back to editing</AdminButton>
                <AdminButton disabled={busy} onClick={load}>Discard changes</AdminButton>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
