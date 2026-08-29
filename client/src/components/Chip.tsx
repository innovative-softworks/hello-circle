import type { CSSProperties, ReactNode } from "react";
import { colors, radius as radiusTokens } from "../theme";

// Four chip/tag roles (cards/listings consistency pass, design-system doc
// §23) — deliberately not one component, since they mean different things:
//   - Chip (below): a FILTER — toggles an active/inactive selection state.
//   - AttributeChip: display-only metadata (skill level, category, age
//     group) — never interactive, never shows an "active" state.
//   - QuickIntentChip: starts a discovery query/navigation on tap (a mood
//     chip, a recent/popular search suggestion) — also never "active";
//     tapping it navigates or fills a field, it doesn't stay toggled on.
//   - The "status chip" role (spots left/full/waitlist/joined) is already
//     covered by `AvailabilityBadge` in ui.tsx — not duplicated here.
// AttributeChip/QuickIntentChip are new primitives only, not yet rolled
// out to any existing page — today's ad hoc metadata tags and suggestion
// chips across the app are a separate, later migration.

interface ChipProps {
  label: ReactNode;
  active: boolean;
  onClick: () => void;
  accent?: "green" | "orange";
  radius?: number;
  padding?: string;
  fontSize?: number;
  disabled?: boolean;
}

export function Chip({
  label,
  active,
  onClick,
  accent = "green",
  radius = 20,
  padding = "8px 15px",
  fontSize = 14,
  disabled = false,
}: ChipProps) {
  const accentColor = accent === "orange" ? colors.orange : colors.green;
  const style: CSSProperties = {
    border: `1.5px solid ${active ? accentColor : colors.borderStrong}`,
    background: active ? accentColor : colors.surface,
    color: active ? "#fff" : colors.textSoft,
    borderRadius: radius,
    padding,
    fontSize,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
  };
  return (
    <button style={style} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}

/** Display-only metadata tag — skill level, category, age range. Never
 * interactive, never an "active" state; quieter than a filter Chip so it
 * doesn't compete with a page's one real active-filter signal. */
export function AttributeChip({ label, accent = "neutral" }: { label: ReactNode; accent?: "neutral" | "green" | "orange" }) {
  const tone =
    accent === "green"
      ? { bg: colors.greenBg, fg: colors.greenText }
      : accent === "orange"
        ? { bg: colors.orangeBg, fg: colors.orangeDark }
        : { bg: colors.panel, fg: colors.muted };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        background: tone.bg,
        color: tone.fg,
        borderRadius: radiusTokens.pill,
        padding: "3px 10px",
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
}

/** Starts a discovery query or navigation on tap — a mood chip, a recent/
 * popular search suggestion. Distinct from a filter Chip: it has no
 * active/toggled state of its own, since tapping it acts immediately
 * (navigates, fills a search field) rather than staying selected. */
export function QuickIntentChip({ label, onClick }: { label: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: colors.panel,
        border: "none",
        borderRadius: radiusTokens.pill,
        padding: "8px 15px",
        fontSize: 14,
        fontWeight: 600,
        color: colors.text,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
