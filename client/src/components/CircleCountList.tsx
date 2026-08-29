import { ArrowRightIcon } from "./icons";
import { colors, fonts } from "../theme";

// Shared numbered editorial list — used by "Around Ireland" (by county) on
// the Circles discovery page (§34). Generic enough to reuse anywhere a
// "label · count · arrow" rail is needed; deliberately not reused for "By
// Activity" (§33), which the spec explicitly wants as larger typographic
// tiles instead of a list.

export function CircleCountList({ items, unit, onSelect }: { items: { label: string; count: number }[]; unit: string; onSelect: (label: string) => void }) {
  return (
    <div>
      {items.map((item, i) => (
        <button
          key={item.label}
          onClick={() => onSelect(item.label)}
          style={{
            display: "flex", alignItems: "center", gap: 20, width: "100%", textAlign: "left", background: "none", border: "none",
            borderTop: `1px solid ${colors.border}`, padding: "16px 4px", cursor: "pointer",
          }}
        >
          <span style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 14, color: colors.faint, flex: "none", width: 24 }}>
            {String(i + 1).padStart(2, "0")}
          </span>
          <span style={{ flex: 1, fontFamily: fonts.display, fontWeight: 700, fontSize: 16, letterSpacing: "-.01em" }}>{item.label}</span>
          <span style={{ flex: "none", fontSize: 13, fontWeight: 700, color: colors.muted }}>
            {item.count} {unit}{item.count === 1 ? "" : "s"}
          </span>
          <ArrowRightIcon size={15} style={{ flex: "none", color: colors.faint }} />
        </button>
      ))}
    </div>
  );
}
