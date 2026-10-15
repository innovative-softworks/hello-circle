import { useAdminCan } from "./adminPermissions";
import { OrganisationRecord } from "./AdminOrganisationRecord";
import { useRecordParam } from "../../useUrlTab";
import { useEffect, useId, useState } from "react";
import { Building2, ChevronDown, ChevronRight } from "lucide-react";
import {
  createAdminOrganisation,
  fetchAdminDemand,
  fetchAdminIntentClusters,
  fetchAdminOrganisations,
  fetchAdminReferrals,
  fetchAdminVendors,
  fetchAnalyticsFunnel,
  fetchMarketplaceHealth,
  fetchNotificationTemplates,
  fetchOrgFeatureFlags,
  notifyIntentCluster,
  resetNotificationTemplate,
  setNotificationTemplate,
  setOrgFeatureFlag,
} from "../../api";
import { FEATURE_FLAG_KEYS, FEATURE_FLAG_LABELS } from "../../types";
import type { FeatureFlagKey, FeatureFlags, NotificationTemplateInfo } from "../../types";
import { useConfirm } from "../ConfirmProvider";
import { DemandSignalsView, IntentClusterView } from "../DemandSignals";
import { MarketplaceHealthView } from "../MarketplaceHealth";
import { AdminButton, Badge, Box, EmptyMessage, ErrorMessage, FormField, Loaded, LoadingRows, Pager, SearchField, SectionLabel, Toolbar, matches, useAdminAction, useAdminData, usePaged } from "./adminUi";

// Organisations, Notification templates, Demand and Marketplace health
// (admin redesign 2026-10-14) — same endpoints and rules as before.

// --- organisations -------------------------------------------------------------

function OrgFlags({ orgId, orgName }: { orgId: string; orgName: string }) {
  const canManage = useAdminCan()("orgs.manage");
  const [flags, setFlags] = useState<FeatureFlags | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { run, busy } = useAdminAction();
  useEffect(() => {
    fetchOrgFeatureFlags(orgId).then(setFlags).catch(setError);
  }, [orgId]);
  if (error) return <ErrorMessage error={error} title="Couldn't load feature flags" />;
  if (!flags) return <p className="adm-note" role="status">Loading feature flags…</p>;
  const toggle = (key: FeatureFlagKey) => {
    const next = !flags[key];
    run(key, () => setOrgFeatureFlag(orgId, key, next), { success: `${FEATURE_FLAG_LABELS[key]} ${next ? "on" : "off"} for ${orgName}` }).then((ok) => ok && setFlags({ ...flags, [key]: next }));
  };
  return (
    <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
      <legend className="adm-section-label" style={{ marginTop: 0 }}>
        Feature flags
      </legend>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        {FEATURE_FLAG_KEYS.map((key) => (
          <label key={key} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, cursor: "pointer" }}>
            <input type="checkbox" checked={flags[key]} disabled={!!busy || !canManage} onChange={() => toggle(key)} style={{ accentColor: "var(--color-green)", width: 16, height: 16 }} />
            {FEATURE_FLAG_LABELS[key]}
          </label>
        ))}
      </div>
      <p className="adm-note" style={{ marginTop: 8 }}>Changes apply immediately and are enforced by the server for this organisation.</p>
    </fieldset>
  );
}

