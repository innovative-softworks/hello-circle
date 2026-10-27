import { useEffect, useState } from "react";
import { Building2, ShieldCheck, Store } from "lucide-react";
import { fetchAdminOrganisations, fetchAdminVendor, fetchAdminVendorListings, fetchAdminVendorPage, setVendorPlatformRole, setVendorProviderTier, setVendorStatus, type AdminVendor } from "../../api";
import { PLATFORM_ROLE_LABELS } from "../../types";
import { ConfirmDialog } from "../ui";
import { ObjectActivity } from "./AdminAudit";
import { DecisionHistory, DecisionReasonFields, emptyReason, reasonComplete, toReasonInput, type ReasonDraft } from "./DecisionReason";
import { useAdminCan } from "./adminPermissions";
import { useToast } from "../Toast";
import { RecordState, RecordView } from "../workspace/RecordView";
import { ContextSection, CopyValue, DetailFacts, DetailSection, DetailStats } from "../workspace/DetailParts";
import { useRecordParam, useUrlParam } from "../../useUrlTab";
import { rowKey } from "./AdminListings";
import type { AdminTab } from "./adminNav";
import {
  AdminButton,
  Badge,
  Box,
  EmptyMessage,
  ErrorMessage,
  Loaded,
  LoadingRows,
  OverflowMenu,
  Pager,
  SearchField,
  SectionLabel,
  SelectField,
  StatusTag,
  Toolbar,
  ViewTabs,
  formatDate,
  useAdminAction,
  useAdminData,
  useDebounced,
  useUrlPage,
  AdminModal,
  BulkBar,
  RowMenu,
  SelectAllHeader,
  SelectCell,
  useRowSelection,
} from "./adminUi";

// Vendors (admin redesign 2026-10-14): partner list + onboarding details.
// Decisions, role/tier save and the suspend confirmation are the same calls
// and rules as before; they now report success/failure.

const PLATFORM_ROLES = ["centre_manager", "facility_manager", "finance", "communications", "read_only_analyst"] as const;
const TYPE_LABEL = { community: "Community", sports: "Sports club" } as const;
const PAGE_SIZE = 20;
const TIER_LABEL = { standard: "Standard", verified: "Verified", featured: "Featured" } as const;
const TYPE_NAMES = { centre: "Community centre", club: "Sports club", experience: "Experience" } as const;

