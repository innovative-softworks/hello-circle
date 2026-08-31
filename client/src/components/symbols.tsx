import type { CSSProperties, ReactNode } from "react";
import { CheckIcon } from "./icons";
import { ParticipantStack } from "./ui";
import { colors, fonts } from "../theme";

// HelloCircle signature symbol language — a small, separate category from
// icons.tsx's 59 utility icons (Search/Filter/Calendar/etc., which stay
// untouched). These eight marks represent product concepts unique to
// HelloCircle (Experience, Circle, Open Plan, Match, repeat participation,
// meeting point, Adventure, Place) built on the CIRCLE as the core
// geometric primitive — open circle = space/opportunity, filled circle =
// person/participation, concentric circles = community, two circles
// converging = match. See CLAUDE.md-adjacent design brief for the full
// rationale; this file is Phase 1 (foundation) — the marks + the two
// components that consume them (EntityTypeLabel, ParticipationMeter).
// Deliberately NOT wired into any existing page yet (see plan) — that's
// the next pass, done alongside the Provider Profile rebuild that actually
// needs them.

interface MarkProps {
  size?: number;
  style?: CSSProperties;
  className?: string;
}

// Matches icons.tsx's own stroke() convention exactly, so a signature mark
// sitting next to a utility icon reads as the same visual family.
const strokeProps = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

/** ✦ Experience — a filled four-point spark built from straight edges
 * (not smooth concave curves), so it reads as a geometric/editorial mark
 * rather than the glowing "AI sparkle" glyph. Reserved for Experience
 * only — never reused for AI/magic/recommendation/"new" affordances. */
export function ExperienceMark({ size = 18, style, className }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style} className={className}>
      <path d="M12 2 14.2 9.8 22 12 14.2 14.2 12 22 9.8 14.2 2 12 9.8 9.8Z" />
    </svg>
  );
}

/** ◎ Circle — concentric circles: outer ring = community, inner filled
 * dot = participation. */
export function CircleMark({ size = 18, style, className }: MarkProps) {
  return (
    <svg {...strokeProps(size)} style={style} className={className}>
      <circle cx={12} cy={12} r={9} />
      <circle cx={12} cy={12} r={3} fill="currentColor" stroke="none" />
    </svg>
  );
}

/** ○+ Open Plan — an open circle (space available) plus a small plus
 * (you can join). */
export function OpenPlanMark({ size = 18, style, className }: MarkProps) {
  return (
    <svg {...strokeProps(size)} style={style} className={className}>
      <circle cx={9.5} cy={12.5} r={7} />
      <path d="M18 14v6M15 17h6" />
    </svg>
  );
}

/** Two circles converging — user intent matches a real opportunity.
 * Deliberately not a heart/wand/sparkle. */
export function MatchMark({ size = 18, style, className }: MarkProps) {
  return (
    <svg {...strokeProps(size)} style={style} className={className}>
      <circle cx={8.5} cy={12} r={6.5} />
      <circle cx={15.5} cy={12} r={6.5} />
    </svg>
  );
}

/** ↻ Do it again — a single circular return sweep with one arrowhead and
 * a filled start-dot, warmer and less "reload the page" than a two-arrow
 * refresh loop (see icons.tsx's RepeatIcon, kept separate — that one still
 * means recurring/repeating schedule, this one means "I did this before,
 * do it again"). */
export function RepeatParticipationMark({ size = 18, style, className }: MarkProps) {
  return (
    <svg {...strokeProps(size)} style={style} className={className}>
      <path d="M12 5a7 7 0 1 1 -6.2 3.8" />
      <path d="M4.3 6.2 5.6 9l2.9-.9" />
      <circle cx={12} cy={5} r={1.15} fill="currentColor" stroke="none" />
    </svg>
  );
}

/** × Meet here — an × inside a circle, distinct from CloseIcon's bare ×
 * (never used without its "MEET HERE" text pairing, per the accessibility
 * rule — this is a meeting point, not a dismiss/delete/error action). */
export function MeetingPointMark({ size = 18, style, className }: MarkProps) {
  return (
    <svg {...strokeProps(size)} style={style} className={className}>
      <circle cx={12} cy={12} r={8} />
      <path d="M9.2 9.2 14.8 14.8M14.8 9.2 9.2 14.8" />
    </svg>
  );
}

/** ↗ Adventure — a diagonal "go somewhere" arrow. Distinct from the
 * existing straight ArrowRightIcon (icons.tsx) by geometry, not just
 * rotation, so the two don't get confused sitting side by side. */