export function AdminOrganisationsPage({ onOpenVendor }: { onOpenVendor: (vendorId: string) => void }) {
  const canManage = useAdminCan()("orgs.manage");
  // D-01 — each organisation opens as its own record page.
  const [record, openRecord, closeRecord] = useRecordParam();
  const orgs = useAdminData(fetchAdminOrganisations);
  const vendors = useAdminData(fetchAdminVendors);
  const { run, busy } = useAdminAction();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("council");
  const [tried, setTried] = useState(false);
  const kindId = useId();

  const all = orgs.data ?? [];
  const vendorOrgs = all.filter((o) => o.kind === "vendor" && matches(q, o.name));
  const customOrgs = all.filter((o) => o.kind !== "vendor");
  const paged = usePaged(vendorOrgs, 20, q);
  const openOrg = record?.startsWith("org:") ? record.slice(4) : null;
  const nameError = tried && !name.trim() ? "Enter the organisation's name." : null;
  const create = () => {
    setTried(true);
    if (!name.trim()) return;
    run("create", () => createAdminOrganisation({ name: name.trim(), kind }), { success: `${name.trim()} created` }).then((ok) => {
      if (ok) {
        setName("");
        setTried(false);
        orgs.reload();
      }
    });
  };

  if (openOrg) {
    const name = all.find((o) => o.id === openOrg)?.name ?? "this organisation";
    return (
      <OrganisationRecord
        orgId={openOrg}
        backLabel="Organisations"
        onBack={closeRecord}
        onOpenVendor={onOpenVendor}
        onChanged={orgs.reload}
        flags={
          <>
            <SectionLabel>Feature flags</SectionLabel>
            <OrgFlags orgId={openOrg} orgName={name} />
          </>
        }
      />
    );
  }

  return (
    <div className="adm-stack">
      <Box title="Partner organisations" subtitle="Created automatically for every partner at signup. Staff invites and platform roles are scoped to these. Partners manage their own profile; you can switch feature flags here." flush>
        <Toolbar label="Search organisations">
          <SearchField label="Search organisations" value={q} onChange={setQ} placeholder="Organisation name" />
        </Toolbar>
        <Loaded state={orgs}>
          {() =>
            vendorOrgs.length === 0 ? (
              <EmptyMessage icon={<Building2 size={22} strokeWidth={1.9} aria-hidden="true" />} title={q ? "No organisations match" : "No partner organisations yet"} />
            ) : (
              <>
                <ul className="adm-queue">
                  {paged.slice.map((o) => {
                    const members = (vendors.data ?? []).filter((v) => v.orgId === o.id);
                    const owner = members.find((v) => !v.invitedStaff);
                    const isOpen = expanded === o.id;
                    return (
                      <li key={o.id} style={{ display: "block" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                          <button type="button" className="adm-row-button" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : o.id)} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                            {isOpen ? <ChevronDown size={18} strokeWidth={1.9} aria-hidden="true" /> : <ChevronRight size={18} strokeWidth={1.9} aria-hidden="true" />}
                            <span className="adm-cell-title">{o.name}</span>
                          </button>
                          {o.status === "suspended" && <Badge tone="bad">Organisation suspended</Badge>}
                          <AdminButton size="sm" onClick={() => openRecord(`org:${o.id}`)} aria-label={`Open ${o.name}`}>
                            Open
                          </AdminButton>
                          <span className="adm-cell-sub">
                            {vendors.data ? `${members.length} ${members.length === 1 ? "member" : "members"}` : "…"}
                          </span>
                          {owner && (
                            <AdminButton size="sm" onClick={() => onOpenVendor(owner.id)}>
                              View partner
                            </AdminButton>
                          )}
                        </div>
                        {isOpen && (
                          <div style={{ padding: "12px 0 4px 24px" }}>
                            <OrgFlags orgId={o.id} orgName={o.name} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <Pager {...paged} noun="organisations" />
              </>
            )
          }
        </Loaded>
      </Box>

      <Box title="Custom organisations" subtitle="Scaffolding for a future multi-organisation setup (for example a council overseeing several centres). Assigning a listing to one has no effect on visibility or access today.">
        {canManage && <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
          style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 16 }}
        >
          <FormField label="Name" required error={nameError} style={{ flex: "1 1 240px" }}>
            {(p) => <input {...p} className="adm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dublin City Council" />}
          </FormField>
          <div className="adm-field">
            <label htmlFor={kindId}>Kind</label>
            <select id={kindId} className="adm-select" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="council">Council</option>
              <option value="charity">Charity</option>
              <option value="school">School</option>
              <option value="private">Private</option>
            </select>
          </div>
          <AdminButton type="submit" variant="primary" disabled={busy === "create"} style={{ marginTop: 25 }}>
            {busy === "create" ? "Creating…" : "Create organisation"}
          </AdminButton>
        </form>}
        {orgs.data === null && !orgs.error ? (
          <LoadingRows rows={2} />
        ) : customOrgs.length === 0 ? (
          <p className="adm-note">No custom organisations yet.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, border: "1px solid var(--color-border)" }}>
            {customOrgs.map((o) => (
              <li key={o.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--color-border)" }}>
                <span className="adm-cell-title">{o.name}</span>
                <Badge tone="outline">{o.kind.charAt(0).toUpperCase() + o.kind.slice(1)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Box>
    </div>
  );
}

// --- notification templates ------------------------------------------------------

function TemplateEditor({ t, onSaved }: { t: NotificationTemplateInfo; onSaved: () => void }) {
  const can = useAdminCan();
  const confirm = useConfirm();
  const { run, busy } = useAdminAction();
  const [subject, setSubject] = useState(t.subjectTemplate ?? "");
  const [title, setTitle] = useState(t.titleTemplate ?? "");
  const [body, setBody] = useState(t.bodyTemplate ?? "");
  const base = useId();
  const custom = t.subjectTemplate !== null || t.titleTemplate !== null || t.bodyTemplate !== null;
  const dirty = subject !== (t.subjectTemplate ?? "") || title !== (t.titleTemplate ?? "") || body !== (t.bodyTemplate ?? "");

  const save = () =>
    run(
      "save",
      () =>
        setNotificationTemplate(t.key, {
          subjectTemplate: t.fields.includes("subject") ? subject || null : undefined,
          titleTemplate: t.fields.includes("title") ? title || null : undefined,
          bodyTemplate: t.fields.includes("body") ? body || null : undefined,
        }),
      { success: "Template saved" }
    ).then((ok) => ok && onSaved());
  const reset = async () => {
    if (!(await confirm({ title: "Reset to the default wording?", message: "Your custom subject, title and body for this notification will be discarded.", confirmLabel: "Reset", tone: "danger" }))) return;
    const ok = await run("reset", () => resetNotificationTemplate(t.key), { success: "Template reset to default" });
    if (ok) {
      setSubject("");
      setTitle("");
      setBody("");
      onSaved();
    }
  };

  return (
    <Box title={<span className="adm-mono" style={{ fontSize: 14 }}>{t.key}</span>} subtitle={t.description} headingLevel={3} actions={custom ? <Badge tone="good">Custom wording</Badge> : <Badge tone="neutral">Default wording</Badge>}>
      <p className="adm-note" style={{ marginBottom: 12 }}>
        Placeholders: {t.vars.map((v) => `{{${v}}}`).join(", ")}. Leave a field blank to use the built-in default.
      </p>
      <div style={{ display: "grid", gap: 10 }}>
        {t.fields.includes("subject") && (
          <div className="adm-field">
            <label htmlFor={`${base}-s`}>Email subject</label>
            <input id={`${base}-s`} className="adm-input" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
        )}
        {t.fields.includes("title") && (
          <div className="adm-field">
            <label htmlFor={`${base}-t`}>In-app title</label>
            <input id={`${base}-t`} className="adm-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
        )}
        {t.fields.includes("body") && (
          <div className="adm-field">
            <label htmlFor={`${base}-b`}>Body</label>
            <textarea id={`${base}-b`} className="adm-input" rows={4} value={body} onChange={(e) => setBody(e.target.value)} style={{ resize: "vertical" }} />
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {can("templates.edit") && (
          <AdminButton variant="primary" onClick={save} disabled={!dirty || !!busy}>
            {busy === "save" ? "Saving…" : "Save"}
          </AdminButton>
        )}
        {custom && can("templates.delete") && (
          <AdminButton onClick={reset} disabled={!!busy}>
            Reset to default
          </AdminButton>
        )}
      </div>
    </Box>
  );
}

export function AdminNotificationTemplatesPage() {
  const state = useAdminData(fetchNotificationTemplates);
  return (
    <div className="adm-stack">
      <p className="adm-note" style={{ maxWidth: 720 }}>
        Covers the confirmation and cancellation messages sent for every booking, registration, experience booking and program enrollment. Other notifications (waitlist offers, game updates, Circle activity) aren't covered here yet and keep their built-in wording.
      </p>
      <Loaded state={state}>{(templates) => <>{templates.map((t) => <TemplateEditor key={t.key} t={t} onSaved={state.reload} />)}</>}</Loaded>
    </div>
  );
}

// --- demand / marketplace health ----------------------------------------------------

export function AdminDemandPage() {
  const canNotify = useAdminCan()("demand.notify");
  const rows = useAdminData(fetchAdminDemand);
  const clusters = useAdminData(fetchAdminIntentClusters);
  return (
    <div className="adm-stack">
      {clusters.error ? <ErrorMessage error={clusters.error} onRetry={clusters.reload} /> : <IntentClusterView clusters={clusters.data} onNotify={canNotify ? notifyIntentCluster : undefined} />}
      {rows.error ? (
        <ErrorMessage error={rows.error} onRetry={rows.reload} />
      ) : (
        <DemandSignalsView title="Unmet demand, platform-wide" subtitle="Searches that returned nothing, aggregated across every partner — useful for spotting a gap nobody lists yet." rows={rows.data} />
      )}
    </div>
  );
}

export function AdminMarketplaceHealthPage({ onOpenSettings }: { onOpenSettings: () => void }) {
  const data = useAdminData(fetchMarketplaceHealth);
  const referrals = useAdminData(() => fetchAdminReferrals().catch(() => []));
  const funnel = useAdminData(() => fetchAnalyticsFunnel().catch(() => []));
  return (
    <div className="adm-stack">
      <p className="adm-note">
        Market categories and For You weights moved to{" "}
        <button type="button" className="adm-metric-link" style={{ margin: 0 }} onClick={onOpenSettings}>
          Settings
        </button>
        .
      </p>
      <Loaded state={data}>{(d) => <MarketplaceHealthView data={d} referrals={referrals.data} funnel={funnel.data} />}</Loaded>
    </div>
  );
}
