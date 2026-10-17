import { VENUE_NOT_PUBLIC_LABEL, VENUE_PAGES_PUBLIC } from "../../venueLaunch";

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
