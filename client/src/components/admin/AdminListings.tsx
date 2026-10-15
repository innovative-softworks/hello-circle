import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Star } from "lucide-react";
import {
  adminDeleteCentre,
  adminDeleteClub,
  fetchAdminListings,
  fetchAdminOrganisations,
  setCentreOrganisation,
  setCentreStatus,
  setClubOrganisation,
  setClubStatus,
  setExperienceStatus,
  setListingFeatured,
  type AdminListingSummary,
} from "../../api";
import { getMediaUrl } from "../../media";
import type { AdminOrganisation } from "../../types";
import { useToast } from "../Toast";
import { ConfirmDialog } from "../ui";
import {
  AdminButton,
  Badge,
  Box,
  EmptyMessage,
  Facts,
  Loaded,
  OverflowMenu,
  Pager,
  SearchField,
  SectionLabel,
  SelectField,
  StatusTag,
  Toolbar,
  ViewTabs,
  errorMessage,
  matches,
  useAdminAction,
  useAdminData,
  usePaged,
} from "./adminUi";
import { ObjectActivity } from "./AdminAudit";
import { DecisionHistory, DecisionReasonFields, emptyReason, reasonComplete, toReasonInput, type ReasonDraft } from "./DecisionReason";
import { useAdminCan } from "./adminPermissions";
import { RecordState, RecordView } from "../workspace/RecordView";
import { useRecordParam, useUrlParam } from "../../useUrlTab";

// All listings + Pending approvals (admin redesign 2026-10-14). One module
// because both work on the same GET /admin/listings payload and the same
// decision rules. Experiences are included — the API always returned them
// but the old dashboard never rendered them (audit finding 1).

export type ListingType = "centre" | "club" | "experience";
export interface ListingRow {
  type: ListingType;
  item: AdminListingSummary;
}

const TYPE_LABEL: Record<ListingType, string> = { centre: "Community centre", club: "Sports club", experience: "Experience" };
const TABLE: Record<ListingType, "centres" | "clubs" | "experiences"> = { centre: "centres", club: "clubs", experience: "experiences" };

export function rowKey(r: { type: ListingType; item: { id: string } }) {
  return `${r.type}:${r.item.id}`;
}

export function flattenListings(data: { centres: AdminListingSummary[]; clubs: AdminListingSummary[]; experiences?: AdminListingSummary[] }): ListingRow[] {
  return [
    ...data.centres.map((item) => ({ type: "centre" as const, item })),
    ...data.clubs.map((item) => ({ type: "club" as const, item })),
    ...(data.experiences ?? []).map((item) => ({ type: "experience" as const, item })),
  ];
}

export function vendorBlocksApproval(item: AdminListingSummary) {
  // Grandfathered listings with no vendor (vendorStatus null) are exempt —
  // same rule the server enforces with a 409.
  return !!item.vendorStatus && item.vendorStatus !== "approved";
}

function location(item: AdminListingSummary) {
  // Seeded areas already include the county ("Cabra, Dublin").
  if (item.county && !(item.area ?? "").toLowerCase().includes(item.county.toLowerCase())) return [item.area, item.county].filter(Boolean).join(", ");
  return item.area || item.county || "";
}

function priceFacts(r: ListingRow): string {
  const { item } = r;
  if (r.type === "centre") return [item.capacity ? `Capacity ${item.capacity}` : null, item.from ? `From €${item.from}/hr` : null].filter(Boolean).join(" · ");
  if (r.type === "club") return [item.sport, item.ages, item.price ? `€${item.price}/${item.unit}` : null].filter(Boolean).join(" · ");
  return [item.kind ? item.kind.charAt(0).toUpperCase() + item.kind.slice(1) : null, item.from ? `From €${(item.from / 100).toFixed(2)}` : null].filter(Boolean).join(" · ");
}

const STATUS_VIEWS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Live" },
  { key: "rejected", label: "Rejected" },
  { key: "other", label: "Other" },
] as const;
type StatusView = (typeof STATUS_VIEWS)[number]["key"];

function inView(status: string, view: StatusView) {
  if (view === "all") return true;
  if (view === "other") return !["pending", "approved", "rejected"].includes(status);
  return status === view;
}

type SortKey = "triage" | "name" | "nameDesc" | "partner";

// --- decision hook shared by rows and the panel ---------------------------

