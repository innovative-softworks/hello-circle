import type { VendorListingSummary } from "../../types";
import { VENUE_NOT_PUBLIC_LABEL, VENUE_PAGES_PUBLIC } from "../../venueLaunch";
import { DetailStats } from "./DetailParts";

// Status chip + type + place, under a listing editor's page title.
const LABELS: Record<string, { label: string; tone?: "good" | "warn" }> = {
  approved: { label: "Live", tone: "good" },
  pending: { label: "Pending review", tone: "warn" },
  rejected: { label: "Changes needed", tone: "warn" },
  draft: { label: "Draft" },
  paused: { label: "Paused" },
};

export function ListingMeta({ status, kind, place }: { status?: string; kind: string; place?: string }) {
  const chip = status === "approved" && !VENUE_PAGES_PUBLIC ? { label: VENUE_NOT_PUBLIC_LABEL, tone: "good" as const } : status ? LABELS[status] : undefined;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {chip && (
        <span className="adm-chip" data-tone={chip.tone}>
          {chip.label}
        </span>
      )}
      <span>{[kind, place].filter(Boolean).join(" · ")}</span>
    </span>
  );
}

/** A venue or club's key numbers above its editor tabs (from the partner's own
 * listings summary: all-time bookings and views, rating, listed price). */
export function ListingKeyNumbers({ summary, kind }: { summary: VendorListingSummary | undefined; kind: "centre" | "club" }) {
  const wait = summary === undefined;
  const price =
    kind === "centre"
      ? { label: "From", value: wait ? "…" : summary.fromPrice ? `€${summary.fromPrice}/hr` : "—", sub: summary?.capacity ? `Up to ${summary.capacity} people` : undefined }
      : { label: "Membership", value: wait ? "…" : summary.price ? `€${summary.price}` : "Free", sub: summary?.price && summary.unit ? `per ${summary.unit}` : summary?.ages ? `Ages ${summary.ages}` : undefined };
  return (
    <DetailStats
      items={[
        { label: kind === "club" ? "Registrations" : "Bookings", value: wait ? "…" : String(summary.bookingsCount), sub: "All time" },
        { label: "Page views", value: wait ? "…" : summary.views.toLocaleString("en-IE"), sub: "All time" },
        { label: "Rating", value: wait ? "…" : summary.rating ? `${summary.rating.toFixed(1)} ★` : "—", sub: wait ? undefined : summary.reviews ? `${summary.reviews} review${summary.reviews === 1 ? "" : "s"}` : "No reviews yet" },
        price,
      ]}
    />
  );
}
