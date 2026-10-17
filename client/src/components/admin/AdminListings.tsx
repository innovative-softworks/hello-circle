import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Check, ClipboardCheck, ImageOff, MapPin, Star, X } from "lucide-react";
import {
  adminDeleteCentre,
  adminDeleteClub,
  fetchAdminListingDetail,
  fetchAdminListings,
  fetchAdminOrganisations,
  setCentreOrganisation,
  setCentreStatus,
  setClubOrganisation,
  setClubStatus,
  setExperienceStatus,
  setListingFeatured,
  type AdminListingDetail,
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
  ErrorMessage,
  LoadingRows,
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
  formatDate,
  statusLabel,
  matches,
  useAdminAction,
  useAdminData,
  usePaged,
  AdminModal,
  type AdminData,
} from "./adminUi";
import { listingChecks, similarListings } from "./listingReview";
import { time, waitingLabel } from "./timeLabels";
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

type SortKey = "triage" | "oldest" | "newest" | "name" | "nameDesc" | "partner";
type ShowKey = "all" | "featured" | "unclaimed" | "partner";

/** Oldest submission first; rows without a date go last. */
function byOldest(a: ListingRow, b: ListingRow) {
  return (time(a.item.createdAt) ?? Number.MAX_SAFE_INTEGER) - (time(b.item.createdAt) ?? Number.MAX_SAFE_INTEGER) || a.item.name.localeCompare(b.item.name);
}

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

// --- record page: review layout (2026-10-16) -----------------------------
// Left: the listing as the public will see it (photos, description, what can
// be booked). Right: the decision panel (checks, partner, similar listings,
// Approve / Reject, then on to the next pending listing). For a listing that
// is already decided, the panel holds its status and settings instead.

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const euros = (n: number) => `€${n.toLocaleString("en-IE", { maximumFractionDigits: 2 })}`;
const CHECK_ICON = { pass: Check, warn: AlertTriangle, fail: X } as const;