function useListingDecisions(reload: () => void) {
  const { run, busy } = useAdminAction();
  const toast = useToast();
  /** D-03 rejection with a reason. Throws on failure so the dialog stays open
   * with the typed reason and shows the error. */
  const reject = async (r: ListingRow, reason: ReasonDraft) => {
    const fn = r.type === "centre" ? setCentreStatus : r.type === "club" ? setClubStatus : setExperienceStatus;
    await fn(r.item.id, "rejected", toReasonInput(reason));
    toast.success(`${r.item.name} was rejected — the partner has been told why`);
    reload();
  };
  const setStatus = (r: ListingRow, status: "approved" | "rejected") => {
    const fn = r.type === "centre" ? setCentreStatus : r.type === "club" ? setClubStatus : setExperienceStatus;
    return run(`${rowKey(r)}:${status}`, () => fn(r.item.id, status), {
      success: status === "approved" ? `${r.item.name} is now live` : `${r.item.name} was rejected`,
    }).then((ok) => {
      if (ok) reload();
      return ok;
    });
  };
  const toggleFeatured = (r: ListingRow) =>
    run(`${rowKey(r)}:featured`, () => setListingFeatured(TABLE[r.type], r.item.id, !r.item.featured), {
      success: r.item.featured ? `${r.item.name} removed from featured` : `${r.item.name} is now featured`,
    }).then((ok) => ok && reload());
  const remove = (r: ListingRow) =>
    run(`${rowKey(r)}:delete`, () => (r.type === "centre" ? adminDeleteCentre(r.item.id) : adminDeleteClub(r.item.id)), { success: `${r.item.name} was deleted` }).then((ok) => ok && reload());
  return { setStatus, reject, toggleFeatured, remove, run, busy };
}

// --- record page (was a slide-in panel) ----------------------------------

