import { useEffect, useMemo, useState } from "react";
import { fetchOrgCapabilities, previewOrgCapabilities, saveOrgCapabilities } from "../../api";
import { AdminButton, Badge, ErrorMessage, errorMessage } from "./adminUi";
import { useAdminCan } from "./adminPermissions";
import { useToast } from "../Toast";
import { VENDOR_TABS } from "../workspace/PartnerWorkspace";
import { vendorTabAvailable } from "../../vendorTabAccess";
import type { CapabilityDefinition, CapabilityPreview, CapabilityState, OrgCapabilityView } from "../../types";

// Configuration framework Phase C — the Capabilities section of the admin
// organisation record page. What this organisation may use, from a starting
// template plus individual changes. Nothing is saved until the admin reviews
// the change: the server checks dependencies, says what already exists under
// anything being switched off (nothing is ever deleted or hidden), and shows
// the partner navigation that results. Platform switches and commercial gates
// still apply on top — a capability can't open them.

const GROUPS: { key: CapabilityDefinition["group"]; label: string }[] = [
  { key: "listing", label: "Listings" },
  { key: "operations", label: "Operations" },
  { key: "commercial", label: "Commercial" },
];

export function OrgCapabilities({ orgId, orgName }: { orgId: string; orgName: string }) {
  const canManage = useAdminCan()("orgs.manage");
  const toast = useToast();
  const [view, setView] = useState<OrgCapabilityView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [template, setTemplate] = useState<string | null>(null);
  const [review, setReview] = useState<CapabilityPreview | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    fetchOrgCapabilities(orgId)
      .then((v) => {
        setView(v);
        setDraft(Object.fromEntries(v.states.map((s) => [s.key, s.orgEnabled])));
        setLimits(Object.fromEntries(v.states.flatMap((s) => Object.entries(s.limits).map(([k, n]) => [`${s.key}.${k}`, n]))));
        setTemplate(v.template);
        setReview(null);
      })
      .catch(setError);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [orgId]);

  const saved = useMemo(() => new Map((view?.states ?? []).map((s) => [s.key, s])), [view]);
  if (error) return <ErrorMessage error={error} title="Couldn't load capabilities" onRetry={load} />;
  if (!view) return <p className="adm-note" role="status">Loading capabilities…</p>;

  const enabledChanges = Object.fromEntries(Object.entries(draft).filter(([k, v]) => saved.get(k)?.orgEnabled !== v));
  const limitChanges = Object.fromEntries(
    Object.entries(limits).filter(([path, n]) => {
      const [k, l] = path.split(".");
      return saved.get(k)?.limits[l] !== n;
    })
  );
  const templateChanged = template !== view.template;
  const dirty = Object.keys(enabledChanges).length > 0 || Object.keys(limitChanges).length > 0 || templateChanged;
  // The full set is sent (the server records only real differences), so a
  // template applied here and then adjusted saves exactly what is on screen.
  const fullSet = Object.fromEntries(view.capabilities.filter((c) => c.status === "available").map((c) => [c.key, draft[c.key] ?? true]));
  const change = { template: templateChanged ? template : undefined, enabled: fullSet, limits: limitChanges };

  const applyTemplate = (key: string) => {
    const t = view.templates.find((x) => x.key === key);
    if (!t) return;
    setTemplate(key);
    setDraft(Object.fromEntries(view.capabilities.map((c) => [c.key, c.status === "available" && t.capabilities.includes(c.key)])));
    setReview(null);
  };
  const toggle = (key: string, on: boolean) => {
    setDraft((d) => ({ ...d, [key]: on }));
    setReview(null);
  };
  const reviewChange = async () => {
    setBusy(true);
    setReview(await previewOrgCapabilities(orgId, change));
    setBusy(false);
  };
  const save = async () => {
    setBusy(true);
    try {
      const v = await saveOrgCapabilities(orgId, { ...change, configVersion: view.configVersion, reason: reason.trim() || undefined });
      toast.success(`Capabilities saved for ${orgName}`);
      setReason("");
      setView(v);
      setDraft(Object.fromEntries(v.states.map((s) => [s.key, s.orgEnabled])));
      setTemplate(v.template);
      setReview(null);
    } catch (e) {
      setReview({ ok: false, error: errorMessage(e, "Couldn't save") });
    } finally {
      setBusy(false);
    }
  };

  const shownStates: CapabilityState[] = review?.ok && review.states ? review.states : view.states;
  const effectiveMap = Object.fromEntries(shownStates.map((s) => [s.key, s.effective]));
  const owner = { invitedStaff: false, platformRole: null };
  const navPreview = VENDOR_TABS.filter((t) => vendorTabAvailable(t.key, owner, effectiveMap));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label htmlFor={`tpl-${orgId}`} className="adm-section-label" style={{ display: "block", marginTop: 0 }}>Starting template</label>
          <select id={`tpl-${orgId}`} className="adm-select" value={template ?? ""} disabled={!canManage || busy} onChange={(e) => e.target.value && applyTemplate(e.target.value)}>
            <option value="">{view.template ? "—" : "None chosen yet"}</option>
            {view.templates.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <p className="adm-note" style={{ margin: 0, flex: "1 1 260px" }}>
          {template ? view.templates.find((t) => t.key === template)?.description : "A template only sets the starting capabilities; change any of them below."} Nothing is saved until you review the change.
        </p>
      </div>

      {GROUPS.map((g) => (
        <fieldset key={g.key} style={{ border: "none", margin: 0, padding: 0 }}>
          <legend className="adm-section-label" style={{ marginTop: 0 }}>{g.label}</legend>
          <ul className="wd-rows" style={{ marginTop: 6 }}>
            {view.capabilities.filter((c) => c.group === g.key).map((c) => {
              const s = saved.get(c.key)!;
              const on = draft[c.key] ?? s.orgEnabled;
              const unavailable = c.status !== "available";
              const missingDeps = c.dependsOn.filter((d) => !(draft[d] ?? saved.get(d)?.orgEnabled));
              const inputId = `cap-${orgId}-${c.key}`;
              return (
                <li key={c.key} style={{ alignItems: "flex-start" }}>
                  <input id={inputId} type="checkbox" checked={on && !unavailable} disabled={!canManage || unavailable || busy} onChange={(e) => toggle(c.key, e.target.checked)} aria-describedby={`${inputId}-d`} style={{ accentColor: "var(--color-green)", width: 16, height: 16, marginTop: 3 }} />
                  <div className="wd-rows-main">
                    <label htmlFor={inputId} className="wd-ctx-name" style={{ cursor: unavailable ? "default" : "pointer" }}>{c.label}</label>
                    <span id={`${inputId}-d`} className="wd-ctx-sub">
                      {unavailable ? c.unavailableReason : c.description}
                      {!unavailable && view.usage[c.key] ? ` · ${view.usage[c.key]} in use` : ""}
                    </span>
                    {(c.limits ?? []).map((l) => {
                      const path = `${c.key}.${l.key}`;
                      return (
                        <label key={path} className="wd-ctx-sub" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                          {l.label}
                          <input type="number" min={1} max={l.max} value={limits[path] ?? l.max} disabled={!canManage || !on || busy} onChange={(e) => { setLimits((x) => ({ ...x, [path]: Math.max(1, Math.min(l.max, Math.floor(Number(e.target.value) || 1))) })); setReview(null); }} style={{ width: 70 }} className="adm-input" />
                          <span>(up to {l.max})</span>
                        </label>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {unavailable && <Badge tone="outline">Needs a platform decision</Badge>}
                    {!unavailable && c.platformSwitch && !s.platformOn && <Badge tone="warn">Off for everyone: {c.platformSwitch.label}</Badge>}
                    {!unavailable && on && missingDeps.length > 0 && <Badge tone="bad">Needs {missingDeps.map((d) => view.capabilities.find((x) => x.key === d)?.label).join(", ")}</Badge>}
                    {!unavailable && on && s.effective && missingDeps.length === 0 && <Badge tone="good">In use</Badge>}
                  </div>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}

      {canManage && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, borderTop: "1px solid var(--color-border)", paddingTop: 14 }}>
          {!review && (
            <div>
              <AdminButton variant="primary" disabled={!dirty || busy} onClick={reviewChange}>Review changes</AdminButton>
              {!dirty && <span className="adm-note" style={{ marginLeft: 10 }}>No changes.</span>}
            </div>
          )}
          {review && !review.ok && <p className="adm-callout" role="alert">{review.error}</p>}
          {review?.ok && (
            <div role="region" aria-label="Review the change" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {(review.impact ?? []).length > 0 ? (
                <div>
                  <div className="adm-section-label" style={{ marginTop: 0 }}>Switching off</div>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13.5 }}>
                    {review.impact!.map((i) => (
                      <li key={i.key}>
                        <strong>{i.label}</strong>{i.existing ? ` — ${i.existing} already exist.` : "."} {i.whenOff}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="adm-note" style={{ margin: 0 }}>Nothing this organisation uses today is switched off.</p>
              )}
              <div>
                <div className="adm-section-label" style={{ marginTop: 0 }}>Partner workspace after this change (owner's view)</div>
                <p style={{ margin: "6px 0 0", fontSize: 13.5 }}>{navPreview.map((t) => t.label).join(" · ")}</p>
              </div>
              <div>
                <label htmlFor={`cap-reason-${orgId}`} className="adm-section-label" style={{ display: "block", marginTop: 0 }}>Reason (optional, kept in the audit log)</label>
                <textarea id={`cap-reason-${orgId}`} className="adm-input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: "100%" }} />
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <AdminButton variant="primary" disabled={busy} aria-busy={busy} onClick={save}>{busy ? "Saving…" : "Save capabilities"}</AdminButton>
                <AdminButton disabled={busy} onClick={() => setReview(null)}>Back to editing</AdminButton>
                <AdminButton disabled={busy} onClick={load}>Discard changes</AdminButton>
              </div>
            </div>
          )}
        </div>
      )}
      {!canManage && <p className="adm-note" style={{ margin: 0 }}>You can see this organisation's capabilities; changing them needs the organisation management permission.</p>}
    </div>
  );
}