function ListingPreview({ row, detail }: { row: ListingRow; detail: AdminData<AdminListingDetail> }) {
  const { item } = row;
  const photos = detail.data?.images ?? (item.image ? [item.image] : []);
  const description = detail.data?.description ?? item.blurb;
  const facts: string[] = [];
  const d = detail.data;
  if (d?.centre) {
    const rooms = d.centre.rooms.filter((r) => r.active);
    const maxCap = Math.max(0, ...rooms.map((r) => r.capacity));
    const minRate = rooms.filter((r) => r.rate > 0).reduce((m, r) => Math.min(m, r.rate), Infinity);
    facts.push(maxCap ? `Up to ${maxCap} people` : "Capacity not set", Number.isFinite(minRate) ? `From ${euros(minRate)}/hr` : "No hourly rate", `${rooms.length} room${rooms.length === 1 ? "" : "s"}`);
  } else if (d?.club) {
    facts.push(d.club.sport, d.club.ages ? `Ages ${d.club.ages}` : "", d.club.price ? `${euros(d.club.price)}/${d.club.unit}` : "Free", d.club.trial ? "Free trial" : "");
  } else if (d?.experience) {
    const e = d.experience;
    facts.push(e.kind.charAt(0).toUpperCase() + e.kind.slice(1), `${Math.round(e.durationMinutes / 6) / 10} h`, e.priceCents ? euros(e.priceCents / 100) : "Free", `Groups of up to ${e.capacity}`, e.difficulty);
  }
  return (
    <div className="adm-review-main">
      <section aria-label="Photos">
        {photos.length ? (
          <div className="adm-gallery" data-count={Math.min(photos.length, 5)}>
            {photos.slice(0, 5).map((src, i) => (
              <img key={src + i} src={getMediaUrl(src, i === 0 ? "card" : "thumbnail")} alt={i === 0 ? `Cover photo for ${item.name}` : `Photo ${i + 1} of ${item.name}`} />
            ))}
          </div>
        ) : (
          <div className="adm-gallery-empty">
            <ImageOff size={22} strokeWidth={1.9} aria-hidden="true" />
            No photos uploaded
          </div>
        )}
      </section>
      <p className="adm-review-loc">
        <MapPin size={16} strokeWidth={1.9} aria-hidden="true" /> {location(item) || "No location given"}
      </p>
      {facts.filter(Boolean).length > 0 && (
        <ul className="adm-review-facts" aria-label="Key facts">
          {facts.filter(Boolean).map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      <SectionLabel>Description</SectionLabel>
      <p className="adm-review-text">{description || <span className="adm-note">No description.</span>}</p>

      {detail.error ? (
        <ErrorMessage error={detail.error} onRetry={detail.reload} title="Couldn't load the full listing" />
      ) : !d ? (
        <LoadingRows rows={3} label="Loading the full listing" />
      ) : (
        <>
          {d.centre && (
            <>
              <SectionLabel>Rooms</SectionLabel>
              {d.centre.rooms.length ? (
                <div className="adm-table-wrap">
                  <table className="adm-table adm-table--stack">
                    <thead>
                      <tr>
                        <th scope="col">Room</th>
                        <th scope="col">Capacity</th>
                        <th scope="col">Rate</th>
                        <th scope="col">Payment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.centre.rooms.map((r) => (
                        <tr key={r.name} style={r.active ? undefined : { opacity: 0.55 }}>
                          <td data-label="Room">
                            <div className="adm-cell-title">
                              {r.name}
                              {!r.active && " (inactive)"}
                            </div>
                            {r.description && <div className="adm-cell-sub">{r.description}</div>}
                          </td>
                          <td data-label="Capacity" data-warn={r.capacity <= 0 || undefined}>{r.capacity > 0 ? r.capacity : "Not set"}</td>
                          <td data-label="Rate" data-warn={r.rate <= 0 || undefined}>{r.rate > 0 ? `${euros(r.rate)}/hr` : "€0"}</td>
                          <td data-label="Payment">{r.paymentMethod === "cash" ? "Pay on the day" : "Online"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="adm-note">No rooms.</p>
              )}
              <SectionLabel>Opening hours</SectionLabel>
              {d.centre.hours.length ? (
                <ul className="adm-review-hours">
                  {d.centre.hours.map((h) => (
                    <li key={h.day}>
                      <span>{DAYS[h.day]}</span>
                      {h.closed ? "Closed" : `${h.opensAt}–${h.closesAt}`}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="adm-review-text">
                  Every day, {d.centre.opensAt}–{d.centre.closesAt}
                </p>
              )}
              {d.centre.amenities.length > 0 && (
                <>
                  <SectionLabel>Amenities</SectionLabel>
                  <ul className="adm-review-facts">
                    {d.centre.amenities.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
          {d.club && (
            <>
              {d.club.includes.length > 0 && (
                <>
                  <SectionLabel>What's included</SectionLabel>
                  <ul className="adm-review-facts">
                    {d.club.includes.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </>
              )}
              <SectionLabel>Weekly sessions</SectionLabel>
              {d.club.sessions.length ? (
                <ul className="adm-review-hours">
                  {d.club.sessions.map((s, i) => (
                    <li key={i} style={s.active ? undefined : { opacity: 0.55 }}>
                      <span>{DAYS[s.day]}</span>
                      {s.time}
                      {s.label ? ` · ${s.label}` : ""}
                      {s.capacity ? ` · ${s.capacity} places` : ""}
                      {!s.active && " (paused)"}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="adm-note">No weekly sessions yet.</p>
              )}
            </>
          )}
          {d.experience && (
            <>
              {d.experience.meetingPoint && (
                <>
                  <SectionLabel>Meeting point</SectionLabel>
                  <p className="adm-review-text">{d.experience.meetingPoint}</p>
                </>
              )}
              <SectionLabel>Upcoming dates</SectionLabel>
              {d.experience.upcomingSessions.length ? (
                <ul className="adm-review-hours">
                  {d.experience.upcomingSessions.map((s, i) => (
                    <li key={i}>
                      <span>{formatDate(s.date)}</span>
                      {s.time}
                      {s.capacity ? ` · ${s.capacity} places` : ""}
                      {s.status !== "scheduled" ? ` · ${s.status}` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="adm-note">No upcoming dates{d.experience.totalSessions ? ` (${d.experience.totalSessions} in the past)` : ""}.</p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function ListingRecord({
  row,
  allRows,
  next,
  organisations,
  onClose,
  onOpen,
  onChanged,
  onOpenVendor,
  decisions,
  backLabel,
}: {
  row: ListingRow;
  allRows: ListingRow[];
  /** The next pending listing to review after this one (oldest first). */
  next: ListingRow | null;
  backLabel: string;
  organisations: AdminOrganisation[];
  onClose: () => void;
  onOpen: (key: string) => void;
  onChanged: () => void;
  onOpenVendor: (vendorId: string) => void;
  decisions: ReturnType<typeof useListingDecisions>;
}) {
  const [confirm, setConfirm] = useState<"reject" | "delete" | null>(null);
  const [reason, setReason] = useState<ReasonDraft>(emptyReason);
  const can = useAdminCan();
  const toast = useToast();
  const [orgId, setOrgId] = useState("");
  const [orgOpen, setOrgOpen] = useState(false);
  useEffect(() => setOrgId(""), [row.item.id]);
  const { item, type } = row;
  const detail = useAdminData(() => fetchAdminListingDetail(type, item.id), [type, item.id]);
  const blocked = vendorBlocksApproval(item);
  const key = rowKey(row);
  const { busy, run } = decisions;
  const pending = item.status === "pending";
  const checks = listingChecks(item, detail.data);
  // Only useful before publishing: "is this a re-creation of an existing place?"
  const similar = pending ? similarListings(item, allRows) : [];
  const warnings = checks.filter((c) => c.state !== "pass").length;
  const waiting = waitingLabel(item.createdAt ?? null);

  // After a decision on a pending listing, carry on with the next one.
  const afterDecision = () => {
    if (next) onOpen(rowKey(next));
    else {
      toast.success("All caught up: no more listings waiting");
      onClose();
    }
  };

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
    }).then((ok) => {
      if (ok) onChanged();
      return ok;
    });

  const menu = [
    ...(item.status === "approved" && can("listings.moderate") ? [{ label: "Unpublish (reject)…", onSelect: () => setConfirm("reject"), disabled: !!busy }] : []),
    ...(type !== "experience" && can("listings.delete") ? [{ label: "Delete listing…", danger: true, onSelect: () => setConfirm("delete"), disabled: !!busy }] : []),
  ];

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
          <span className="adm-note">Listing:</span> <StatusTag status={item.status} />
          {item.vendorId && (
            <>
              <span className="adm-note">Partner account:</span> <StatusTag status={item.vendorStatus ?? "unknown"} label={item.vendorStatus === "approved" ? "Approved" : undefined} />
            </>
          )}
          {!!item.featured && <Badge tone="outline">Featured</Badge>}
        </>
      }
      actions={menu.length ? <OverflowMenu label={`More actions for ${item.name}`} actions={menu} /> : undefined}
    >
      <div className="adm-review">
        <ListingPreview row={row} detail={detail} />

        <aside className="adm-review-side" aria-label={pending ? "Review decision" : "Listing status and settings"}>
          {pending && (
            <section className="adm-review-card">
              <h2 className="adm-review-h">Decision</h2>
              {waiting && <p className="adm-note" style={{ margin: "0 0 12px" }}>Submitted {waiting.replace("Waiting ", "")} ago</p>}
              <ul className="adm-checks" aria-label="Automatic checks">
                {checks.map((c) => {
                  const Icon = CHECK_ICON[c.state];
                  return (
                    <li key={c.key} data-state={c.state}>
                      <Icon size={16} strokeWidth={2.2} aria-hidden="true" />
                      <div>
                        <span className="adm-visually-hidden">{c.state === "pass" ? "Passed: " : c.state === "warn" ? "Check: " : "Blocking: "}</span>
                        {c.label}
                        {c.detail && <div className="adm-cell-sub">{c.detail}</div>}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="adm-note" style={{ margin: "8px 0 16px" }}>
                {blocked ? "Approve the partner account before publishing." : warnings ? `${warnings} thing${warnings === 1 ? "" : "s"} to look at. These checks are advice; you decide.` : "Everything checked looks fine."}
              </p>
              {can("listings.moderate") ? (
                <div className="adm-review-actions">
                  <AdminButton variant="primary" disabled={blocked || !!busy} onClick={() => decisions.setStatus(row, "approved").then((ok) => ok && afterDecision())}>
                    {busy === `${key}:approved` ? "Approving…" : next ? "Approve & next" : "Approve & publish"}
                  </AdminButton>
                  <AdminButton onClick={() => setConfirm("reject")} disabled={!!busy}>
                    {next ? "Reject & next…" : "Reject…"}
                  </AdminButton>
                  {next && (
                    <AdminButton variant="quiet" size="sm" onClick={() => onOpen(rowKey(next))}>
                      Skip to next <ArrowRight size={16} strokeWidth={1.9} aria-hidden="true" />
                    </AdminButton>
                  )}
                </div>
              ) : (
                <p className="adm-note">Your admin role can view listings but not approve or reject them.</p>
              )}
            </section>
          )}

          {similar.length > 0 && (
            <section className="adm-review-card" data-tone="warn">
              <h2 className="adm-review-h">Similar listing{similar.length === 1 ? "" : "s"} in {item.county}</h2>
              <p className="adm-note" style={{ margin: "0 0 8px" }}>If it's the same place, the partner should claim the existing listing instead.</p>
              <ul className="adm-similar">
                {similar.map((s) => (
                  <li key={rowKey(s)}>
                    <button type="button" className="adm-linkish" onClick={() => onOpen(rowKey(s))}>
                      {s.item.name}
                    </button>
                    <span className="adm-cell-sub">
                      {location(s.item)} · {s.item.vendorName ?? "Unclaimed"} · {statusLabel(s.item.status)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!pending && can("listings.moderate") && item.status !== "approved" && (
            <section className="adm-review-card">
              <h2 className="adm-review-h">Publish</h2>
              <p className="adm-note" style={{ margin: "0 0 12px" }}>This listing is {statusLabel(item.status).toLowerCase()}.</p>
              <AdminButton variant="primary" disabled={blocked || !!busy} onClick={() => decisions.setStatus(row, "approved")}>
                {busy === `${key}:approved` ? "Approving…" : "Approve & publish"}
              </AdminButton>
            </section>
          )}

          <section className="adm-review-card">
            <h2 className="adm-review-h">Partner</h2>
            {item.vendorId ? (
              <>
                <div className="adm-cell-title">{item.vendorName || item.vendorEmail}</div>
                {item.vendorName && <div className="adm-cell-sub">{item.vendorEmail}</div>}
                <div style={{ margin: "8px 0 12px" }}>
                  <StatusTag status={item.vendorStatus ?? "unknown"} label={item.vendorStatus === "approved" ? "Approved" : undefined} />
                </div>
                <AdminButton size="sm" onClick={() => onOpenVendor(item.vendorId!)}>
                  {blocked ? "Open partner account to approve it" : "View partner"}
                </AdminButton>
              </>
            ) : (
              <p className="adm-note" style={{ margin: 0 }}>No partner account. This is a seeded or unclaimed listing.</p>
            )}
          </section>

          {item.status === "approved" && (
            <section className="adm-review-card">
              <h2 className="adm-review-h">Settings</h2>
              {can("listings.feature") ? (
                <AdminButton aria-pressed={!!item.featured} onClick={() => decisions.toggleFeatured(row)} disabled={!!busy}>
                  <Star size={18} strokeWidth={1.9} aria-hidden="true" fill={item.featured ? "currentColor" : "none"} />
                  {item.featured ? "Featured: remove" : "Feature this listing"}
                </AdminButton>
              ) : (
                <span className="adm-note">{item.featured ? "Featured." : "Not featured."}</span>
              )}
              <p className="adm-note" style={{ margin: "6px 0 0" }}>Featured listings sort first on public pages.</p>
              {type !== "experience" && organisations.length > 0 && can("orgs.manage") && (
                <div style={{ marginTop: 16 }}>
                  <AdminButton size="sm" onClick={() => setOrgOpen(true)}>
                    Assign organisation…
                  </AdminButton>
                  <AdminModal
                    open={orgOpen}
                    onClose={() => setOrgOpen(false)}
                    dirty={!!orgId}
                    title="Assign an organisation"
                    subtitle="Experimental: this doesn't affect visibility or access yet."
                    footer={
                      <>
                        <AdminButton variant="quiet" onClick={() => setOrgOpen(false)}>
                          Cancel
                        </AdminButton>
                        <AdminButton variant="primary" onClick={() => assignOrg().then((ok) => ok && setOrgOpen(false))} disabled={!orgId || !!busy}>
                          Save
                        </AdminButton>
                      </>
                    }
                  >
                    <div className="adm-field">
                      <label htmlFor="adm-org-assign">Organisation</label>
                      <select id="adm-org-assign" className="adm-select" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                        <option value="" disabled>
                          Choose…
                        </option>
                        <option value="none">No organisation</option>
                        {organisations.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </AdminModal>
                </div>
              )}
            </section>
          )}
        </aside>

        <div className="adm-review-history">
          <SectionLabel>Decisions</SectionLabel>
          <DecisionHistory objectType={type} objectId={item.id} currentNeedsReason={item.status === "rejected"} refreshKey={item.status} />
          <SectionLabel>Activity</SectionLabel>
          <ObjectActivity objectIds={[item.id]} note="Submissions, review decisions, featuring, edits, organisation changes and deletions are recorded." />
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "reject"}
        title={item.status === "approved" ? `Unpublish ${item.name}?` : `Reject ${item.name}?`}
        message="It stays hidden from the public. The partner is told the reason category and your explanation, in their workspace and by email, and can edit the listing and resubmit it for review. The internal note isn't sent to them."
        confirmLabel={item.status === "approved" ? "Unpublish listing" : "Reject listing"}
        tone="neutral"
        confirmDisabled={!reasonComplete(reason)}
        onConfirm={async () => {
          await decisions.reject(row, reason);
          setConfirm(null);
          setReason(emptyReason());
          if (pending) afterDecision();
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
  const [show, setShow] = useUrlParam<ShowKey>("show", "all");
  const [sortParam, setSort] = useUrlParam<SortKey>("sort", mode === "pending" ? "oldest" : "triage");
  // The pending queue is always worked oldest first.
  const sort: SortKey = mode === "pending" ? "oldest" : sortParam;
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
  const showOk = (r: ListingRow) => show === "all" || (show === "featured" ? !!r.item.featured : show === "unclaimed" ? !r.item.vendorId : !!r.item.vendorId);
  const base = scoped.filter((r) => (type === "all" || r.type === type) && (county === "all" || r.item.county === county) && showOk(r) && matches(q, r.item.name, r.item.vendorName, r.item.vendorEmail, r.item.area, r.item.county));
  const filtered = base
    .filter((r) => inView(r.item.status, view))
    .sort((a, b) => {
      if (sort === "name") return a.item.name.localeCompare(b.item.name);
      if (sort === "nameDesc") return b.item.name.localeCompare(a.item.name);
      if (sort === "oldest") return byOldest(a, b);
      if (sort === "newest") return byOldest(b, a);
      if (sort === "partner") return (a.item.vendorName ?? "~").localeCompare(b.item.vendorName ?? "~");
      // triage: pending first, then name (the server's own order, kept across types)
      return Number(b.item.status === "pending") - Number(a.item.status === "pending") || a.item.name.localeCompare(b.item.name);
    });
  const paged = usePaged(filtered, 20, `${q}|${type}|${view}|${county}|${sort}|${show}`, "page");
  const openRow = openId ? rows.find((r) => rowKey(r) === openId) ?? null : null;
  // Review flow: the pending queue oldest first, and the one after the open record.
  const pendingQueue = useMemo(() => rows.filter((r) => r.item.status === "pending").sort(byOldest), [rows]);
  const nextPending = (() => {
    if (!openRow) return null;
    const others = pendingQueue.filter((r) => rowKey(r) !== rowKey(openRow));
    if (!others.length) return null;
    const at = pendingQueue.findIndex((r) => rowKey(r) === rowKey(openRow));
    return at >= 0 ? pendingQueue.slice(at + 1)[0] ?? others[0] : others[0];
  })();

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
        allRows={rows}
        next={nextPending}
        onOpen={openRecord}
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
            views={STATUS_VIEWS.filter((v) => v.key !== "other" || view === "other" || base.some((r) => inView(r.item.status, "other"))).map((v) => ({
              key: v.key,
              label: v.key === "other" ? "Draft / removed" : v.label,
              count: state.data ? base.filter((r) => inView(r.item.status, v.key)).length : undefined,
            }))}
          />
        )}
        {mode === "pending" && (
          <ViewTabs
            label="Listing type"
            value={type}
            onChange={setType}
            views={[
              { key: "all" as const, label: "All", count: state.data ? scoped.length : undefined },
              { key: "centre" as const, label: "Community centres", count: state.data ? typeCounts("centre") : undefined },
              { key: "club" as const, label: "Sports clubs", count: state.data ? typeCounts("club") : undefined },
              { key: "experience" as const, label: "Experiences", count: state.data ? typeCounts("experience") : undefined },
            ]}
          />
        )}
        <Toolbar label="Filter listings">
          <SearchField label="Search listings" value={q} onChange={setQ} placeholder="Name, partner, email or area" />
          {mode === "all" && (
          <>
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
          <SelectField
            label="Show"
            value={show}
            onChange={setShow}
            options={[
              { value: "all", label: "All listings" },
              { value: "featured", label: "Featured only" },
              { value: "unclaimed", label: "Unclaimed (no partner)" },
              { value: "partner", label: "With a partner" },
            ]}
          />
          <SelectField label="County" value={county} onChange={setCounty} options={[{ value: "all", label: "All counties" }, ...counties.map((c) => ({ value: c, label: c }))]} />
          <SelectField
            label="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { value: "triage", label: "Pending first" },
              { value: "newest", label: "Newest first" },
              { value: "oldest", label: "Oldest first" },
              { value: "name", label: "Name A–Z" },
              { value: "nameDesc", label: "Name Z–A" },
              { value: "partner", label: "Partner" },
            ]}
          />
          </>
          )}
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
                        setShow("all");
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
                        <th scope="col">{mode === "pending" ? "Waiting" : "Status"}</th>
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
                            {mode === "pending" ? (
                              <td data-label="Waiting">{waitingLabel(r.item.createdAt ?? null)?.replace("Waiting ", "") ?? "Unknown"}</td>
                            ) : (
                              <td data-label="Status">
                                <StatusTag status={r.item.status} />
                              </td>
                            )}
                            <td>
                              <div className="adm-cell-actions">
                                <AdminButton size="sm" variant={r.item.status === "pending" ? "primary" : "secondary"} onClick={() => setOpenId(k)} aria-label={`${r.item.status === "pending" ? "Review" : "Open"} ${r.item.name}`}>
                                  {r.item.status === "pending" ? "Review" : "Open"}
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
