import { useAdminCan } from "./adminPermissions";
import { OrgCapabilities } from "./OrgCapabilities";
import { OrgCategories } from "./OrgCategories";
import { OrganisationRecord } from "./AdminOrganisationRecord";
import { useRecordParam, useUrlParam } from "../../useUrlTab";
import { useId, useState } from "react";
import { Bell, Building2, Mail, Activity, TrendingUp, Landmark } from "lucide-react";
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
  notifyIntentCluster,
  resetNotificationTemplate,
  setNotificationTemplate,
} from "../../api";
import type { NotificationTemplateInfo } from "../../types";
import { useConfirm } from "../ConfirmProvider";
import { DemandSignalsView, IntentClusterView } from "../DemandSignals";
import { MarketplaceHealthView } from "../MarketplaceHealth";
import { AdminButton, Badge, Box, EmptyMessage, ErrorMessage, FormField, Loaded, LoadingRows, Pager, SearchField, SectionLabel, Toolbar, matches, useAdminAction, useAdminData, usePaged, IconTabs, AdminModal } from "./adminUi";

// Organisations, Notification templates, Demand and Marketplace health
// (admin redesign 2026-10-14) — same endpoints and rules as before.

// --- organisations -------------------------------------------------------------

export function AdminOrganisationsPage({ onOpenVendor }: { onOpenVendor: (vendorId: string) => void }) {
  const canManage = useAdminCan()("orgs.manage");
  // D-01 — each organisation opens as its own record page.
  const [record, openRecord, closeRecord] = useRecordParam();
  const orgs = useAdminData(fetchAdminOrganisations);
  const vendors = useAdminData(fetchAdminVendors);
  const { run, busy } = useAdminAction();
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("council");
  const [tried, setTried] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
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
        setShowCreate(false);
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
        flags={<OrgCapabilities orgId={openOrg} orgName={name} />}
        categories={<OrgCategories orgId={openOrg} orgName={name} />}
      />
    );
  }

  return (
    <div className="adm-stack">
      <Box icon={Building2} title="Partner organisations" subtitle="One per partner, created at signup. Open one to see its members, feature flags and suspension." flush>
        <Toolbar label="Search organisations">
          <SearchField label="Search organisations" value={q} onChange={setQ} placeholder="Organisation name" />
        </Toolbar>
        <Loaded state={orgs}>
          {() =>
            vendorOrgs.length === 0 ? (
              <EmptyMessage icon={<Building2 size={22} strokeWidth={1.9} aria-hidden="true" />} title={q ? "No organisations match" : "No partner organisations yet"} />
            ) : (
              <>
                <ul className="adm-ov-list">
                  {paged.slice.map((o) => {
                    const members = (vendors.data ?? []).filter((v) => v.orgId === o.id);
                    const owner = members.find((v) => !v.invitedStaff);
                    return (
                      <li key={o.id} className="adm-ov-row">
                        <span className="adm-ov-tile">
                          <Building2 size={18} strokeWidth={1.9} aria-hidden="true" />
                        </span>
                        <div className="adm-ov-main">
                          <div className="adm-ov-title">{o.name}</div>
                          <div className="adm-ov-detail">
                            {owner ? (
                              <>
                                Owner:{" "}
                                <button type="button" className="adm-linkish" style={{ fontWeight: 400 }} onClick={() => onOpenVendor(owner.id)}>
                                  {owner.name || owner.email}
                                </button>
                              </>
                            ) : (
                              "No owner found"
                            )}
                          </div>
                        </div>
                        <div className="adm-ov-kind">{vendors.data ? `${members.length} ${members.length === 1 ? "member" : "members"}` : "…"}</div>
                        <div className="adm-ov-when">{o.status === "suspended" ? <Badge tone="bad">Suspended</Badge> : <Badge tone="good">Active</Badge>}</div>
                        <AdminButton size="sm" onClick={() => openRecord(`org:${o.id}`)} aria-label={`Open ${o.name}`}>
                          Open
                        </AdminButton>
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

      <Box
        icon={Landmark}
        title="Custom organisations (experimental)"
        subtitle="For a future setup where, for example, a council oversees several centres. Assigning a listing to one has no effect on visibility or access today."
        actions={canManage ? <AdminButton size="sm" onClick={() => setShowCreate(true)}>New custom organisation</AdminButton> : undefined}
      >
        <AdminModal
          open={showCreate}
          onClose={() => {
            setShowCreate(false);
            setTried(false);
          }}
          dirty={!!name.trim()}
          title="New custom organisation"
          subtitle="Experimental: it has no effect on visibility or access yet."
          footer={
            <>
              <AdminButton variant="quiet" onClick={() => setShowCreate(false)}>
                Cancel
              </AdminButton>
              <AdminButton type="submit" form="adm-new-org" variant="primary" disabled={busy === "create"}>
                {busy === "create" ? "Creating…" : "Create organisation"}
              </AdminButton>
            </>
          }
        >
          <form
            id="adm-new-org"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
            style={{ display: "grid", gap: 14 }}
          >
            <FormField label="Name" required error={nameError}>
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
          </form>
        </AdminModal>

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

// Readable names for the template keys (2026-10-16).
const TEMPLATE_META: Record<string, { event: "new" | "cancel"; who: string; channel: "Email" | "In-app" }> = {
  booking_new_inapp: { event: "new", who: "Partner and admins", channel: "In-app" },
  booking_new_guest_email: { event: "new", who: "Customer", channel: "Email" },
  booking_new_vendor_email: { event: "new", who: "Partner", channel: "Email" },
  booking_new_admin_email: { event: "new", who: "Admins", channel: "Email" },
  booking_cancel_inapp: { event: "cancel", who: "Partner and admins", channel: "In-app" },
  booking_cancel_guest_email: { event: "cancel", who: "Customer", channel: "Email" },
  booking_cancel_vendor_email: { event: "cancel", who: "Partner", channel: "Email" },
  booking_cancel_admin_email: { event: "cancel", who: "Admins", channel: "Email" },
};
const SAMPLE_VARS: Record<string, string> = {
  noun: "booking",
  listingName: "Ballincollig Community Centre",
  ref: "HC-7Q2K",
  guestName: "Aoife Murphy",
  guestEmail: "aoife.murphy@example.ie",
  detailsText: "Sat 24 Oct, 18:00 to 20:00 · Sports Hall",
  manageUrl: "https://hellocircle.ie/my-bookings",
};
const fillSample = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => SAMPLE_VARS[k] ?? `{{${k}}}`);

function TemplateEditor({ t, onSaved, onClose }: { t: NotificationTemplateInfo; onSaved: () => void; onClose: () => void }) {
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
    <div className="adm-tpl-editor">
      <p className="adm-note" style={{ margin: "0 0 12px" }}>
        {t.description} Placeholders: {t.vars.map((v) => `{{${v}}}`).join(", ")}. Leave a field blank to keep the built-in wording.
      </p>
      <div className="adm-tpl-grid">
      <div>
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
      </div>
      <div className="adm-tpl-preview" aria-label="Preview with sample values">
        <div className="adm-section-label" style={{ margin: "0 0 6px" }}>Preview</div>
        {subject || title || body ? (
          <>
            {t.fields.includes("subject") && <div className="adm-cell-title">{fillSample(subject) || <span className="adm-note">Default subject</span>}</div>}
            {t.fields.includes("title") && <div className="adm-cell-title">{fillSample(title) || <span className="adm-note">Default title</span>}</div>}
            {t.fields.includes("body") && <p style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>{fillSample(body) || <span className="adm-note">Default body</span>}</p>}
          </>
        ) : (
          <p className="adm-note" style={{ margin: 0 }}>Using the built-in wording. Type in the fields to preview your own, with sample values filled in.</p>
        )}
      </div>
      </div>
      <div className="adm-dlg-foot" style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--adm-line)" }}>
        {custom && can("templates.delete") && (
          <AdminButton onClick={reset} disabled={!!busy} style={{ marginRight: "auto" }}>
            Reset to default
          </AdminButton>
        )}
        <AdminButton variant="quiet" onClick={onClose}>
          Cancel
        </AdminButton>
        {can("templates.edit") && (
          <AdminButton variant="primary" onClick={save} disabled={!dirty || !!busy}>
            {busy === "save" ? "Saving…" : "Save"}
          </AdminButton>
        )}
      </div>
    </div>
  );
}

export function AdminNotificationTemplatesPage() {
  const state = useAdminData(fetchNotificationTemplates);
  const [open, setOpen] = useState<string | null>(null);
  const isCustom = (t: NotificationTemplateInfo) => t.subjectTemplate !== null || t.titleTemplate !== null || t.bodyTemplate !== null;
  const group = (templates: NotificationTemplateInfo[], event: "new" | "cancel", title: string) => {
    const rows = templates.filter((t) => (TEMPLATE_META[t.key]?.event ?? "new") === event);
    if (!rows.length) return null;
    return (
      <>
        <h3 className="adm-ov-group">
          {title} <span>{rows.length}</span>
        </h3>
        <ul className="adm-ov-list">
          {rows.map((t) => {
            const meta = TEMPLATE_META[t.key];
            const Icon = meta?.channel === "In-app" ? Bell : Mail;
            return (
              <li key={t.key} style={{ display: "block", padding: 0, borderBottom: "1px solid var(--adm-line)" }}>
                <div className="adm-ov-row" style={{ borderBottom: "none" }}>
                  <span className="adm-ov-tile">
                    <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
                  </span>
                  <div className="adm-ov-main">
                    <div className="adm-ov-title">{meta ? `${meta.who}, ${meta.channel.toLowerCase()}` : t.key}</div>
                    <div className="adm-ov-detail">{t.description}</div>
                  </div>
                  <div className="adm-ov-kind">{meta?.channel ?? ""}</div>
                  <div className="adm-ov-when">{isCustom(t) ? <Badge tone="good">Custom wording</Badge> : <Badge tone="neutral">Default wording</Badge>}</div>
                  <AdminButton size="sm" onClick={() => setOpen(t.key)} aria-label={`Edit ${meta ? `${meta.who} ${meta.channel}` : t.key} message`}>
                    Edit
                  </AdminButton>
                </div>
              </li>
            );
          })}
        </ul>
      </>
    );
  };
  return (
    <Box
      icon={Mail}
      title="Booking messages"
      subtitle="Confirmation and cancellation messages for every booking, registration, experience booking and programme enrolment. Other notifications (waitlist offers, game updates, Circle activity) keep their built-in wording."
      flush
    >
      <Loaded state={state}>
        {(templates) => {
          const editing = templates.find((t) => t.key === open) ?? null;
          const meta = editing ? TEMPLATE_META[editing.key] : null;
          return (
            <>
              {group(templates, "new", "When a booking is made")}
              {group(templates, "cancel", "When a booking is cancelled")}
              <AdminModal
                open={!!editing}
                onClose={() => setOpen(null)}
                wide
                title={editing ? (meta ? `${meta.event === "new" ? "New booking" : "Cancellation"}: ${meta.who.toLowerCase()}, ${meta.channel.toLowerCase()}` : editing.key) : ""}
              >
                {editing && <TemplateEditor
                    key={editing.key}
                    t={editing}
                    onSaved={() => {
                      state.reload();
                      setOpen(null);
                    }}
                    onClose={() => setOpen(null)}
                  />}
              </AdminModal>
            </>
          );
        }}
      </Loaded>
    </Box>
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
        <DemandSignalsView title="Unmet demand, platform-wide" subtitle="Searches that returned nothing, across every partner. Useful for spotting a gap nobody lists yet." rows={rows.data} />
      )}
    </div>
  );
}

/** Insights (2026-10-16): Marketplace health and Demand on one page, as tabs.
 * `?tab=demand` (old links) opens the Demand tab. */
export function AdminInsightsPage({ initial, onOpenSettings }: { initial: "health" | "demand"; onOpenSettings: () => void }) {
  const [section, setSection] = useUrlParam<"health" | "demand">("section", initial);
  return (
    <div className="adm-stack">
      <IconTabs
        label="Insights sections"
        value={section}
        onChange={setSection}
        items={[
          { key: "health" as const, label: "Marketplace health", icon: Activity },
          { key: "demand" as const, label: "Unmet demand", icon: TrendingUp },
        ]}
      />
      {section === "demand" ? <AdminDemandPage /> : <AdminMarketplaceHealthPage onOpenSettings={onOpenSettings} />}
    </div>
  );
}

export function AdminMarketplaceHealthPage({ onOpenSettings }: { onOpenSettings: () => void }) {
  const data = useAdminData(fetchMarketplaceHealth);
  const referrals = useAdminData(() => fetchAdminReferrals().catch(() => []));
  const funnel = useAdminData(() => fetchAnalyticsFunnel().catch(() => []));
  return (
    <div className="adm-stack">
      <Loaded state={data}>{(d) => <MarketplaceHealthView data={d} referrals={referrals.data} funnel={funnel.data} />}</Loaded>
    </div>
  );
}