export function AdventureMark({ size = 18, style, className }: MarkProps) {
  return (
    <svg {...strokeProps(size)} style={style} className={className}>
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}

/** ▣ Place — a bookable physical space: an outer boundary with a smaller
 * filled room inside, distinct from BuildingIcon's building silhouette. */
export function PlaceMark({ size = 18, style, className }: MarkProps) {
  return (
    <svg {...strokeProps(size)} style={style} className={className}>
      <rect x={4} y={4} width={16} height={16} rx={2} />
      <rect x={9.5} y={9.5} width={5} height={5} rx={1} fill="currentColor" stroke="none" />
    </svg>
  );
}

// --- EntityTypeLabel -------------------------------------------------------
// Consolidates what DiscoverRow.tsx's KIND_META and ProviderProfile.tsx's
// GROUPS array each reinvented independently (icon + label per entity
// type) into one component — not yet wired into either of those two call
// sites (that's the next pass, alongside the Provider Profile rebuild).
// Deliberately monochrome by default (colors.text), never a per-type
// rainbow hue — color stays reserved for urgency/success elsewhere in the
// app, not entity identity.

export type EntityKind = "experience" | "circle" | "open-plan" | "adventure" | "place";

const ENTITY_META: Record<EntityKind, { Mark: (p: MarkProps) => ReactNode; label: string }> = {
  experience: { Mark: ExperienceMark, label: "Experience" },
  circle: { Mark: CircleMark, label: "Circle" },
  "open-plan": { Mark: OpenPlanMark, label: "Open Plan" },
  adventure: { Mark: AdventureMark, label: "Adventure" },
  place: { Mark: PlaceMark, label: "Place" },
};

export function EntityTypeLabel({
  type,
  size = 14,
  showLabel = true,
  color = colors.text,
  style,
}: {
  type: EntityKind;
  size?: number;
  /** false for compact contexts (e.g. a dense table row) — the mark still
   * carries an aria-label in that case, per the "never symbol-only"
   * accessibility rule. */
  showLabel?: boolean;
  color?: string;
  style?: CSSProperties;
}) {
  const { Mark, label } = ENTITY_META[type];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color, ...style }}>
      <Mark size={size} {...(showLabel ? { "aria-hidden": "true" } : { role: "img", "aria-label": label })} />
      {showLabel && (
        <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: size - 2, letterSpacing: ".04em", textTransform: "uppercase" }}>
          {label}
        </span>
      )}
    </span>
  );
}

// --- ParticipationMeter ------------------------------------------------
// The "●●●●○○ 4 IN · 2 MORE WELCOME" signature — small capacity renders
// dots + real language; large capacity (or when real people are supplied)
// delegates to the existing ParticipantStack (ui.tsx) rather than
// rendering dozens of dots. Additive only in this pass — no existing
// AvailabilityBadge call site is switched to this yet.

const DOT_THRESHOLD = 8;

export function ParticipationMeter({
  capacity,
  joinedCount,
  currentUserJoined = false,
  waitlisted = false,
  people,
}: {
  /** null for an uncapped group (e.g. a Circle has no capacity concept). */
  capacity: number | null;
  joinedCount: number;
  currentUserJoined?: boolean;
  waitlisted?: boolean;
  /** Real participant names, if available — when present, always renders
   * the avatar-stack form regardless of capacity size. */
  people?: { id: string; name: string; title?: string }[];
}) {
  if (waitlisted) {
    return <span style={{ fontSize: 12.5, fontWeight: 700, color: colors.orangeDark }}>WAITLIST OPEN</span>;
  }

  const full = capacity !== null && joinedCount >= capacity;
  const remaining = capacity !== null ? Math.max(0, capacity - joinedCount) : null;

  const useAvatarStack = !!people || capacity === null || capacity > DOT_THRESHOLD;
  if (useAvatarStack) {
    const shown = people?.slice(0, 5) ?? [];
    const overflow = people ? Math.max(0, joinedCount - shown.length) : 0;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
        {people && <ParticipantStack people={shown} overflow={overflow} size={26} />}
        <span style={{ fontSize: 12.5, fontWeight: 700, color: colors.mutedLight }}>
          {full ? "FULL" : capacity !== null ? `${joinedCount} / ${capacity} JOINED` : `${joinedCount} JOINED`}
        </span>
      </span>
    );
  }

  const dots = Array.from({ length: capacity ?? 0 }, (_, i) => i < joinedCount);
  const label = full
    ? "FULL"
    : currentUserJoined
      ? `${joinedCount} IN · YOU'RE IN`
      : remaining === 1
        ? "1 SPOT LEFT"
        : `${joinedCount} IN · ${remaining} MORE WELCOME`;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <span style={{ display: "inline-flex", gap: 4 }} aria-hidden="true">
        {dots.map((filled, i) => (
          <svg key={i} width={10} height={10} viewBox="0 0 10 10">
            <circle cx={5} cy={5} r={4} fill={filled ? colors.green : "none"} stroke={filled ? "none" : colors.borderStrong} strokeWidth={1.5} />
          </svg>
        ))}
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: full ? colors.mutedLight : colors.text }}>{label}</span>
      {currentUserJoined && !full && <CheckIcon size={13} style={{ color: colors.greenText }} />}
    </span>
  );
}
