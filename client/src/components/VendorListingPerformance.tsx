import { AwardIcon, CalendarIcon, EyeIcon, StarIcon } from "./icons";
import { ManageCard as Card, KpiHero, KpiStrip, StatTile } from "./ui";
import { colors } from "../theme";
import type { VendorListingSummary } from "../types";

// Host Manage spec §7's "Performance" per listing — re-renders fields
// already computed per-row by GET /vendor/listings (vendorListings.ts's
// bookingsCount/views/rating/reviews subqueries), the same summary row
// ListingsTab already fetches — no new endpoint, no time-series/trend data
// (none exists per listing; see Phase 8 for the one dashboard-wide trend
// that does exist).
export function VendorListingPerformance({ summary }: { summary: VendorListingSummary | undefined }) {
  if (!summary) return null;
  return (
    <Card>
      <KpiStrip
        marginBottom={0}
        hero={<KpiHero icon={<CalendarIcon size={19} />} value={summary.bookingsCount} label="Bookings" sublabel="All time" sublabelColor={colors.mutedLight} />}
      >
        <StatTile icon={<EyeIcon size={19} />} value={summary.views} label="Views" sublabel="All time" sublabelColor={colors.mutedLight} />
        <StatTile icon={<StarIcon size={19} />} value={summary.rating ? summary.rating.toFixed(1) : "—"} label="Rating" sublabel={`${summary.reviews} review${summary.reviews === 1 ? "" : "s"}`} sublabelColor={colors.mutedLight} />
        <StatTile icon={<AwardIcon size={19} />} value={summary.status === "approved" ? "Live" : summary.status} label="Status" sublabel="Current" sublabelColor={colors.mutedLight} />
      </KpiStrip>
    </Card>
  );
}
