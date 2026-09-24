import { BallIcon, BuildingIcon, CalendarIcon, PinIcon, TreeIconSmall } from "./icons";
import { ManageCard as Card } from "./ui";
import { formatScheduleCount, formatScheduleWhen, SOURCE_TYPE_LABELS } from "../vendorSchedule";
import { colors, fonts } from "../theme";
import type { VendorScheduleItem } from "../types";

// Vendor Experience Polish — "Next Up" hero + "Upcoming" cards for
// VendorOverviewTab, built on GET /vendor/schedule-items so they work the
// same way regardless of which of the four listing types a vendor actually
// runs (a Centre-only vendor and a Program-only vendor both get a
// meaningful Next Up, not just the Centre-only "Today" card that used to be
// the only same-day summary here).

const SOURCE_TYPE_ICONS: Record<VendorScheduleItem["sourceType"], typeof BuildingIcon> = {
  centre: BuildingIcon,
  club: BallIcon,
  program: CalendarIcon,
  experience: TreeIconSmall,
};

export function SourceTypeBadge({ sourceType }: { sourceType: VendorScheduleItem["sourceType"] }) {
  const Icon = SOURCE_TYPE_ICONS[sourceType];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, letterSpacing: ".04em", color: colors.mutedLight, textTransform: "uppercase" }}>
      <Icon size={12} /> {SOURCE_TYPE_LABELS[sourceType]}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const cancelled = status === "cancelled";
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: cancelled ? colors.danger : colors.greenText,
        background: cancelled ? colors.dangerBg : colors.greenBg,
        borderRadius: 999,
        padding: "2px 8px",
        flex: "none",
        textTransform: "capitalize",
      }}
    >
      {status}
    </span>
  );
}

export function VendorNextUpHero({ item, onManage }: { item: VendorScheduleItem; onManage: () => void }) {
  const count = formatScheduleCount(item);
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: colors.mutedLight }}>NEXT UP</span>
        <StatusPill status={item.status} />
      </div>
      <div style={{ fontSize: 13, color: colors.muted, marginBottom: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <CalendarIcon size={13} /> {formatScheduleWhen(item.startDateTime)}
        </span>
        {item.spaceName && (
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", color: colors.mutedLight, textTransform: "uppercase" }}>{item.spaceName}</span>
        )}
      </div>
      <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 19, marginBottom: 4 }}>{item.title}</div>
      <div style={{ fontSize: 13, color: colors.muted, marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <SourceTypeBadge sourceType={item.sourceType} />
        <span>{item.listingName}</span>
        {item.location && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <PinIcon size={12} /> {item.location}
          </span>
        )}
      </div>
      {count && <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>{count}</div>}
      <button
        onClick={onManage}
        style={{ background: colors.green, color: "#fff", border: "none", borderRadius: 999, padding: "9px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
      >
        Manage →
      </button>
    </Card>
  );
}

export function VendorUpcomingList({ items, onManage }: { items: VendorScheduleItem[]; onManage: (item: VendorScheduleItem) => void }) {
  if (items.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((item) => {
        const count = formatScheduleCount(item);
        return (
          <Card key={item.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", cursor: "pointer" }} onClick={() => onManage(item)}>
            <div style={{ minWidth: 200 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 14 }}>{item.title}</span>
                <SourceTypeBadge sourceType={item.sourceType} />
              </div>
              <div style={{ fontSize: 12, color: colors.mutedLight }}>
                {formatScheduleWhen(item.startDateTime)} · {item.listingName}
                {item.spaceName ? ` — ${item.spaceName}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
              {count && <span style={{ fontSize: 12, color: colors.mutedLight }}>{count}</span>}
              <StatusPill status={item.status} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}
