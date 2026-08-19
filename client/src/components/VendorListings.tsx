import { useState } from "react";
import { deleteVendorCentre, deleteVendorClub } from "../api";
import { BallIcon, BuildingIcon, CheckCircleIcon, EditIcon, EyeIcon, PinIcon, PlusIcon, StarIcon, TrashIcon } from "./icons";
import { Button, Card, ConfirmDialog, LinkButton, StatusBadge, tableStyle, tdStyle, thStyle } from "./ui";
import { colors, fonts } from "../theme";
import type { VendorListingSummary, VendorType } from "../types";

// The Listings tab (deliberately NOT a uniform CRUD list: for the common
// case — one listing of a given type — this renders a rich profile view of
// that listing instead of a table) plus the Overview tab's setup checklist
// — split out of the original single VendorDashboard.tsx (see CLAUDE.md).

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
      <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Finish setting up</h3>
      <p style={{ color: colors.mutedLight, fontSize: 12.5, margin: "0 0 4px" }}>A few steps left before your {noun} is fully live.</p>
      <ChecklistStep done={hasListing} label={`Add your first ${noun}`} />
      <ChecklistStep done={hasPhoto} label="Add a photo" />
      <ChecklistStep done={hasApproved} label="Get admin approval for your listing" />
    </Card>
  );
}

function ListingFactsStrip({ kind, listing }: { kind: "centre" | "club"; listing: VendorListingSummary }) {
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12.5, color: colors.mutedLight }}>
      {kind === "centre" ? (
        <>
          {listing.capacity != null && <span>Capacity {listing.capacity}</span>}
          {listing.fromPrice != null && <span>from €{listing.fromPrice}/hr</span>}
        </>
      ) : (
        <>
          {listing.ages && <span>{listing.ages}</span>}
          {listing.price != null && listing.unit && (
            <span>
              €{listing.price} / {listing.unit}
            </span>
          )}
        </>
      )}
    </span>
  );
}

function ListingProfileCard({
  kind,
  listing,
  onEdit,
  onDelete,
}: {
  kind: "centre" | "club";
  listing: VendorListingSummary;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const publicHref = kind === "centre" ? `/centres/${listing.id}` : `/clubs/${listing.id}`;
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap" }}>
        <div style={{ flex: "0 0 260px", minHeight: 200, background: colors.panel }}>
          {listing.image ? (
            <img src={listing.image} alt="" style={{ width: "100%", height: "100%", minHeight: 200, objectFit: "cover", display: "block" }} />
          ) : (
            <div style={{ width: "100%", height: "100%", minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center", color: colors.faint }}>
              {kind === "centre" ? <BuildingIcon size={32} /> : <BallIcon size={32} />}
            </div>
          )}
        </div>
        <div style={{ flex: "1 1 320px", padding: 24, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 19, margin: 0, letterSpacing: "-.01em" }}>{listing.name}</h3>
            <StatusBadge status={listing.status} />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 13, color: colors.mutedLight }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <PinIcon size={13} />
              {listing.area}, {listing.county}
            </span>
            {listing.reviews > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <StarIcon size={13} />
                {listing.rating.toFixed(1)} ({listing.reviews})
              </span>
            )}
          </div>
          <ListingFactsStrip kind={kind} listing={listing} />
          <p
            style={{
              fontSize: 13.5,
              color: listing.blurb ? colors.text : colors.faint,
              margin: 0,
              lineHeight: 1.5,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {listing.blurb || "No description yet — add one so families know what to expect."}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: "auto", paddingTop: 6 }}>
            <Button onClick={onEdit}>
              <EditIcon size={14} /> {listing.status === "approved" ? "Edit details" : "Finish setup"}
            </Button>
            {listing.status === "approved" ? (
              <LinkButton variant="ghost" href={publicHref} target="_blank">
                <EyeIcon size={14} /> View live listing
              </LinkButton>
            ) : (
              <span style={{ fontSize: 12.5, color: colors.faint }}>Preview available once approved</span>
            )}
            <Button variant="danger" onClick={onDelete} style={{ marginLeft: "auto" }}>
              <TrashIcon size={14} /> Delete
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ListingsTable({
  kind,
  rows,
  onEdit,
  onDelete,
}: {
  kind: "centre" | "club";
  rows: VendorListingSummary[];
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}></th>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Location</th>
            <th style={thStyle}>{kind === "centre" ? "Bookings" : "Registrations"}</th>
            <th style={thStyle}>Views</th>
            <th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ ...tdStyle, width: 44 }}>
                {r.image ? (
                  <img src={r.image} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover", display: "block" }} />
                ) : (
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: colors.panel }} />
                )}
              </td>
              <td style={tdStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700 }}>{r.name}</span>
                  <StatusBadge status={r.status} />
                </div>
              </td>
              <td style={tdStyle}>
                {r.area}, {r.county}
              </td>
              <td style={tdStyle}>{r.bookingsCount}</td>
              <td style={tdStyle}>{r.views}</td>
              <td style={{ ...tdStyle, textAlign: "right" }}>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <Button variant="ghost" onClick={() => onEdit(r.id)}>
                    <EditIcon size={13} />
                  </Button>
                  <Button variant="danger" onClick={() => onDelete(r.id, r.name)}>
                    <TrashIcon size={13} />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Renders only when there's at least one listing of this type — a type
