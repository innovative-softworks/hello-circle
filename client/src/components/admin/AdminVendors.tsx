import { useEffect, useMemo, useState } from "react";
import { Store } from "lucide-react";
import { fetchAdminListings, fetchAdminOrganisations, fetchAdminVendors, setVendorPlatformRole, setVendorProviderTier, setVendorStatus, type AdminVendor } from "../../api";
import { PLATFORM_ROLE_LABELS } from "../../types";
import { ConfirmDialog } from "../ui";
import { ObjectActivity } from "./AdminAudit";
import { DecisionHistory, DecisionReasonFields, emptyReason, reasonComplete, toReasonInput, type ReasonDraft } from "./DecisionReason";
import { useAdminCan } from "./adminPermissions";
import { useToast } from "../Toast";
import { RecordState, RecordView } from "../workspace/RecordView";
import { useRecordParam, useUrlParam } from "../../useUrlTab";
import { flattenListings, rowKey } from "./AdminListings";
import type { AdminTab } from "./adminNav";
import {
  AdminButton,
  Badge,
  Box,
  EmptyMessage,
  Facts,
  Loaded,
  Pager,
  SearchField,
  SectionLabel,
  SelectField,
  StatusTag,
  Toolbar,
  ViewTabs,
  formatDate,
  matches,
  useAdminAction,
  useAdminData,
  usePaged,
  AdminModal,
} from "./adminUi";

// Vendors (admin redesign 2026-10-14): partner list + onboarding details.
// Decisions, role/tier save and the suspend confirmation are the same calls
// and rules as before; they now report success/failure.

const PLATFORM_ROLES = ["centre_manager", "facility_manager", "finance", "communications", "read_only_analyst"] as const;
const TYPE_LABEL = { community: "Community", sports: "Sports club" } as const;
const TIER_LABEL = { standard: "Standard", verified: "Verified", featured: "Featured" } as const;
const TYPE_NAMES = { centre: "Community centre", club: "Sports club", experience: "Experience" } as const;