function ListingRecord({
  row,
  organisations,
  onClose,
  onChanged,
  onOpenVendor,
  decisions,
  backLabel,
}: {
  row: ListingRow;
  backLabel: string;
  organisations: AdminOrganisation[];
  onClose: () => void;
  onChanged: () => void;
  onOpenVendor: (vendorId: string) => void;
  decisions: ReturnType<typeof useListingDecisions>;
}) {
  const [confirm, setConfirm] = useState<"reject" | "delete" | null>(null);
  const [reason, setReason] = useState<ReasonDraft>(emptyReason);
  const can = useAdminCan();
  const [orgId, setOrgId] = useState("");
  useEffect(() => setOrgId(""), [row.item.id]);
  const { item, type } = row;
  const blocked = vendorBlocksApproval(item);
  const key = rowKey(row);
  const { busy, run } = decisions;

  const del = () =>
    run(`${key}:delete`, () => (type === "centre" ? adminDeleteCentre(item.id) : adminDeleteClub(item.id)), { success: `${item.name} was deleted` }).then((ok) => {
      if (ok) {
        onChanged();
        onClose();
      }
    });
  const assignOrg = () =>
    run(`${key}:org`, () => (type === "centre" ? setCentreOrganisation(item.id, orgId === "none" ? null : orgId) : setClubOrganisation(item.id, orgId === "none" ? null : orgId)), {
      success: orgId === "none" ? "Organisation removed" : "Organisation assigned",
    }).then((ok) => ok && onChanged());

  return (
    <RecordView
      title={item.name}
      reference={
        <>
          {TYPE_LABEL[type]} · <span className="adm-mono">{item.id}</span>
        </>
      }
      backLabel={backLabel}
      onBack={onClose}
      statuses={
        <>
          <span className="adm-note">Listing review:</span> <StatusTag status={item.status} />
          {item.vendorId && (
            <>
              <span className="adm-note">Partner account:</span> <StatusTag status={item.vendorStatus ?? "unknown"} />
            </>
          )}
          {!!item.featured && <Badge tone="outline">Featured</Badge>}
        </>
      }
      actions={
        <>
          {type !== "experience" && can("listings.delete") && (
            <AdminButton variant="danger" onClick={() => setConfirm("delete")} disabled={!!busy}>
              Delete listing
            </AdminButton>
          )}
          {item.status !== "rejected" && can("listings.moderate") && (
            <AdminButton onClick={() => setConfirm("reject")} disabled={!!busy}>
              Reject listing
            </AdminButton>
          )}
          {item.status !== "approved" && can("listings.moderate") && (
            <AdminButton variant="primary" disabled={blocked || !!busy} onClick={() => decisions.setStatus(row, "approved")} aria-describedby={blocked ? "adm-blocked-note" : undefined}>
              {busy === `${key}:approved` ? "Approving…" : "Approve & publish"}
            </AdminButton>
          )}
        </>
      }
    >
      {blocked && item.status !== "approved" && (
        <div className="adm-callout" id="adm-blocked-note" style={{ marginBottom: 16 }}>
          The partner account behind this listing is <strong>{item.vendorStatus}</strong>. Approve the account first — a listing can't go live before its partner is approved.
          {item.vendorId && (
            <div style={{ marginTop: 8 }}>
              <AdminButton size="sm" onClick={() => onOpenVendor(item.vendorId!)}>
                Open partner account
              </AdminButton>
            </div>
          )}
        </div>
      )}
      <SectionLabel>Information</SectionLabel>
      <Facts
        rows={[
          ["Type", TYPE_LABEL[type]],
          ["Location", location(item) || "Not given"],
          ["Details", priceFacts(row) || null],
          ["Description", item.blurb || null],
          ["Reference", <span className="adm-mono">{item.id}</span>],
        ]}
      />

      <SectionLabel>Documents &amp; media</SectionLabel>
      {item.image ? (
        <img src={getMediaUrl(item.image, "card")} alt={`Cover photo for ${item.name}`} style={{ width: "100%", height: 180, objectFit: "cover", display: "block" }} />
      ) : (
        <p className="adm-note">No cover photo uploaded.</p>
      )}
      <p className="adm-note" style={{ marginTop: 8 }}>
        Listing submissions don't include documents — approval is based on the listing details and the partner account.
      </p>

      <SectionLabel>Partner</SectionLabel>
      {item.vendorId ? (
        <Facts
          rows={[
            ["Name", item.vendorName ?? null],
            ["Email", item.vendorEmail],
            ["Account", item.vendorStatus ? <StatusTag status={item.vendorStatus} label={item.vendorStatus === "approved" ? "Approved" : undefined} /> : null],
            [
              "",
              <AdminButton size="sm" onClick={() => onOpenVendor(item.vendorId!)}>
                View partner
              </AdminButton>,
            ],
          ]}
        />
      ) : (
        <p className="adm-note">No partner account — a seeded or unclaimed listing.</p>
      )}

      <SectionLabel>Settings</SectionLabel>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {can("listings.feature") ? (
        <AdminButton aria-pressed={!!item.featured} onClick={() => decisions.toggleFeatured(row)} disabled={!!busy}>
          <Star size={18} strokeWidth={1.9} aria-hidden="true" fill={item.featured ? "currentColor" : "none"} />
          {item.featured ? "Featured — remove" : "Feature this listing"}
        </AdminButton>
        ) : (
          <span className="adm-note">{item.featured ? "Featured." : "Not featured."}</span>
        )}
        <span className="adm-note">Featured listings sort first on public pages.</span>
      </div>

      {type !== "experience" && organisations.length > 0 && can("orgs.manage") && (
        <>
          <p className="adm-note" style={{ margin: "16px 0 8px" }}>
            Experimental — assigning an organisation doesn't affect visibility or access yet.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="adm-field">
              <label htmlFor="adm-org-assign">Assign organisation</label>
              <select id="adm-org-assign" className="adm-select" value={orgId} onChange={(e) => setOrgId(e.target.value)} style={{ minWidth: 220 }}>
                <option value="" disabled>
                  Choose…
                </option>
                <option value="none">— No organisation —</option>
                {organisations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <AdminButton onClick={assignOrg} disabled={!orgId || !!busy}>
              Save
            </AdminButton>
          </div>
        </>
      )}

      <SectionLabel>Decisions</SectionLabel>
      <DecisionHistory objectType={type} objectId={item.id} currentNeedsReason={item.status === "rejected"} refreshKey={item.status} />

      <SectionLabel>Activity</SectionLabel>
      <ObjectActivity objectIds={[item.id]} note="Submissions, review decisions, featuring, edits, organisation changes and deletions are recorded." />

      <ConfirmDialog
        open={confirm === "reject"}
        title={`Reject ${item.name}?`}
        message="It stays hidden from the public. The partner is told the reason category and your explanation — in their workspace and by email — and can edit the listing and resubmit it for review. The internal note isn't sent to them."
        confirmLabel="Reject listing"
        tone="neutral"
        confirmDisabled={!reasonComplete(reason)}
        onConfirm={async () => {
          await decisions.reject(row, reason);
          setConfirm(null);
          setReason(emptyReason());
        }}
        onCancel={() => setConfirm(null)}
      >
        <DecisionReasonFields kind="listing_rejection" audience="partner" value={reason} onChange={setReason} />
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "delete"}
        title={`Delete ${item.name}?`}
        message="This removes it from public view and the partner's dashboard. Bookings and registrations already made are unaffected."
        confirmLabel="Delete listing"
        onConfirm={() => {
          setConfirm(null);
          del();
        }}
        onCancel={() => setConfirm(null)}
      />
    </RecordView>
  );
}

