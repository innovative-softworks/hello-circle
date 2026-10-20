import { useState } from "react";
import { useConfirm } from "./ConfirmProvider";
import { useToast } from "./Toast";
import {
  deleteVendorCentre,
  deleteVendorClub,
  duplicateVendorCentre,
  duplicateVendorClub,
  pauseVendorCentre,
  pauseVendorClub,
  resumeVendorCentre,
  resumeVendorClub,
} from "../api";
import { Building2, LayoutList, Plus, Volleyball } from "lucide-react";
import { CheckCircleIcon } from "./icons";
import { AdminButton, Box, IconTabs } from "./admin/adminUi";
import { useUrlParam } from "../useUrlTab";
import { VENUE_NOT_PUBLIC_HELP, VENUE_NOT_PUBLIC_LABEL, VENUE_PAGES_PUBLIC } from "../venueLaunch";
import { ManageCard as Card, ConfirmDialog, EmptyState } from "./ui";
import { ActionMenu } from "./ActionMenu";
import { getMediaUrl } from "../media";
import { colors, fonts } from "../theme";
import type { VendorListingSummary, VendorType } from "../types";

// Host Manage spec §7's Listings actions (Duplicate/Pause/Share) — didn't
// exist before (only Edit/Delete did). Share just copies the public link
// (no share-sheet infra needed here, same "copy to clipboard" pattern used
// elsewhere, e.g. GameDetail.tsx's handleShare); Pause/Resume flips the new
// 'paused' status (see vendorListings.ts's routes — every public read
// already filters to status = 'approved', so this needs no other wiring);
// Duplicate clones core fields into a new draft, landing in the wizard.
function useCopyPublicLink() {
  const toast = useToast();
  return async (kind: "centre" | "club", id: string) => {
    const url = `${window.location.origin}/${kind === "centre" ? "centres" : "clubs"}/${id}`;
    await navigator.clipboard.writeText(url);
    toast.success("Link copied");
  };
}

// The Listings tab — one table of every centre and club (type tabs when there
// are both; Add centre / Add club live in the page header) plus the setup
// checklist — split out of the original single VendorDashboard.tsx (see
// CLAUDE.md).

function ChecklistStep({ done, label }: { done: boolean; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: done ? colors.greenBg : colors.panel,
          color: done ? colors.green : colors.faint,
          border: done ? "none" : `1.5px solid ${colors.border}`,
        }}
      >
        {done && <CheckCircleIcon size={13} />}
      </div>
      <span style={{ fontSize: 13.5, color: done ? colors.text : colors.muted, textDecoration: done ? "line-through" : "none" }}>{label}</span>
    </div>
  );
}

export function SetupChecklist({ vendorType, listings }: { vendorType: VendorType; listings: { centres: VendorListingSummary[]; clubs: VendorListingSummary[] } }) {
  const rows = vendorType === "sports" ? listings.clubs.filter((c) => c.status !== "deleted") : listings.centres.filter((c) => c.status !== "deleted");
  const noun = vendorType === "sports" ? "sports club" : "community centre";
  const hasListing = rows.length > 0;
  const hasPhoto = rows.some((r) => !!r.image);
  const hasApproved = rows.some((r) => r.status === "approved");

  if (hasListing && hasPhoto && hasApproved) return null;

  return (
    <Card style={{ padding: "16px 20px", marginBottom: 24 }}>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Finish setting up</h2>
      <p style={{ color: colors.mutedLight, fontSize: 12.5, margin: "0 0 4px" }}>A few steps left before your {noun} is fully live.</p>
      <ChecklistStep done={hasListing} label={`Add your first ${noun}`} />
      <ChecklistStep done={hasPhoto} label="Add a photo" />
      <ChecklistStep done={hasApproved} label="Get admin approval for your listing" />
    </Card>
  );
}

type Kind = "centre" | "club";
type Row = VendorListingSummary & { kind: Kind };

const STATUS_CHIP: Record<VendorListingSummary["status"], { label: string; tone?: "good" | "warn" }> = {
  approved: { label: "Live", tone: "good" },
  pending: { label: "Pending review", tone: "warn" },
  rejected: { label: "Changes needed", tone: "warn" },
  draft: { label: "Draft" },
  paused: { label: "Paused" },
  deleted: { label: "Deleted" },
};

function ListingStatusChip({ status }: { status: VendorListingSummary["status"] }) {
  // HC-QA-059 — while venue pages are gated, "approved" isn't publicly visible.
  const chip = status === "approved" && !VENUE_PAGES_PUBLIC ? { label: VENUE_NOT_PUBLIC_LABEL, tone: "good" as const } : STATUS_CHIP[status];
  return (
    <span className="adm-chip" data-tone={chip.tone}>
      {chip.label}
    </span>
  );
}

