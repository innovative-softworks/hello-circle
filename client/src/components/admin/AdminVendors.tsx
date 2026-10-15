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
} from "./adminUi";

// Vendors (admin redesign 2026-10-14): partner list + onboarding details.
// Decisions, role/tier save and the suspend confirmation are the same calls
// and rules as before; they now report success/failure.

const PLATFORM_ROLES = ["centre_manager", "facility_manager", "finance", "communications", "read_only_analyst"] as const;
const TYPE_LABEL = { community: "Community", sports: "Sports club" } as const;
const TIER_LABEL = { standard: "Standard", verified: "Verified", featured: "Featured" } as const;

// Record page (was a slide-in panel).
function VendorPanel({
  vendor,
  vendors,
  onClose,
  onChanged,
  onOpenListing,
}: {
  vendor: AdminVendor;
  vendors: AdminVendor[];
  onClose: () => void;
  onChanged: () => void;
  onOpenListing: (key: string) => void;
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
    ).then((ok) => ok && onChanged());

  return (
    <RecordView
      title={vendor.businessName || vendor.name}
      reference={
        <>
          Partner account · <span className="adm-mono">{vendor.id}</span>
        </>
      }
      backLabel="Vendors"
      onBack={onClose}
      statuses={
        <>
          <span className="adm-note">Account:</span> <StatusTag status={vendor.status} />
          {vendor.vendorType && <Badge tone="outline">{TYPE_LABEL[vendor.vendorType]}</Badge>}
        </>
      }
      actions={
        <>
          {vendor.status !== "suspended" && can("partners.suspend") && (
            <AdminButton variant="danger" onClick={() => setConfirmSuspend(true)} disabled={!!busy}>
              Suspend account
            </AdminButton>
          )}
          {vendor.status === "suspended" && can("partners.suspend") && (
            <AdminButton onClick={() => setConfirmReinstate(true)} disabled={!!busy}>
              Reinstate account
            </AdminButton>
          )}
          {vendor.status === "pending" && can("partners.approve") && (
            <AdminButton variant="primary" onClick={() => decide("approved", `${vendor.name} approved`)} disabled={!!busy}>
              {busy === "status:approved" ? "Approving…" : "Approve account"}
            </AdminButton>
          )}
        </>
      }
    >
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
        ]}
      />

      <SectionLabel>Documents</SectionLabel>
      <p className="adm-note">Partner signup doesn't collect documents — account approval is based on the onboarding details above.</p>

      <SectionLabel>Platform role &amp; provider tier</SectionLabel>
      {!vendor.invitedStaff && <p className="adm-note" style={{ marginBottom: 8 }}>Organisation owners always have full access; a role only restricts invited staff.</p>}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
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
        {can("partners.platform_role") && can("partners.tier") ? (
          <AdminButton onClick={saveRole} disabled={!roleDirty || !!busy}>
            {busy === "role" ? "Saving…" : "Save"}
          </AdminButton>
        ) : (
          <span className="adm-note">Only a super admin can change the platform role and provider tier.</span>
        )}
      </div>

      <SectionLabel>Organisation</SectionLabel>
      {orgs.data === null ? (
        <p className="adm-note">Loading…</p>
      ) : org ? (
        <p style={{ margin: 0, fontSize: 13.5 }}>
          {org.name} · {members} {members === 1 ? "member" : "members"}
        </p>
      ) : (
        <p className="adm-note">No organisation linked.</p>
      )}

      <SectionLabel>Listings{listings.data ? ` (${own.length})` : ""}</SectionLabel>
      {listings.error ? (
        <p className="adm-note">Couldn't load listings.</p>
      ) : listings.data === null ? (
        <p className="adm-note">Loading…</p>
      ) : own.length === 0 ? (
        <p className="adm-note">No listings yet.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, border: "1px solid var(--color-border)" }}>
          {own.map((l) => (
            <li key={rowKey(l)} style={{ borderBottom: "1px solid var(--color-border)" }}>
              <button
                type="button"
                className="adm-row-button"
                onClick={() => onOpenListing(rowKey(l))}
                style={{ width: "100%", display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 12px", alignItems: "center", fontSize: 13.5 }}
              >
                <span className="adm-cell-title">{l.item.name}</span>
                <StatusTag status={l.item.status} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <SectionLabel>Decisions</SectionLabel>
      <DecisionHistory objectType="vendor" objectId={vendor.id} currentNeedsReason={vendor.status === "suspended"} refreshKey={vendor.status} />

      <SectionLabel>Activity</SectionLabel>
      <ObjectActivity objectIds={[vendor.id]} note="Account status, platform-role and provider-tier changes are recorded." />

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
}: {
  openId?: string | null;
  onOpenHandled?: () => void;
  onOpenListing: (key: string) => void;
  onCountsChanged?: () => void;
}) {
  const state = useAdminData(fetchAdminVendors);
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
                            {Number(v.centreCount) + Number(v.clubCount)}
                          </td>
                          <td data-label="Signed up">{formatDate(v.createdAt)}</td>
                          <td>
                            <div className="adm-cell-actions">
                              <AdminButton size="sm" variant={v.status === "pending" ? "primary" : "secondary"} onClick={() => setOpenId(v.id)} aria-label={`${v.status === "pending" ? "Review" : "View"} ${v.name}`}>
                                {v.status === "pending" ? "Review" : "View"}
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
      <p className="adm-note">Listing counts cover community centres and sports clubs (the account summary the server returns); the account page lists experiences too.</p>
    </div>
  );
}