// with zero listings gets no section at all (see ListingsTab's shared
// bottom action bar instead of a per-type empty-state placeholder).
function ListingSection({
  kind,
  title,
  addLabel,
  addButtonVariant,
  rows,
  onEdit,
  onNew,
  onDelete,
}: {
  kind: "centre" | "club";
  title: string;
  addLabel: string;
  addButtonVariant?: "primary" | "orange";
  rows: VendorListingSummary[];
  onEdit: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string, name: string) => void;
}) {
  if (rows.length === 1) {
    return (
      <div>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18, margin: "0 0 14px", letterSpacing: "-.01em" }}>{title}</h3>
        <ListingProfileCard kind={kind} listing={rows[0]} onEdit={() => onEdit(rows[0].id)} onDelete={() => onDelete(rows[0].id, rows[0].name)} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18, margin: 0, letterSpacing: "-.01em" }}>{title}</h3>
        <Button variant={addButtonVariant} onClick={onNew}>
          {addLabel}
        </Button>
      </div>
      <ListingsTable kind={kind} rows={rows} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
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
  const activeCentres = listings.centres.filter((c) => c.status !== "deleted");
  const activeClubs = listings.clubs.filter((c) => c.status !== "deleted");
  const [confirming, setConfirming] = useState<{ type: "centre" | "club"; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 30 }}>
      {vendorType && <SetupChecklist vendorType={vendorType} listings={listings} />}
      {activeCentres.length > 0 && (
        <ListingSection
          kind="centre"
          title="Community centres"
          addLabel="+ Add centre"
          rows={activeCentres}
          onEdit={onEditCentre}
          onNew={onNewCentre}
          onDelete={(id, name) => setConfirming({ type: "centre", id, name })}
        />
      )}

      {activeClubs.length > 0 && (
        <ListingSection
          kind="club"
          title="Sports clubs"
          addLabel="+ Add club"
          addButtonVariant="orange"
          rows={activeClubs}
          onEdit={onEditClub}
          onNew={onNewClub}
          onDelete={(id, name) => setConfirming({ type: "club", id, name })}
        />
      )}

      {/* Single shared "add a location" bar — covers both the true empty
          case (no listings of either type) and growing into a second type
          or another location of one you already have, rather than a
          separate empty-state placeholder per missing type. Plain inline
          text links, not full buttons — this is a rare, low-emphasis action. */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <span style={{ fontSize: 14, color: colors.mutedLight }}>Manage another location?</span>
        <button
          onClick={onNewCentre}
          className="link-accent"
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, color: colors.greenText, display: "inline-flex", alignItems: "center", gap: 4, padding: 0 }}
        >
          <PlusIcon size={13} /> Add centre
        </button>
        <button
          onClick={onNewClub}
          className="link-accent"
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, color: colors.orangeDark, display: "inline-flex", alignItems: "center", gap: 4, padding: 0 }}
        >
          <PlusIcon size={13} /> Add club
        </button>
      </div>

      <ConfirmDialog
        open={!!confirming}
        title={`Delete ${confirming?.name ?? "this listing"}?`}
        message="This removes it from your dashboard and from public view. Existing bookings/registrations already made are unaffected."
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