/** The same seven checks as the listing editor's readiness rail
 * (VendorCentreEditor.tsx / VendorClubEditor.tsx). */
function profileChecks(r: Row): boolean[] {
  const named = r.kind === "centre" ? !!r.name.trim() && !!r.blurb?.trim() : !!r.name.trim() && !!r.sport?.trim() && !!r.blurb?.trim();
  const fifth = r.kind === "centre" ? !!r.opensAt : r.price != null;
  return [named, !!(r.area && r.county), !!r.phone?.trim(), fifth, (r.extrasCount ?? 0) > 0, !!r.hasAccessibility, (r.imagesCount ?? 0) > 0 || !!r.image];
}

/** Price / capacity / ages in one short line. */
function factsLine(r: Row) {
  if (r.kind === "centre") return [r.capacity != null ? `Up to ${r.capacity}` : null, r.fromPrice != null ? `from €${r.fromPrice}/hr` : null].filter(Boolean).join(" · ");
  return [r.ages, r.price != null && r.unit ? `€${r.price} / ${r.unit}` : null].filter(Boolean).join(" · ");
}

export function ListingsTab({
  vendorType,
  listings,
  onEditCentre,
  onEditClub,
  onNewCentre,
  onNewClub,
  reload,
}: {
  vendorType: VendorType | null;
  listings: { centres: VendorListingSummary[]; clubs: VendorListingSummary[] };
  onEditCentre: (id: string) => void;
  onEditClub: (id: string) => void;
  onNewCentre: () => void;
  onNewClub: () => void;
  reload: () => void;
}) {
  const confirm = useConfirm();
  const activeCentres = listings.centres.filter((c) => c.status !== "deleted");
  const activeClubs = listings.clubs.filter((c) => c.status !== "deleted");
  const [confirming, setConfirming] = useState<{ type: "centre" | "club"; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [typeFilter, setTypeFilter] = useUrlParam<"all" | Kind>("ltype", "all");
  const copyPublicLink = useCopyPublicLink();

  const confirmDelete = async () => {
    if (!confirming) return;
    setDeleting(true);
    try {
      if (confirming.type === "centre") await deleteVendorCentre(confirming.id);
      else await deleteVendorClub(confirming.id);
      reload();
    } finally {
      setDeleting(false);
      setConfirming(null);
    }
  };

  const togglePause = async (type: "centre" | "club", id: string) => {
    const rows = type === "centre" ? listings.centres : listings.clubs;
    const listing = rows.find((r) => r.id === id);
    if (!listing) return;
    const paused = listing.status === "paused";
    if (!paused) {
      const ok = await confirm({
        title: `Pause ${listing.name}?`,
        message: "It disappears from search and can't take new bookings until you resume it. Existing bookings aren't affected.",
        confirmLabel: "Pause listing",
      });
      if (!ok) return;
    }
    if (type === "centre") await (paused ? resumeVendorCentre(id) : pauseVendorCentre(id));
    else await (paused ? resumeVendorClub(id) : pauseVendorClub(id));
    reload();
  };

  const duplicate = async (type: "centre" | "club", id: string) => {
    if (type === "centre") {
      const clone = await duplicateVendorCentre(id);
      reload();
      onEditCentre(clone.id);
    } else {
      const clone = await duplicateVendorClub(id);
      reload();
      onEditClub(clone.id);
    }
  };

  const all: Row[] = [...activeCentres.map((c) => ({ ...c, kind: "centre" as const })), ...activeClubs.map((c) => ({ ...c, kind: "club" as const }))];
  const shown = typeFilter === "all" ? all : all.filter((r) => r.kind === typeFilter);
  const edit = (r: Row) => (r.kind === "centre" ? onEditCentre(r.id) : onEditClub(r.id));
  const live = (r: Row) => r.status === "approved" || r.status === "paused";

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {vendorType && <SetupChecklist vendorType={vendorType} listings={listings} />}
      {activeCentres.length > 0 && activeClubs.length > 0 && (
        <IconTabs
          label="Listing type"
          value={typeFilter}
          onChange={setTypeFilter}
          items={[
            { key: "all", label: "All", icon: LayoutList, count: all.length },
            { key: "centre", label: "Centres", icon: Building2, count: activeCentres.length },
            { key: "club", label: "Clubs", icon: Volleyball, count: activeClubs.length },
          ]}
        />
      )}
      {!VENUE_PAGES_PUBLIC && all.some(live) && <p className="adm-note" style={{ margin: 0 }}>{VENUE_NOT_PUBLIC_HELP}</p>}

      {all.length === 0 ? (
        <Box>
          <EmptyState
            icon={<Building2 size={20} />}
            title="No listings yet"
            subtitle="Add the centre or club people will book. It goes to HelloCircle for a quick review before it's live."
            action={
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                <AdminButton variant="primary" onClick={onNewCentre}>
                  Add centre
                </AdminButton>
                <AdminButton onClick={onNewClub}>Add club</AdminButton>
              </div>
            }
          />
        </Box>
      ) : (
        <div className="ws-cards">
          {shown.map((r) => {
            const Icon = r.kind === "centre" ? Building2 : Volleyball;
            const checks = profileChecks(r);
            const done = checks.filter(Boolean).length;
            const pct = Math.round((done / checks.length) * 100);
            return (
              <article key={`${r.kind}:${r.id}`} className="ws-card" aria-label={r.name}>
                <button type="button" className="btn-reset ws-card-cover" onClick={() => edit(r)} tabIndex={-1} aria-hidden="true">
                  {r.image ? <img src={getMediaUrl(r.image, "card")} alt="" /> : <Icon size={30} strokeWidth={1.6} />}
                </button>
                <div className="ws-card-body">
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <ListingStatusChip status={r.status} />
                    <span className="adm-chip">{r.kind === "centre" ? "Centre" : "Club"}</span>
                  </div>
                  <h2 className="ws-card-title">
                    <button type="button" className="btn-reset" onClick={() => edit(r)}>
                      {r.name}
                    </button>
                  </h2>
                  <div className="adm-note">{[`${r.area}, ${r.county}`, factsLine(r)].filter(Boolean).join(" · ")}</div>
                  <div className="ws-card-progress">
                    <span>Profile {pct}% complete</span>
                    <span className="adm-note">{checks.length - done ? `${checks.length - done} to do` : "All done"}</span>
                  </div>
                  <span className="ws-meter" aria-hidden="true">
                    <span style={{ width: `${pct}%` }} />
                  </span>
                  <div className="ws-card-stats">
                    <span>
                      <b>{r.bookingsCount}</b> {r.kind === "centre" ? "bookings" : "sign-ups"}
                    </span>
                    <span>
                      <b>{r.views}</b> views
                    </span>
                    <span>
                      <b>{r.reviews > 0 ? r.rating.toFixed(1) : "—"}</b> rating
                    </span>
                  </div>
                  <div className="ws-card-actions">
                    <AdminButton size="sm" variant="primary" onClick={() => edit(r)} aria-label={`${live(r) ? "Open" : "Finish setup for"} ${r.name}`}>
                      {live(r) ? "Open" : "Finish setup"}
                    </AdminButton>
                    {live(r) && VENUE_PAGES_PUBLIC && (
                      <AdminButton size="sm" onClick={() => window.open(r.kind === "centre" ? `/centres/${r.id}` : `/clubs/${r.id}`, "_blank")}>
                        View page
                      </AdminButton>
                    )}
                    <ActionMenu
                      label={`More actions for ${r.name}`}
                      buttonText=""
                      className="ws-icon-menu"
                      items={[
                        ...(live(r) && VENUE_PAGES_PUBLIC ? [{ label: "Copy public link", onSelect: () => copyPublicLink(r.kind, r.id) }] : []),
                        ...(live(r) ? [{ label: r.status === "paused" ? "Resume bookings" : "Pause bookings", onSelect: () => togglePause(r.kind, r.id) }] : []),
                        { label: "Duplicate", onSelect: () => duplicate(r.kind, r.id) },
                        { label: "Delete listing…", onSelect: () => setConfirming({ type: r.kind, id: r.id, name: r.name }), danger: true },
                      ]}
                    />
                  </div>
                </div>
              </article>
            );
          })}
          <div className="ws-card ws-card--add">
            <span className="adm-itile" aria-hidden="true">
              <Plus size={17} strokeWidth={1.9} />
            </span>
            <strong>Add another place</strong>
            <span className="adm-note">A second centre, or a club you run.</span>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <AdminButton size="sm" onClick={onNewCentre}>
                Add centre
              </AdminButton>
              <AdminButton size="sm" onClick={onNewClub}>
                Add club
              </AdminButton>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirming}
        title={`Delete ${confirming?.name ?? "this listing"}?`}
        message="This removes it from your dashboard and from public view. Existing bookings/registrations already made are unaffected."
        confirmLabel="Delete listing"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