// Record page (was a slide-in panel).
function VendorPanel({
  vendor,
  memberCount,
  onClose,
  onChanged,
  onOpenListing,
  onNavigate,
}: {
  vendor: AdminVendor;
  /** People in this partner's organisation (OG-24: counted on the server). */
  memberCount: number;
  onClose: () => void;
  onChanged: () => void;
  onOpenListing: (key: string) => void;
  onNavigate?: (tab: AdminTab, extra?: Record<string, string>) => void;
}) {
  const orgs = useAdminData(fetchAdminOrganisations);
  const listings = useAdminData(() => fetchAdminVendorListings(vendor.id), [vendor.id]);
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
  const members = vendor.orgId ? memberCount : 0;
  const own = listings.data ?? [];
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

  const menu = [
    ...(onNavigate && can("support.search") ? [{ label: "Open in Support", onSelect: () => onNavigate("support", { q: vendor.email, record: `person:${vendor.email}` }) }] : []),
    ...(vendor.status !== "suspended" && can("partners.suspend") ? [{ label: "Suspend account…", danger: true, onSelect: () => setConfirmSuspend(true), disabled: !!busy }] : []),
  ];

  return (
    <RecordView
      title={vendor.businessName || vendor.name}
      reference={[vendor.vendorType ? TYPE_LABEL[vendor.vendorType] : "Partner account", vendor.county].filter(Boolean).join(" · ")}
      backLabel="Vendors"
      onBack={onClose}
      statuses={
        <>
          <span className="adm-note">Account:</span> <StatusTag status={vendor.status} label={vendor.status === "approved" ? "Approved" : undefined} />
          <Badge tone="outline">{TIER_LABEL[vendor.providerTier]} tier</Badge>
          {!!vendor.invitedStaff && <Badge tone="outline">Invited staff member</Badge>}
        </>
      }
      actions={
        <>
          {vendor.status === "pending" && can("partners.approve") && (
            <AdminButton variant="primary" onClick={() => decide("approved", `${vendor.name} approved`)} disabled={!!busy}>
              {busy === "status:approved" ? "Approving…" : "Approve account"}
            </AdminButton>
          )}
          {vendor.status === "suspended" && can("partners.suspend") && (
            <AdminButton variant="primary" onClick={() => setConfirmReinstate(true)} disabled={!!busy}>
              Reinstate account
            </AdminButton>
          )}
          {onNavigate && org && <AdminButton onClick={() => onNavigate("organisations", { record: `org:${org.id}` })}><Building2 size={15} strokeWidth={2} aria-hidden="true" /> Open organisation</AdminButton>}
          {can("partners.platform_role") && can("partners.tier") && <AdminButton onClick={() => setEditRole(true)}><ShieldCheck size={15} strokeWidth={2} aria-hidden="true" /> Change role or tier…</AdminButton>}
          {menu.length > 0 && <OverflowMenu label={`More actions for ${vendor.businessName || vendor.name}`} actions={menu} />}
        </>
      }
      stats={
        <DetailStats
          items={[
            { label: "Listings", value: listings.data ? String(own.length) : "…", sub: listings.data ? `${own.filter((l) => l.item.status === "approved").length} live` : undefined },
            { label: "Pending review", value: listings.data ? String(own.filter((l) => l.item.status === "pending").length) : "…", sub: "Listings waiting" },
            { label: "Team", value: String(Math.max(members, 1)), sub: vendor.orgId ? "In the organisation" : "No organisation" },
            { label: "Partner since", value: formatDate(vendor.createdAt), sub: `${TIER_LABEL[vendor.providerTier]} tier` },
          ]}
        />
      }
      asideLabel="Account, contact and organisation"
      aside={
        <>
          <ContextSection title="Account">
            <p>
              {vendor.status === "pending"
                ? "Waiting for approval. Their listings can't go live until the account is approved."
                : vendor.status === "suspended"
                  ? "Suspended: they can't sign in and their own listings refuse new bookings."
                  : "Approved: they can sign in and publish listings after review."}
            </p>
          </ContextSection>
          <ContextSection title="Contact">
            <div className="wd-ctx-name">{vendor.name}</div>
            <a className="wd-ctx-sub" href={`mailto:${vendor.email}`}>
              {vendor.email}
            </a>
            {vendor.mobile && <div className="wd-ctx-sub">Mobile {vendor.mobile}</div>}
            {vendor.landline && <div className="wd-ctx-sub">Landline {vendor.landline}</div>}
          </ContextSection>
          <ContextSection title="Organisation">
            {orgs.data === null ? (
              <p className="adm-note">Loading…</p>
            ) : org ? (
              <>
                <div className="wd-ctx-name">{org.name}</div>
                <div className="wd-ctx-sub">
                  {members} {members === 1 ? "member" : "members"}
                </div>
              </>
            ) : (
              <p className="adm-note">No organisation linked.</p>
            )}
          </ContextSection>
          <ContextSection title="Role & tier">
            <DetailFacts
              columns={1}
              rows={[
                ["Platform role", vendor.platformRole ? PLATFORM_ROLE_LABELS[vendor.platformRole as keyof typeof PLATFORM_ROLE_LABELS] ?? vendor.platformRole : "No role"],
                ["Provider tier", TIER_LABEL[vendor.providerTier]],
              ]}
            />
            {!vendor.invitedStaff && <p className="adm-note" style={{ margin: "8px 0 0" }}>Organisation owners always have full access; a role only restricts invited staff.</p>}
            {!(can("partners.platform_role") && can("partners.tier")) && <p className="adm-note" style={{ margin: "8px 0 0" }}>Only a super admin can change these.</p>}
          </ContextSection>
          <ContextSection title="Account details">
            <DetailFacts
              columns={1}
              rows={[
                ["Account ID", <CopyValue value={vendor.id} label="account ID" />],
                ["Account kind", vendor.invitedStaff ? "Invited staff member" : "Organisation owner"],
                ["Signed up", formatDate(vendor.createdAt, true)],
              ]}
            />
          </ContextSection>
        </>
      }
    >
      <DetailSection title="Business details" note="Partner signup doesn't collect documents. Approval is based on these details and the listings below.">
        <DetailFacts
          rows={[
            ["Business", vendor.businessName || null],
            ["Type", vendor.vendorType ? TYPE_LABEL[vendor.vendorType] : null],
            ["Address", [vendor.address, vendor.county].filter(Boolean).join(", ") || null],
            ["Contact person", vendor.name],
          ]}
        />
        {vendor.description && (
          <p className="adm-review-text" style={{ marginTop: 16 }}>
            {vendor.description}
          </p>
        )}
      </DetailSection>

      <DetailSection title={`Listings${listings.data ? ` (${own.length})` : ""}`}>
        {listings.error ? (
          <ErrorMessage error={listings.error} onRetry={listings.reload} title="Couldn't load listings" />
        ) : listings.data === null ? (
          <LoadingRows rows={2} label="Loading listings" />
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
      </DetailSection>

      <DetailSection title="Decisions">
        <DecisionHistory objectType="vendor" objectId={vendor.id} currentNeedsReason={vendor.status === "suspended"} refreshKey={vendor.status} />
      </DetailSection>
      <DetailSection title="Activity">
        <ObjectActivity objectIds={[vendor.id]} note="Account status, platform-role and provider-tier changes are recorded." />
      </DetailSection>

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

  // OG-24 — searched, counted, sorted (pending first, then newest) and paged on the server.
  const query = useDebounced(q.trim());
  const [page, setPage] = useUrlPage(`${query}|${view}|${type}`);
  const state = useAdminData(() => fetchAdminVendorPage({ q: query || undefined, view, type, page, pageSize: PAGE_SIZE }), [query, view, type, page]);
  // The record page loads just this partner.
  const record = useAdminData(() => (openId ? fetchAdminVendor(openId) : Promise.resolve(null)), [openId]);
  const vendors = state.data?.items ?? [];
  const filtering = !!query || type !== "all";
  const can = useAdminCan();
  const toast = useToast();
  // Bulk: only pending accounts can be selected, to approve them (the same call as the record page).
  const canApprove = can("partners.approve");
  const sel = useRowSelection(canApprove ? vendors.filter((v) => v.status === "pending").map((v) => v.id) : []);
  const [bulkOpen, setBulkOpen] = useState(false);
  const approveSelected = async () => {
    const ids = [...sel.selected];
    let done = 0;
    for (const id of ids) {
      try {
        await setVendorStatus(id, "approved");
        done++;
      } catch {
        // counted below; the rest still go ahead
      }
    }
    setBulkOpen(false);
    sel.clear();
    state.reload();
    onCountsChanged?.();
    if (done === ids.length) toast.success(`${done} partner account${done === 1 ? "" : "s"} approved`);
    else toast.error(`${done} of ${ids.length} approved; the others couldn't be approved. Try them from their pages.`);
  };

  if (openId) {
    const open = record.data && record.data.id === openId ? record.data : null;
    if (record.error && !open) return <RecordState state={(record.error as { status?: number }).status === 404 ? "missing" : "error"} backLabel="Vendors" onBack={closeRecord} onRetry={record.reload} />;
    if (!open) return <RecordState state="loading" backLabel="Vendors" onBack={closeRecord} />;
    return (
      <VendorPanel
        vendor={open}
        memberCount={open.orgMemberCount}
        onClose={closeRecord}
        onChanged={() => {
          record.reload();
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
        <ViewTabs label="Account status" value={view} onChange={setView} views={VIEWS.map((v) => ({ key: v.key, label: v.label, count: state.data ? state.data.counts[v.key] : undefined }))} />
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
          {(page) =>
            page.items.length === 0 ? (
              <EmptyMessage icon={<Store size={22} strokeWidth={1.9} aria-hidden="true" />} title={filtering || page.counts.all ? "No partners match" : "No partners yet"} detail={filtering || page.counts.all ? "Try a different search or status." : undefined} />
            ) : (
              <>
                <BulkBar sel={sel} noun="account">
                  <AdminButton variant="primary" size="sm" onClick={() => setBulkOpen(true)}>
                    Approve {sel.count}
                  </AdminButton>
                </BulkBar>
                <div className="adm-table-wrap">
                  <table className="adm-table adm-table--stack">
                    <caption className="adm-visually-hidden">Partner accounts</caption>
                    <thead>
                      <tr>
                        {canApprove && <SelectAllHeader sel={sel} label="Select all pending accounts on this page" />}
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
                      {vendors.map((v) => (
                        <tr key={v.id}>
                          {canApprove && <SelectCell sel={sel} rowKey={v.id} label={`Select ${v.businessName || v.name}`} disabled={v.status !== "pending"} />}
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
                            {Number(v.listingCount)}
                          </td>
                          <td data-label="Signed up">{formatDate(v.createdAt)}</td>
                          <td>
                            <div className="adm-cell-actions">
                              <AdminButton size="sm" variant={v.status === "pending" ? "primary" : "secondary"} onClick={() => setOpenId(v.id)} aria-label={`${v.status === "pending" ? "Review" : "Open"} ${v.name}`}>
                                {v.status === "pending" ? "Review" : "Open"}
                              </AdminButton>
                              <RowMenu
                                name={v.businessName || v.name}
                                items={[
                                  { label: "Open", onSelect: () => setOpenId(v.id) },
                                  ...(v.status === "pending" && canApprove ? [{ label: "Approve account", onSelect: () => { sel.clear(); sel.toggle(v.id); setBulkOpen(true); } }] : []),
                                  ...(onNavigate && can("support.search") ? [{ label: "Open in Support", onSelect: () => onNavigate("support", { q: v.email, record: `person:${v.email}` }) }] : []),
                                ]}
                                copy={{ label: "Copy email", value: v.email }}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager page={page.page} pageCount={page.pageCount} total={page.total} pageSize={page.pageSize} setPage={setPage} noun="partners" />
                <ConfirmDialog
                  open={bulkOpen}
                  title={`Approve ${sel.count} partner account${sel.count === 1 ? "" : "s"}?`}
                  message="Each partner can sign in and their listings can be published after review. They're told by email, the same as approving one account from its page."
                  confirmLabel={`Approve ${sel.count}`}
                  tone="neutral"
                  onConfirm={approveSelected}
                  onCancel={() => setBulkOpen(false)}
                />
              </>
            )
          }
        </Loaded>
      </Box>
    </div>
  );
}