// --- page -----------------------------------------------------------------

export function AdminListingsPage({
  mode,
  openKey,
  onOpenHandled,
  onOpenVendor,
  onCountsChanged,
}: {
  mode: "all" | "pending";
  /** "centre:<id>" etc. — opens that listing's panel once loaded. */
  openKey?: string | null;
  onOpenHandled?: () => void;
  onOpenVendor: (vendorId: string) => void;
  /** Lets the dashboard refresh its nav badge counts after a decision. */
  onCountsChanged?: () => void;
}) {
  const state = useAdminData(fetchAdminListings);
  const orgs = useAdminData(fetchAdminOrganisations);
  const reload = () => {
    state.reload();
    onCountsChanged?.();
  };
  const decisions = useListingDecisions(reload);
  const toast = useToast();
  const [rowConfirm, setRowConfirm] = useState<{ kind: "reject" | "delete"; row: ListingRow } | null>(null);
  // Bulk decisions: only pending rows can be selected (spec: the bulk toolbar
  // appears only once something is selected).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<"approved" | "rejected" | null>(null);
  const [rowReason, setRowReason] = useState<ReasonDraft>(emptyReason);
  const [bulkReason, setBulkReason] = useState<ReasonDraft>(emptyReason);
  const can = useAdminCan();
  const [bulkBusy, setBulkBusy] = useState(false);
  // Filters, page and the open record all live in the URL (see useUrlParam).
  const [q, setQ] = useUrlParam<string>("q", "");
  const [type, setType] = useUrlParam<"all" | ListingType>("type", "all");
  const [view, setView] = useUrlParam<StatusView>("view", mode === "pending" ? "pending" : "all");
  const [county, setCounty] = useUrlParam<string>("county", "all");
  const [sort, setSort] = useUrlParam<SortKey>("sort", "triage");
  const [openId, openRecord, closeRecord] = useRecordParam();
  const setOpenId = (k: string | null) => (k ? openRecord(k) : closeRecord());

  useEffect(() => {
    if (openKey) {
      openRecord(openKey);
      onOpenHandled?.();
    }
  }, [openKey, onOpenHandled, openRecord]);

  const rows = useMemo(() => (state.data ? flattenListings(state.data) : []), [state.data]);
  const scoped = mode === "pending" ? rows.filter((r) => r.item.status === "pending") : rows;
  const counties = useMemo(() => Array.from(new Set(rows.map((r) => r.item.county).filter(Boolean))).sort(), [rows]);
  const base = scoped.filter((r) => (type === "all" || r.type === type) && (county === "all" || r.item.county === county) && matches(q, r.item.name, r.item.vendorName, r.item.vendorEmail, r.item.area, r.item.county));
  const filtered = base
    .filter((r) => inView(r.item.status, view))
    .sort((a, b) => {
      if (sort === "name") return a.item.name.localeCompare(b.item.name);
      if (sort === "nameDesc") return b.item.name.localeCompare(a.item.name);
      if (sort === "partner") return (a.item.vendorName ?? "~").localeCompare(b.item.vendorName ?? "~");
      // triage: pending first, then name (the server's own order, kept across types)
      return Number(b.item.status === "pending") - Number(a.item.status === "pending") || a.item.name.localeCompare(b.item.name);
    });
  const paged = usePaged(filtered, 20, `${q}|${type}|${view}|${county}|${sort}`, "page");
  const openRow = openId ? rows.find((r) => rowKey(r) === openId) ?? null : null;

  const typeCounts = (t: ListingType) => scoped.filter((r) => r.type === t).length;

  // Drop selections that are no longer pending (decided, or filtered away after reload).
  useEffect(() => {
    setSelected((cur) => {
      const pendingKeys = new Set(rows.filter((r) => r.item.status === "pending").map(rowKey));
      const next = new Set([...cur].filter((k) => pendingKeys.has(k)));
      return next.size === cur.size ? cur : next;
    });
  }, [rows]);
  const selectable = paged.slice.filter((r) => r.item.status === "pending");
  const allOnPageSelected = selectable.length > 0 && selectable.every((r) => selected.has(rowKey(r)));
  const toggleRow = (k: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const toggleAllOnPage = () =>
    setSelected((cur) => {
      const next = new Set(cur);
      for (const r of selectable) {
        if (allOnPageSelected) next.delete(rowKey(r));
        else next.add(rowKey(r));
      }
      return next;
    });
  const selectedRows = rows.filter((r) => selected.has(rowKey(r)));
  const eligibleForApproval = selectedRows.filter((r) => !vendorBlocksApproval(r.item));
  const runBulk = async (status: "approved" | "rejected", reason?: ReasonDraft) => {
    const targets = status === "approved" ? eligibleForApproval : selectedRows;
    const skipped = selectedRows.length - targets.length;
    setBulkBusy(true);
    let done = 0;
    const failures: string[] = [];
    for (const r of targets) {
      const fn = r.type === "centre" ? setCentreStatus : r.type === "club" ? setClubStatus : setExperienceStatus;
      try {
        await fn(r.item.id, status, status === "rejected" && reason ? toReasonInput(reason) : {});
        done++;
      } catch (e) {
        failures.push(`${r.item.name}: ${errorMessage(e)}`);
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    reload();
    const verb = status === "approved" ? "Approved" : "Rejected";
    const summary = [`${verb} ${done} listing${done === 1 ? "" : "s"}`, skipped ? `${skipped} skipped (partner account not approved)` : null, failures.length ? `${failures.length} failed` : null].filter(Boolean).join(" · ");
    if (failures.length) toast.error(`${summary}. ${failures.join("; ")}`);
    else {
      toast.success(summary);
      if (status === "rejected") setBulkReason(emptyReason()); // kept after a failure so it can be reused
    }
  };

  const backLabel = mode === "pending" ? "Pending approvals" : "All listings";
  if (openId) {
    if (state.error && !state.data) return <RecordState state="error" backLabel={backLabel} onBack={closeRecord} onRetry={state.reload} />;
    if (!state.data) return <RecordState state="loading" backLabel={backLabel} onBack={closeRecord} />;
    if (!openRow) return <RecordState state="missing" backLabel={backLabel} onBack={closeRecord} />;
    return (
      <ListingRecord
        row={openRow}
        backLabel={backLabel}
        organisations={orgs.data ?? []}
        onClose={closeRecord}
        onChanged={reload}
        onOpenVendor={onOpenVendor}
        decisions={decisions}
      />
    );
  }

  return (
    <div className="adm-stack">
      <Box flush>
        {mode === "all" && (
          <ViewTabs
            label="Listing status"
            value={view}
            onChange={setView}
            views={STATUS_VIEWS.map((v) => ({ key: v.key, label: v.label, count: state.data ? base.filter((r) => inView(r.item.status, v.key)).length : undefined }))}
          />
        )}
        <Toolbar label="Filter listings">
          <SearchField label="Search listings" value={q} onChange={setQ} placeholder="Name, partner, email or area" />
          <SelectField
            label="Type"
            value={type}
            onChange={setType}
            options={[
              { value: "all", label: `All types (${scoped.length})` },
              { value: "centre", label: `Community centres (${typeCounts("centre")})` },
              { value: "club", label: `Sports clubs (${typeCounts("club")})` },
              { value: "experience", label: `Experiences (${typeCounts("experience")})` },
            ]}
          />
          <SelectField label="County" value={county} onChange={setCounty} options={[{ value: "all", label: "All counties" }, ...counties.map((c) => ({ value: c, label: c }))]} />
          <SelectField
            label="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { value: "triage", label: "Pending first" },
              { value: "name", label: "Name A–Z" },
              { value: "nameDesc", label: "Name Z–A" },
              { value: "partner", label: "Partner" },
            ]}
          />
        </Toolbar>
        <Loaded state={state} rows={6}>
          {() =>
            filtered.length === 0 ? (
              mode === "pending" && scoped.length === 0 ? (
                <EmptyMessage icon={<ClipboardCheck size={22} strokeWidth={1.9} aria-hidden="true" />} title="All caught up" detail="No listings are waiting for a decision." />
              ) : (
                <EmptyMessage
                  title="No listings match"
                  detail="Try a different search or filter."
                  action={
                    <AdminButton
                      onClick={() => {
                        setQ("");
                        setType("all");
                        setCounty("all");
                        setView(mode === "pending" ? "pending" : "all");
                      }}
                    >
                      Clear filters
                    </AdminButton>
                  }
                />
              )
            ) : (
              <>
                {selected.size > 0 && can("listings.moderate") && (
                  <div className="adm-bulk" role="region" aria-label="Bulk actions">
                    <span aria-live="polite">{selected.size} selected</span>
                    <AdminButton size="sm" variant="primary" disabled={bulkBusy || eligibleForApproval.length === 0} onClick={() => setBulk("approved")}>
                      Approve {eligibleForApproval.length}
                    </AdminButton>
                    <AdminButton size="sm" disabled={bulkBusy} onClick={() => setBulk("rejected")}>
                      Reject {selected.size}
                    </AdminButton>
                    <AdminButton size="sm" variant="quiet" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
                      Clear selection
                    </AdminButton>
                    {bulkBusy && <span role="status">Working…</span>}
                  </div>
                )}
                <div className="adm-table-wrap">
                  <table className="adm-table adm-table--stack">
                    <caption className="adm-visually-hidden">{mode === "pending" ? "Listings pending approval" : "All listings"}</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="adm-col-check">
                          {filtered.some((r) => r.item.status === "pending") ? (
                            <input type="checkbox" className="adm-check" checked={allOnPageSelected} onChange={toggleAllOnPage} disabled={selectable.length === 0} aria-label="Select all pending listings on this page" />
                          ) : (
                            <span className="adm-visually-hidden">Select</span>
                          )}
                        </th>
                        <th scope="col">Listing</th>
                        <th scope="col">Type</th>
                        <th scope="col">Partner</th>
                        <th scope="col">Status</th>
                        <th scope="col">
                          <span className="adm-visually-hidden">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {paged.slice.map((r) => {
                        const k = rowKey(r);
                        const blocked = vendorBlocksApproval(r.item);
                        return (
                          <tr key={k}>
                            <td className="adm-col-check">
                              {r.item.status === "pending" && (
                                <input type="checkbox" className="adm-check" checked={selected.has(k)} onChange={() => toggleRow(k)} aria-label={`Select ${r.item.name}`} />
                              )}
                            </td>
                            <td data-label="Listing">
                              <button type="button" className="adm-row-button" onClick={() => setOpenId(k)} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                                {r.item.image ? <img className="adm-thumb" src={getMediaUrl(r.item.image, "thumbnail")} alt="" /> : <span className="adm-thumb" aria-hidden="true" />}
                                <span style={{ minWidth: 0 }}>
                                  <span className="adm-cell-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    {r.item.name}
                                    {!!r.item.featured && (
                                      <>
                                        <Star size={13} strokeWidth={1.9} fill="currentColor" aria-hidden="true" style={{ color: "var(--color-gold)" }} />
                                        <span className="adm-visually-hidden">(featured)</span>
                                      </>
                                    )}
                                  </span>
                                  <span className="adm-cell-sub" style={{ display: "block" }}>
                                    {[location(r.item), priceFacts(r)].filter(Boolean).join(" · ") || "No location given"}
                                  </span>
                                </span>
                              </button>
                            </td>
                            <td data-label="Type">{TYPE_LABEL[r.type]}</td>
                            <td data-label="Partner">
                              {r.item.vendorName || r.item.vendorEmail ? (
                                <>
                                  <div>{r.item.vendorName ?? r.item.vendorEmail}</div>
                                  {blocked && (
                                    <div className="adm-cell-sub" style={{ color: "var(--color-orange-dark)" }}>
                                      Partner account {r.item.vendorStatus}
                                    </div>
                                  )}
                                </>
                              ) : (
                                <span className="adm-cell-sub">Unclaimed</span>
                              )}
                            </td>
                            <td data-label="Status">
                              <StatusTag status={r.item.status} />
                            </td>
                            <td>
                              <div className="adm-cell-actions">
                                {r.item.status === "pending" && can("listings.moderate") && (
                                  <AdminButton
                                    size="sm"
                                    variant="primary"
                                    disabled={blocked || !!decisions.busy}
                                    title={blocked ? "Approve the partner account first" : undefined}
                                    onClick={() => decisions.setStatus(r, "approved")}
                                    aria-label={`Approve ${r.item.name}`}
                                  >
                                    Approve
                                  </AdminButton>
                                )}
                                <AdminButton size="sm" onClick={() => setOpenId(k)} aria-label={`Review ${r.item.name}`}>
                                  Review
                                </AdminButton>
                                <OverflowMenu
                                  label={`More actions for ${r.item.name}`}
                                  actions={[
                                    ...(r.item.status !== "rejected" && can("listings.moderate") ? [{ label: "Reject…", onSelect: () => setRowConfirm({ kind: "reject", row: r }), disabled: !!decisions.busy }] : []),
                                    ...(can("listings.feature") ? [{ label: r.item.featured ? "Remove from featured" : "Feature listing", onSelect: () => decisions.toggleFeatured(r), disabled: !!decisions.busy }] : []),
                                    ...(r.type !== "experience" && can("listings.delete") ? [{ label: "Delete listing…", danger: true, onSelect: () => setRowConfirm({ kind: "delete", row: r }), disabled: !!decisions.busy }] : []),
                                  ]}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pager {...paged} noun="listings" />
              </>
            )
          }
        </Loaded>
      </Box>

      <ConfirmDialog
        open={rowConfirm?.kind === "reject"}
        title={`Reject ${rowConfirm?.row.item.name ?? ""}?`}
        message="It stays hidden from the public. The partner is told the reason category and your explanation (in their workspace and by email) and can fix and resubmit it. The internal note isn't sent to them."
        confirmLabel="Reject"
        tone="neutral"
        confirmDisabled={!reasonComplete(rowReason)}
        onConfirm={async () => {
          if (rowConfirm) await decisions.reject(rowConfirm.row, rowReason);
          setRowConfirm(null);
          setRowReason(emptyReason());
        }}
        onCancel={() => setRowConfirm(null)}
      >
        <DecisionReasonFields kind="listing_rejection" audience="partner" value={rowReason} onChange={setRowReason} />
      </ConfirmDialog>
      <ConfirmDialog
        open={rowConfirm?.kind === "delete"}
        title={`Delete ${rowConfirm?.row.item.name ?? ""}?`}
        message="This removes it from public view and the partner's dashboard. Bookings and registrations already made are unaffected."
        confirmLabel="Delete"
        onConfirm={() => {
          if (rowConfirm) decisions.remove(rowConfirm.row);
          setRowConfirm(null);
        }}
        onCancel={() => setRowConfirm(null)}
      />
      <ConfirmDialog
        open={bulk !== null}
        title={bulk === "approved" ? `Approve ${eligibleForApproval.length} listing${eligibleForApproval.length === 1 ? "" : "s"}?` : `Reject ${selected.size} listing${selected.size === 1 ? "" : "s"}?`}
        message={
          bulk === "approved"
            ? `They go live immediately and their partners' followers are notified.${selectedRows.length > eligibleForApproval.length ? ` ${selectedRows.length - eligibleForApproval.length} selected listing(s) will be skipped because the partner account isn't approved yet.` : ""}`
            : "Each partner is sent the same reason category and explanation (in their workspace and by email) and can fix and resubmit. The internal note isn't sent."
        }
        confirmLabel={bulk === "approved" ? "Approve all" : "Reject all"}
        tone="neutral"
        confirmDisabled={bulk === "rejected" && !reasonComplete(bulkReason)}
        onConfirm={() => {
          const s = bulk;
          setBulk(null);
          if (s) runBulk(s, bulkReason);
        }}
        onCancel={() => setBulk(null)}
      >
        {bulk === "rejected" && <DecisionReasonFields kind="listing_rejection" audience="partner" value={bulkReason} onChange={setBulkReason} />}
      </ConfirmDialog>
    </div>
  );
}