// Record page (was a slide-in panel).
function VendorPanel({
  vendor,
  vendors,
  onClose,
  onChanged,
  onOpenListing,
  onNavigate,
}: {
  vendor: AdminVendor;
  vendors: AdminVendor[];
  onClose: () => void;
  onChanged: () => void;
  onOpenListing: (key: string) => void;
  onNavigate?: (tab: AdminTab, extra?: Record<string, string>) => void;
}) {
  const orgs = useAdminData(fetchAdminOrganisations);
  const listings = useAdminData(fetchAdminListings);
  const { run, busy } = useAdminAction();
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [confirmReinstate, setConfirmReinstate] = useState(false);
  const [reason, setReason] = useState<ReasonDraft>(emptyReason);
  const [reinstateNote, setReinstateNote] = useState<ReasonDraft>(emptyReason);
  const can = useAdminCan();
  const toast = useToast();
  const [role, setRole] = useState(vendor.platformRole ?? "none");
  const [editRole, setEditRole] = useState(false);
  const [tier, setTier] = useState(vendor.providerTier);
  useEffect(() => {
    setRole(vendor.platformRole ?? "none");
    setTier(vendor.providerTier);
  }, [vendor.id, vendor.platformRole, vendor.providerTier]);

  const org = (orgs.data ?? []).find((o) => o.id === vendor.orgId) ?? null;
  const members = vendor.orgId ? vendors.filter((v) => v.orgId === vendor.orgId).length : 0;
  const own = useMemo(() => (listings.data ? flattenListings(listings.data).filter((r) => r.item.vendorId === vendor.id) : []), [listings.data, vendor.id]);
  const roleDirty = role !== (vendor.platformRole ?? "none") || tier !== vendor.providerTier;

  const decide = (status: "approved" | "suspended", success: string) =>
    run(`status:${status}`, () => setVendorStatus(vendor.id, status), { success }).then((ok) => ok && onChanged());
  /** D-03 decisions with a reason — throw on failure so the dialog keeps the typed text. */
  const suspend = async () => {
    await setVendorStatus(vendor.id, "suspended", toReasonInput(reason));
    toast.success(`${vendor.name} suspended — they've been told why`);
    setConfirmSuspend(false);
    setReason(emptyReason());
    onChanged();
  };
  const reinstate = async () => {
    await setVendorStatus(vendor.id, "approved", toReasonInput(reinstateNote));
    toast.success(`${vendor.name} reinstated`);
    setConfirmReinstate(false);
    setReinstateNote(emptyReason());
    onChanged();
  };
  const saveRole = () =>
    run(
      "role",
      () => Promise.all([setVendorPlatformRole(vendor.id, role === "none" ? null : role), setVendorProviderTier(vendor.id, tier)]),
      { success: "Role and tier saved" }
    ).then((ok) => {
      if (ok) onChanged();
      return ok;
    });

  return (
    <RecordView
      title={vendor.businessName || vendor.name}
      reference={vendor.businessName ? `Partner account · ${vendor.name}` : "Partner account"}
      backLabel="Vendors"
      onBack={onClose}
      statuses={
        <>
          <span className="adm-note">Account:</span> <StatusTag status={vendor.status} label={vendor.status === "approved" ? "Approved" : undefined} />
          {vendor.vendorType && <Badge tone="outline">{TYPE_LABEL[vendor.vendorType]}</Badge>}
          <Badge tone="outline">{TIER_LABEL[vendor.providerTier]} tier</Badge>
        </>
      }
    >
      <div className="adm-review">
        <div className="adm-review-main">
          <SectionLabel>Onboarding details</SectionLabel>
          <Facts
            rows={[
              ["Contact", vendor.name],
              ["Email", vendor.email],
              ["Business", vendor.businessName || null],
              ["Type", vendor.vendorType ? TYPE_LABEL[vendor.vendorType] : null],
              ["Address", [vendor.address, vendor.county].filter(Boolean).join(", ") || null],
              ["Mobile", vendor.mobile || null],
              ["Landline", vendor.landline || null],
              ["About", vendor.description || null],
              ["Signed up", formatDate(vendor.createdAt, true)],
              ["Account kind", vendor.invitedStaff ? "Invited staff member" : "Organisation owner"],
              ["Reference", <span className="adm-mono">{vendor.id}</span>],
            ]}
          />
          <p className="adm-note" style={{ marginTop: 8 }}>Partner signup doesn't collect documents. Approval is based on these details and the listings below.</p>

          <SectionLabel>Listings{listings.data ? ` (${own.length})` : ""}</SectionLabel>
          {listings.error ? (
            <p className="adm-note">Couldn't load listings.</p>
          ) : listings.data === null ? (
            <p className="adm-note">Loading…</p>
          ) : own.length === 0 ? (
            <p className="adm-note">No listings yet.</p>
          ) : (
            <ul className="adm-ov-list adm-box" style={{ padding: 0 }}>
              {own.map((l) => (
                <li key={rowKey(l)} className="adm-ov-row adm-ov-row--3">
                  <div className="adm-ov-main">
                    <div className="adm-ov-title">{l.item.name}</div>
                    <div className="adm-ov-detail">{[TYPE_NAMES[l.type], l.item.area, l.item.county].filter(Boolean).join(" · ")}</div>
                  </div>
                  <StatusTag status={l.item.status} />
                  <AdminButton size="sm" onClick={() => onOpenListing(rowKey(l))} aria-label={`Open ${l.item.name}`}>
                    Open
                  </AdminButton>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="adm-review-side" aria-label="Account actions and settings">
          <section className="adm-review-card">
            <h2 className="adm-review-h">Account</h2>
            <p className="adm-note" style={{ margin: "0 0 12px" }}>
              {vendor.status === "pending"
                ? "Waiting for approval. Their listings can't go live until the account is approved."
                : vendor.status === "suspended"
                  ? "Suspended: they can't sign in and their own listings refuse new bookings."
                  : "Approved: they can sign in and publish listings after review."}
            </p>
            <div className="adm-review-actions">
              {vendor.status === "pending" && can("partners.approve") && (
                <AdminButton variant="primary" onClick={() => decide("approved", `${vendor.name} approved`)} disabled={!!busy}>
                  {busy === "status:approved" ? "Approving…" : "Approve account"}
                </AdminButton>
              )}
              {vendor.status === "suspended" && can("partners.suspend") && (
                <AdminButton onClick={() => setConfirmReinstate(true)} disabled={!!busy}>
                  Reinstate account
                </AdminButton>
              )}
              {vendor.status !== "suspended" && can("partners.suspend") && (
                <AdminButton variant="danger" onClick={() => setConfirmSuspend(true)} disabled={!!busy}>
                  Suspend account…
                </AdminButton>
              )}
            </div>
          </section>

          <section className="adm-review-card">
            <h2 className="adm-review-h">Role &amp; tier</h2>
            <Facts
              rows={[
                ["Platform role", vendor.platformRole ? PLATFORM_ROLE_LABELS[vendor.platformRole as keyof typeof PLATFORM_ROLE_LABELS] ?? vendor.platformRole : "No role"],
                ["Provider tier", TIER_LABEL[vendor.providerTier]],
              ]}
            />
            {!vendor.invitedStaff && <p className="adm-note" style={{ margin: "8px 0 10px" }}>Organisation owners always have full access; a role only restricts invited staff.</p>}
            {can("partners.platform_role") && can("partners.tier") ? (
              <AdminButton size="sm" onClick={() => setEditRole(true)}>
                Change role or tier
              </AdminButton>
            ) : (
              <span className="adm-note">Only a super admin can change these.</span>
            )}
            <AdminModal
              open={editRole}
              onClose={() => {
                setEditRole(false);
                setRole(vendor.platformRole ?? "none");
                setTier(vendor.providerTier);
              }}
              dirty={roleDirty}
              title="Change role and tier"
              subtitle={vendor.businessName || vendor.name}
              footer={
                <>
                  <AdminButton variant="quiet" onClick={() => setEditRole(false)}>
                    Cancel
                  </AdminButton>
                  <AdminButton variant="primary" onClick={() => saveRole().then((ok) => ok && setEditRole(false))} disabled={!roleDirty || !!busy}>
                    {busy === "role" ? "Saving…" : "Save"}
                  </AdminButton>
                </>
              }
            >
              <div style={{ display: "grid", gap: 14 }}>
                <div className="adm-field">
                  <label htmlFor="adm-v-role">Platform role</label>
                  <select id="adm-v-role" className="adm-select" value={role} onChange={(e) => setRole(e.target.value)}>
                    <option value="none">No role</option>
                    {PLATFORM_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {PLATFORM_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="adm-field">
                  <label htmlFor="adm-v-tier">Provider tier</label>
                  <select id="adm-v-tier" className="adm-select" value={tier} onChange={(e) => setTier(e.target.value as AdminVendor["providerTier"])}>
                    {Object.entries(TIER_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                {!vendor.invitedStaff && <p className="adm-note" style={{ margin: 0 }}>This is the organisation owner, so the role has no effect on their access.</p>}
              </div>
            </AdminModal>
          </section>

          <section className="adm-review-card">
            <h2 className="adm-review-h">Organisation</h2>
            {orgs.data === null ? (
              <p className="adm-note" style={{ margin: 0 }}>Loading…</p>
            ) : org ? (
              <>
                <div className="adm-cell-title">{org.name}</div>
                <div className="adm-cell-sub" style={{ marginBottom: 10 }}>
                  {members} {members === 1 ? "member" : "members"}
                </div>
                {onNavigate && (
                  <AdminButton size="sm" onClick={() => onNavigate("organisations", { record: `org:${org.id}` })}>
                    Open organisation
                  </AdminButton>
                )}
              </>
            ) : (
              <p className="adm-note" style={{ margin: 0 }}>No organisation linked.</p>
            )}
          </section>

          {onNavigate && can("support.search") && (
            <section className="adm-review-card">
              <h2 className="adm-review-h">Support</h2>
              <p className="adm-note" style={{ margin: "0 0 10px" }}>Orders and accounts for {vendor.email}.</p>
              <AdminButton size="sm" onClick={() => onNavigate("support", { q: vendor.email, record: `person:${vendor.email}` })}>
                Open in Support
              </AdminButton>
            </section>
          )}
        </aside>

        <div className="adm-review-history">
          <SectionLabel>Decisions</SectionLabel>
          <DecisionHistory objectType="vendor" objectId={vendor.id} currentNeedsReason={vendor.status === "suspended"} refreshKey={vendor.status} />
          <SectionLabel>Activity</SectionLabel>
          <ObjectActivity objectIds={[vendor.id]} note="Account status, platform-role and provider-tier changes are recorded." />
        </div>
      </div>

      <ConfirmDialog
        open={confirmSuspend}
        title={`Suspend ${vendor.name}?`}
        message="They can't sign in, and their open sessions lose workspace access until reinstated. New bookings are refused for the listings this person created, but those listings still show in search and on their pages. Listings created by other members of their organisation stay bookable, and existing bookings aren't changed. They're emailed the reason category and your explanation, and see it if they try to sign in. The internal note isn't sent. Reversible any time. This suspends only this person's account — to suspend the whole organisation and all its listings, open it under Organisations."
        confirmLabel="Suspend account"
        confirmDisabled={!reasonComplete(reason)}
        onConfirm={suspend}
        onCancel={() => setConfirmSuspend(false)}
      >
        <DecisionReasonFields kind="suspension" audience="partner" value={reason} onChange={setReason} />
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmReinstate}
        title={`Reinstate ${vendor.name}?`}
        message="They can sign in to the Partner workspace again, and new bookings for their listings are accepted again. They're emailed that the account is reinstated, with your message if you add one."
        confirmLabel="Reinstate account"
        tone="neutral"
        onConfirm={reinstate}
        onCancel={() => setConfirmReinstate(false)}
      >
        <DecisionReasonFields kind="suspension" audience="partner" value={reinstateNote} onChange={setReinstateNote} explanationOptional categoryless />
      </ConfirmDialog>
    </RecordView>
  );
}

const VIEWS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "suspended", label: "Suspended" },
] as const;

export function AdminVendorsPage({
  openId: openRequest,
  onOpenHandled,
  onOpenListing,
  onCountsChanged,
  onNavigate,
}: {
  openId?: string | null;
  onOpenHandled?: () => void;
  onOpenListing: (key: string) => void;
  onCountsChanged?: () => void;
  onNavigate?: (tab: AdminTab, extra?: Record<string, string>) => void;
}) {
  const state = useAdminData(fetchAdminVendors);
  // Listing counts across all three types (the vendor summary only counts centres and clubs).
  const allListings = useAdminData(fetchAdminListings);
  const listingCount = useMemo(() => {
    const m = new Map<string, number>();
    if (allListings.data) for (const r of flattenListings(allListings.data)) if (r.item.vendorId && r.item.status !== "deleted") m.set(r.item.vendorId, (m.get(r.item.vendorId) ?? 0) + 1);
    return m;
  }, [allListings.data]);
  // Filters, page and the open record live in the URL (shareable, Back-safe).
  const [q, setQ] = useUrlParam<string>("q", "");
  const [view, setView] = useUrlParam<(typeof VIEWS)[number]["key"]>("view", "all");
  const [type, setType] = useUrlParam<"all" | "community" | "sports">("type", "all");
  const [openId, openRecord, closeRecord] = useRecordParam();
  const setOpenId = (k: string | null) => (k ? openRecord(k) : closeRecord());
  useEffect(() => {
    if (openRequest) {
      openRecord(openRequest);
      onOpenHandled?.();
    }
  }, [openRequest, onOpenHandled, openRecord]);

  const vendors = state.data ?? [];
  const base = vendors.filter((v) => (type === "all" || v.vendorType === type) && matches(q, v.name, v.email, v.businessName, v.county));
  const filtered = base.filter((v) => view === "all" || v.status === view).sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || b.createdAt.localeCompare(a.createdAt));
  const paged = usePaged(filtered, 20, `${q}|${view}|${type}`, "page");
  const open = vendors.find((v) => v.id === openId) ?? null;

  if (openId) {
    if (state.error && !state.data) return <RecordState state="error" backLabel="Vendors" onBack={closeRecord} onRetry={state.reload} />;
    if (!state.data) return <RecordState state="loading" backLabel="Vendors" onBack={closeRecord} />;
    if (!open) return <RecordState state="missing" backLabel="Vendors" onBack={closeRecord} />;
    return (
      <VendorPanel
        vendor={open}
        vendors={vendors}
        onClose={closeRecord}
        onChanged={() => {
          state.reload();
          onCountsChanged?.();
        }}
        onOpenListing={onOpenListing}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <div className="adm-stack">
      <Box flush>
        <ViewTabs label="Account status" value={view} onChange={setView} views={VIEWS.map((v) => ({ key: v.key, label: v.label, count: state.data ? base.filter((x) => v.key === "all" || x.status === v.key).length : undefined }))} />
        <Toolbar label="Filter vendors">
          <SearchField label="Search partners" value={q} onChange={setQ} placeholder="Name, business, email or county" />
          <SelectField
            label="Type"
            value={type}
            onChange={setType}
            options={[
              { value: "all", label: "All types" },
              { value: "community", label: "Community" },
              { value: "sports", label: "Sports club" },
            ]}
          />
        </Toolbar>
        <Loaded state={state}>
          {() =>
            filtered.length === 0 ? (
              <EmptyMessage icon={<Store size={22} strokeWidth={1.9} aria-hidden="true" />} title={vendors.length ? "No partners match" : "No partners yet"} detail={vendors.length ? "Try a different search or status." : undefined} />
            ) : (
              <>
                <div className="adm-table-wrap">
                  <table className="adm-table adm-table--stack">
                    <caption className="adm-visually-hidden">Partner accounts</caption>
                    <thead>
                      <tr>
                        <th scope="col">Partner</th>
                        <th scope="col">Type</th>
                        <th scope="col">Status</th>
                        <th scope="col">Tier</th>
                        <th scope="col" className="adm-num">Listings</th>
                        <th scope="col">Signed up</th>
                        <th scope="col">
                          <span className="adm-visually-hidden">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {paged.slice.map((v) => (
                        <tr key={v.id}>
                          <td data-label="Partner">
                            <button type="button" className="adm-row-button" onClick={() => setOpenId(v.id)}>
                              <span className="adm-cell-title" style={{ display: "block" }}>{v.businessName || v.name}</span>
                              <span className="adm-cell-sub" style={{ display: "block" }}>
                                {v.businessName ? `${v.name} · ` : ""}
                                {v.email}
                              </span>
                            </button>
                          </td>
                          <td data-label="Type">{v.vendorType ? TYPE_LABEL[v.vendorType] : "—"}</td>
                          <td data-label="Status">
                            <StatusTag status={v.status} label={v.status === "approved" ? "Approved" : undefined} />
                          </td>
                          <td data-label="Tier">{TIER_LABEL[v.providerTier]}</td>
                          <td data-label="Listings" className="adm-num">
                            {allListings.data ? listingCount.get(v.id) ?? 0 : Number(v.centreCount) + Number(v.clubCount)}
                          </td>
                          <td data-label="Signed up">{formatDate(v.createdAt)}</td>
                          <td>
                            <div className="adm-cell-actions">
                              <AdminButton size="sm" variant={v.status === "pending" ? "primary" : "secondary"} onClick={() => setOpenId(v.id)} aria-label={`${v.status === "pending" ? "Review" : "Open"} ${v.name}`}>
                                {v.status === "pending" ? "Review" : "Open"}
                              </AdminButton>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager {...paged} noun="partners" />
              </>
            )
          }
        </Loaded>
      </Box>
    </div>
  );
}
