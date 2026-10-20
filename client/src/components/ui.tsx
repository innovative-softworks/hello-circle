import { BrandLogo } from "./BrandLogo";
import { Fragment, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { CheckIcon, CloseIcon, StarIcon } from "./icons";
import { getMediaUrl } from "../media";
import { navigateWithSharedImage } from "../sharedElementTransition";
import { colors, fonts, maxWidth, radius, zIndex } from "../theme";
import { useInWorkspace } from "./workspace/inWorkspace";
import { detailIcon } from "./workspace/detailIcons";

// Shared, reusable building blocks for the vendor/admin/reviews UI — kept in
// one place so button/card/badge styling can't drift between dashboards.

export type ListingStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "suspended"
  | "paused"
  | "deleted"
  // Universal Publishing, Lifecycle & Availability System — the per-entity
  // publishing lifecycle (server/src/lifecycle.ts) reuses this same shared
  // badge system rather than a second one (§33), even though it's a
  // conceptually different dimension from the vendor/admin moderation
  // values above it (draft/paused happen to already exist here and are
  // reused as-is for both meanings — the label/color for "draft" already
  // reads correctly either way).
  | "coming_soon"
  | "active"
  | "completed"
  | "cancelled"
  | "archived";

// --- Keyboard-accessible non-navigation clickables (post-audit hardening
// pass) --------------------------------------------------------------------
// A handful of pages have a plain `<div onClick={...}>` that toggles/expands
// something (not a navigation — those should be a real `<Link>`/`<a>`
// instead) and were only mouse-clickable. Spread this onto the element to
// make it a real, keyboard-operable button-role region without changing its
// visual styling.
export function onActivateProps(handler: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: handler,
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handler();
      }
    },
  };
}

// SEO Phase 5 — the "stretched link" pattern (see the .stretched-link/
// .stretched-link-above rules in index.css): a real <a href> covering an
// entire discovery card, so a crawler can actually reach /centres/:id,
// /clubs/:id, etc. through the page's own link graph rather than only via
// the sitemap. Card components render this as their *first* child inside a
// `position: relative` container, then give every nested interactive
// element (Save button, CTA button, …) the `stretched-link-above` class so
// it keeps receiving its own clicks instead of the whole card just
// navigating. `label` is required (not optional) because the link usually
// has no visible text content of its own — screen readers need a real
// accessible name, not "View" repeated for every card on the page.
export function CardLink({ to, label, sharedImage }: { to: string; label: string; sharedImage?: boolean }) {
  const navigate = useNavigate();
  return (
    <Link
      to={to}
      className="stretched-link"
      aria-label={label}
      onClick={
        sharedImage
          ? (e) => {
              if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              const source = e.currentTarget.parentElement?.querySelector("img")?.parentElement;
              if (!source) return;
              e.preventDefault();
              navigateWithSharedImage(navigate, to, source);
            }
          : undefined
      }
    />
  );
}

// --- Button ------------------------------------------------------------

type ButtonVariant = "primary" | "orange" | "dark" | "ghost" | "danger";

// Design-system consistency pass: pill buttons; primary = brand orange with
// forest text (white on #ff4b24 fails contrast), dark = forest night.
export const buttonBase: CSSProperties = {
  borderRadius: radius.pill,
  fontWeight: 700,
  fontSize: 14,
  padding: "10px 16px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
};

export const buttonVariants: Record<ButtonVariant, CSSProperties> = {
  primary: { background: colors.green, color: "#fff", border: "none" },
  orange: { background: colors.orange, color: "#fff", border: "none" },
  dark: { background: colors.dark, color: "#fff", border: "none" },
  ghost: { background: colors.surface, color: colors.text, border: `1px solid ${colors.borderStrong}` },
  danger: { background: "none", color: colors.danger, border: "none", padding: "6px 6px", fontWeight: 600, fontSize: 13 },
};

const variantClass: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  orange: "btn-orange",
  dark: "btn-dark",
  ghost: "btn-ghost",
  danger: "btn-danger",
};

export function Button({
  variant = "primary",
  disabled,
  onClick,
  children,
  style,
  type = "button",
  full,
  ...aria
}: {
  variant?: ButtonVariant;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  style?: CSSProperties;
  type?: "button" | "submit";
  full?: boolean;
} & Pick<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "aria-describedby" | "aria-busy" | "aria-expanded" | "aria-controls" | "aria-pressed">) {
  // aria-* used to be accepted by JSX but silently dropped here (2026-10-14).
  return (
    <button
      {...aria}
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`btn ${variantClass[variant]}`}
      style={{
        ...buttonBase,
        ...buttonVariants[variant],
        width: full ? "100%" : undefined,
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

// --- LinkButton ------------------------------------------------------------
// Same visual/hover styling as Button (shares its base styles + the .btn/
// .btn-* CSS classes that drive the hover lift/shadow), but renders an <a>
// — for actions that navigate (e.g. "View live listing" opening the public
// page in a new tab) rather than firing a click handler.

export function LinkButton({
  variant = "primary",
  href,
  target,
  children,
  style,
}: {
  variant?: ButtonVariant;
  href: string;
  target?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <a
      href={href}
      target={target}
      rel={target === "_blank" ? "noopener noreferrer" : undefined}
      className={`btn ${variantClass[variant]}`}
      style={{
        ...buttonBase,
        ...buttonVariants[variant],
        textDecoration: "none",
        ...style,
      }}
    >
      {children}
    </a>
  );
}

// Same shared button visual/hover system as Button/LinkButton (SEO Phase 5/7
// consistency pass), but for a same-app route — renders react-router's
// <Link> so it stays a client-side SPA navigation (no full reload), unlike
// LinkButton's plain <a> (which is deliberately a real page navigation, e.g.
// opening a live listing in a new tab). Reach for this whenever a link needs
// to *look* like a Button but must navigate to an in-app route.
export function RouteLinkButton({
  variant = "primary",
  to,
  children,
  style,
}: {
  variant?: ButtonVariant;
  to: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <Link to={to} className={`btn ${variantClass[variant]}`} style={{ ...buttonBase, ...buttonVariants[variant], textDecoration: "none", ...style }}>
      {children}
    </Link>
  );
}

// --- Card ----------------------------------------------------------------

export function Card({
  children,
  hover,
  style,
  onClick,
}: {
  children: ReactNode;
  hover?: boolean;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`card-surface ${hover ? "card-hover" : ""}`}
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.card,
        padding: 20,
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Vendor/Admin-only `Card` variant — same primitive, `--radius-manage-card`'s
 * sharper 2px corners (Home.tsx's already-shipped editorial language)
 * instead of the general 16px scale, per the dashboard redesign pass.
 * `Card` itself is left untouched: it's shared by ~40 other, non-dashboard
 * files across the app, so changing its own radius would have restyled
 * every listing/browse/circle page too, not just Vendor/Admin. Dashboard
 * files import this aliased as `Card` so no call site needs to change. */
export function ManageCard({ children, hover, style, onClick }: { children: ReactNode; hover?: boolean; style?: CSSProperties; onClick?: () => void }) {
  return (
    <Card hover={hover} onClick={onClick} style={{ borderRadius: "var(--radius-manage-card)", ...style }}>
      {children}
    </Card>
  );
}

// --- StatusBadge -----------------------------------------------------------

const statusStyles: Record<ListingStatus, { bg: string; fg: string; label: string }> = {
  draft: { bg: colors.panel, fg: colors.muted, label: "Draft" },
  pending: { bg: "#FCEDE4", fg: colors.orangeDark, label: "Pending review" },
  approved: { bg: colors.greenBg, fg: colors.greenText, label: "Live" },
  rejected: { bg: colors.dangerBg, fg: colors.danger, label: "Rejected" },
  suspended: { bg: colors.dangerBg, fg: colors.danger, label: "Suspended" },
  paused: { bg: colors.panel, fg: colors.orangeDark, label: "Paused" },
  deleted: { bg: colors.panel, fg: colors.muted, label: "Deleted" },
  // Publishing/Lifecycle system additions — same token palette as above,
  // no new colors (§33/§72). "active" reuses the same look as "approved"
  // ("Live") since both mean the same thing to a viewer; kept as a
  // separate key only because the two moderation/lifecycle vocabularies
  // are conceptually distinct even where their visual treatment matches.
  coming_soon: { bg: "#FCEDE4", fg: colors.orangeDark, label: "Coming soon" },
  active: { bg: colors.greenBg, fg: colors.greenText, label: "Live" },
  completed: { bg: colors.panel, fg: colors.muted, label: "Completed" },
  cancelled: { bg: colors.dangerBg, fg: colors.danger, label: "Cancelled" },
  archived: { bg: colors.panel, fg: colors.muted, label: "Archived" },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const base = statusStyles[status as ListingStatus] ?? statusStyles.deleted;
  const s = label ? { ...base, label } : base;
  return (
    <span
      className={status === "pending" ? "badge-dot-pending" : undefined}
      style={{
        background: s.bg,
        color: s.fg,
        borderRadius: radius.card,
        padding: "3px 11px",
        fontSize: 12,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        letterSpacing: 0,
      }}
    >
      {s.label}
    </span>
  );
}

// --- AvailabilityBadge (signature participation-status language) -----------
// The "spots left / full / waitlist / joined" status was independently
// reimplemented with different colors and different urgency thresholds
// across CentreDetail.tsx (plain muted text, no color coding),
// ProgramDetail.tsx (danger/greenText + icon), and ExperienceDetail.tsx
// (which used two different colors for the identical "Full" state in one
// file). One state→color mapping here; callers still compose their own
// label text, since "N spots left" vs "N players needed" is a real per-
// domain wording difference, not something to force into one string.

export type AvailabilityState = "open" | "urgent" | "full" | "waitlist" | "joined";

// urgent/waitlist use `logoMarkText` (a WCAG-safe derivative of the logo
// mark's own brand orange, #ee4826 — see theme.ts's own comment) rather
// than the general `orangeDark` UI accent, so the app's single most
// urgency-charged state visually ties back to the logo's brand color.
const availabilityStyles: Record<AvailabilityState, { bg: string; fg: string }> = {
  open: { bg: colors.greenBg, fg: colors.greenText },
  urgent: { bg: colors.orangeBg, fg: colors.logoMarkText },
  full: { bg: colors.panel, fg: colors.muted },
  waitlist: { bg: colors.orangeBg, fg: colors.logoMarkText },
  joined: { bg: colors.greenBg, fg: colors.greenText },
};

/** Derives open/urgent/full from a raw spots-left count so every call site
 * agrees on the same urgency threshold instead of picking its own ≤1/≤2/≤3
 * cutoff by feel. */
export function availabilityFromSpots(spotsLeft: number, urgentAt = 2): AvailabilityState {
  if (spotsLeft <= 0) return "full";
  if (spotsLeft <= urgentAt) return "urgent";
  return "open";
}

export function AvailabilityBadge({ state, children, style }: { state: AvailabilityState; children: ReactNode; style?: CSSProperties }) {
  const s = availabilityStyles[state];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: s.bg,
        color: s.fg,
        borderRadius: radius.pill,
        padding: "3px 11px",
        fontSize: 12.5,
        fontWeight: 700,
        letterSpacing: 0,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// --- ProgressBar (Host Experience Polish) -----------------------------------
// A simple horizontal fill for "N of capacity booked" — no such component
// existed before this (capacity was always rendered as plain text/a badge
// elsewhere, see GameJoinCard.tsx etc.). Reuses availabilityFromSpots()'s
// existing urgency thresholds for fill color rather than picking new ones.

export function ProgressBar({ occupied, capacity, style }: { occupied: number; capacity: number; style?: CSSProperties }) {
  const spotsLeft = Math.max(0, capacity - occupied);
  const pct = capacity > 0 ? Math.min(100, Math.round((occupied / capacity) * 100)) : 0;
  const state = availabilityFromSpots(spotsLeft);
  const fill = state === "full" ? colors.muted : state === "urgent" ? colors.logoMarkText : colors.green;
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{ height: 6, borderRadius: radius.pill, background: colors.panel, overflow: "hidden", ...style }}
    >
      <div style={{ height: "100%", width: `${pct}%`, background: fill, borderRadius: radius.pill, transition: "width .2s ease" }} />
    </div>
  );
}

// --- Avatar (initials, deterministic colour from the name) -----------------

const AVATAR_PALETTE = [colors.green, colors.orange, "#4C6FE7", "#B8548C", "#2E9B9B", colors.gold];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function Avatar({ name, size = 32, src }: { name: string; size?: number; src?: string | null }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  const bg = AVATAR_PALETTE[hashString(name) % AVATAR_PALETTE.length];
  const [broken, setBroken] = useState(false);
  const resolvedSrc = src ? getMediaUrl(src, "avatar") : null;
  if (resolvedSrc && !broken) {
    return (
      <img
        src={resolvedSrc}
        alt={name}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flex: "none" }}
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: size * 0.38,
        flex: "none",
        fontFamily: fonts.display,
      }}
    >
      {initials}
    </div>
  );
}

// --- ParticipantStack (signature HelloCircle element) -----------------------
// Overlapping avatars for "who's going" / "members" — was hand-duplicated in
// GameParticipants.tsx and CircleMembersCard.tsx (identical -10px overlap,
// 2px surface-colored ring, "+N" overflow circle); now one shared primitive
// so the visual language can't drift between the two call sites.

export function ParticipantStack({
  people,
  overflow = 0,
  size = 34,
  expanded = false,
}: {
  people: { id: string; name: string; title?: string }[];
  /** Count of additional participants beyond `people`, shown as a "+N" tile. */
  overflow?: number;
  size?: number;
  /** Lays avatars out with a gap instead of overlapping — for an expanded
   * "see all" view where every name should be individually legible. */
  expanded?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: expanded ? "wrap" : "nowrap", gap: expanded ? 8 : 0 }}>
      {people.map((p, i) => (
        <div
          key={p.id}
          title={p.title ?? p.name}
          style={{ marginLeft: expanded || i === 0 ? 0 : -10, border: `2px solid ${colors.surface}`, borderRadius: "50%" }}
        >
          <Avatar name={p.name} size={size} />
        </div>
      ))}
      {overflow > 0 && (
        <div
          style={{
            marginLeft: expanded ? 0 : -10,
            width: size,
            height: size,
            borderRadius: "50%",
            border: `2px solid ${colors.surface}`,
            background: colors.panel,
            color: colors.muted,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: size * 0.34,
            fontWeight: 700,
            flex: "none",
          }}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}

// --- Loading placeholders ---------------------------------------------------
// .skeleton/.spinner (index.css) do the shimmer/spin animation — these just
// size and lay them out. Skeleton shapes are sized to match the real content
// they stand in for, so the page doesn't jump when data arrives.

export function Spinner({ size = 26, style }: { size?: number; style?: CSSProperties }) {
  return <span className="spinner" style={{ width: size, height: size, ...style }} />;
}

/** Centered spinner for a whole-page gate (auth check, multi-step flow's
 * initial fetch) — where the wait is normally brief and building a layout
 * skeleton isn't worth it. */
export function PageSpinner() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "140px 24px" }}>
      <Spinner size={32} />
    </div>
  );
}

export function Skeleton({
  width = "100%",
  height = 16,
  radius = 8,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: CSSProperties;
}) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius, flex: "none", ...style }} />;
}

/** Stands in for CentreCard/ClubCard while a listing grid loads. */
export function CardSkeleton({ photoHeight = 140 }: { photoHeight?: number }) {
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, overflow: "hidden" }}>
      <Skeleton height={photoHeight} radius={0} />
      <div style={{ padding: "16px 18px 18px" }}>
        <Skeleton width={90} height={13} style={{ marginBottom: 12 }} />
        <Skeleton width="80%" height={17} style={{ marginBottom: 8 }} />
        <Skeleton width="55%" height={14} />
      </div>
    </div>
  );
}

/** Stands in for CentreDetail/ClubDetail's gallery + two-column layout while
 * the listing loads — shared since both pages have the same shape. */
export function ListingDetailSkeleton() {
  return (
    <div>
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "26px 24px 0" }}>
        <Skeleton width={160} height={14} style={{ marginBottom: 16 }} />
        <Skeleton height={380} radius={20} />
      </section>
      <section
        className="grid-responsive section-pad"
        style={{ maxWidth, margin: "0 auto", padding: "26px 24px 70px", display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 40, alignItems: "start" }}
      >
        <div>
          <Skeleton width={160} height={14} style={{ marginBottom: 14 }} />
          <Skeleton width="70%" height={32} style={{ marginBottom: 10 }} />
          <Skeleton width="45%" height={16} style={{ marginBottom: 26 }} />
          <Skeleton height={14} style={{ marginBottom: 8 }} />
          <Skeleton height={14} style={{ marginBottom: 8 }} />
          <Skeleton width="80%" height={14} />
        </div>
        <div style={{ border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: 22 }}>
          <Skeleton width={100} height={13} style={{ marginBottom: 10 }} />
          <Skeleton width={120} height={30} style={{ marginBottom: 20 }} />
          <Skeleton height={46} radius={12} />
        </div>
      </section>
    </div>
  );
}

/** Stands in for a MyBookings row while bookings/registrations load. */
export function RowSkeleton() {
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px", display: "flex", alignItems: "center", gap: 18 }}>
      <Skeleton width={52} height={52} radius={12} />
      <div style={{ flex: 1 }}>
        <Skeleton width="40%" height={16} style={{ marginBottom: 8 }} />
        <Skeleton width="60%" height={13} />
      </div>
      <Skeleton width={60} height={16} />
    </div>
  );
}

// --- EmptyState --------------------------------------------------------

/** A failed load — never shown as a legitimate empty result (HC-QA-063/064).
 * Announced (role=alert), with a retry that re-runs the caller's loader. */
export function LoadErrorState({ title, detail, onRetry, retryLabel = "Try again" }: { title: string; detail?: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "28px 24px", textAlign: "center" }}>
      <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 14, color: colors.mutedLight, marginBottom: onRetry ? 16 : 0 }}>{detail ?? "Check your connection and try again."}</div>
      {onRetry && <Button variant="ghost" onClick={onRetry}>{retryLabel}</Button>}
    </div>
  );
}

/** HC-QA-073 — "Load more" for server-paginated lists: idle → loading →
 * end (caller hides it) / error with retry. Already-loaded items are never
 * replaced; only this control reports the failure. */
export function LoadMoreControl({ loadingMore, failed, onLoadMore, label = "Load more" }: { loadingMore: boolean; failed: boolean; onLoadMore: () => void; label?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      {failed && (
        <div role="alert" style={{ fontSize: 13, color: colors.danger, fontWeight: 600 }}>
          Couldn't load more — check your connection and try again.
        </div>
      )}
      <Button variant="ghost" onClick={onLoadMore} disabled={loadingMore} aria-busy={loadingMore || undefined}>
        {loadingMore ? "Loading more…" : failed ? "Try again" : label}
      </Button>
    </div>
  );
}

export function EmptyState({ icon, title, subtitle, action }: { icon: ReactNode; title: string; subtitle?: string; action?: ReactNode }) {
  // Workspaces (admin / partner / host): no dashed frame, icon in a tile.
  if (useInWorkspace())
    return (
      <div className="ws-empty">
        <span className="ws-empty-icon" aria-hidden="true">
          {icon}
        </span>
        <div className="ws-empty-title">{title}</div>
        {subtitle && <div className="ws-empty-sub">{subtitle}</div>}
        {action && <div style={{ marginTop: 14 }}>{action}</div>}
      </div>
    );
  return (
    <div
      style={{
        border: `1.5px dashed ${colors.border}`,
        borderRadius: radius.card,
        padding: "36px 20px",
        textAlign: "center",
        color: colors.mutedLight,
      }}
    >
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 10, color: colors.faint }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 14, color: colors.muted, marginBottom: subtitle ? 4 : 0 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13 }}>{subtitle}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

/** A category icon in a soft circle with a small checkmark badge overlapping
 * the corner — used for "all done / nothing waiting on you" empty states. */
export function BadgedIcon({ icon, accent }: { icon: ReactNode; accent: "green" | "orange" }) {
  const bg = accent === "green" ? colors.greenBg : colors.orangeBg;
  const fg = accent === "green" ? colors.green : colors.orange;
  return (
    <div style={{ position: "relative", width: 56, height: 56 }}>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: bg,
          color: fg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: -2,
          right: -2,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: fg,
          border: "2px solid #fff",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CheckIcon size={11} />
      </div>
    </div>
  );
}

// --- Star rating (interactive picker + read-only display) ------------------

export function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const shown = hovered ?? value;
  return (
    <div style={{ display: "flex", gap: 3 }} onMouseLeave={() => setHovered(null)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className="star-pick"
          onMouseEnter={() => setHovered(n)}
          onClick={() => onChange(n)}
          style={{ color: n <= shown ? colors.gold : colors.border, lineHeight: 0, cursor: "pointer" }}
        >
          <StarIcon size={22} />
        </span>
      ))}
    </div>
  );
}

export function StarDisplay({ rating, size = 13 }: { rating: number; size?: number }) {
  const rounded = Math.round(rating);
  return (
    <span style={{ display: "inline-flex", gap: 1, verticalAlign: "middle" }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon key={n} size={size} style={{ color: n <= rounded ? colors.gold : colors.border }} />
      ))}
    </span>
  );
}

// --- Tabs ------------------------------------------------------------------

export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string; icon?: ReactNode }[];
}) {
  // Workspaces: the admin's underline tabs (same buttons, same behaviour).
  if (useInWorkspace())
    return (
      <div className="adm-itabs ws-tabs">
        {options.map((o) => (
          <button key={o.key} type="button" aria-pressed={o.key === value} onClick={() => onChange(o.key)}>
            {o.icon && <span style={{ display: "flex" }}>{o.icon}</span>}
            {o.label}
          </button>
        ))}
      </div>
    );
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            className={`tab-btn ${active ? "tab-btn-active" : ""}`}
            style={{
              ...buttonBase,
              background: active ? colors.dark : colors.surface,
              color: active ? "#fff" : colors.text,
              border: active ? "none" : `1px solid ${colors.borderStrong}`,
              padding: "9px 16px",
            }}
          >
            {o.icon && <span style={{ display: "flex" }}>{o.icon}</span>}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Same look as `Tabs`, but a real WAI-ARIA tablist: roving tabindex, arrow
 * keys / Home / End move and select, each tab names its panel. Use with
 * `TabPanel` when the options switch content in place (not a filter). On a
 * narrow screen the row scrolls instead of wrapping into a ragged stack. */
export function SectionTabs<T extends string>({
  value,
  onChange,
  options,
  label,
  idBase,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string }[];
  label: string;
  idBase: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const inWorkspace = useInWorkspace();
  const move = (e: ReactKeyboardEvent, index: number) => {
    const last = options.length - 1;
    const next = e.key === "ArrowRight" ? (index === last ? 0 : index + 1) : e.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) return;
    e.preventDefault();
    const key = options[next].key;
    onChange(key);
    refs.current[key]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={inWorkspace ? "adm-itabs ws-tabs" : "section-tabs"} style={inWorkspace ? undefined : { display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
      {options.map((o, i) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            ref={(el) => {
              refs.current[o.key] = el;
            }}
            type="button"
            role="tab"
            id={`${idBase}-tab-${o.key}`}
            aria-selected={active}
            aria-controls={`${idBase}-panel-${o.key}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.key)}
            onKeyDown={(e) => move(e, i)}
            className={inWorkspace ? undefined : `tab-btn ${active ? "tab-btn-active" : ""}`}
            style={inWorkspace ? undefined : {
              ...buttonBase,
              flex: "0 0 auto",
              minHeight: 44,
              background: active ? colors.dark : colors.surface,
              color: active ? "#fff" : colors.text,
              border: active ? "none" : `1px solid ${colors.borderStrong}`,
              padding: "9px 16px",
              whiteSpace: "nowrap",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** `bare` keeps the same element (so children don't remount) but drops the
 * tabpanel semantics while there's no tablist to label it. */
export function TabPanel({ idBase, tab, bare, children }: { idBase: string; tab: string; bare?: boolean; children: ReactNode }) {
  if (bare) return <div>{children}</div>;
  return (
    <div role="tabpanel" id={`${idBase}-panel-${tab}`} aria-labelledby={`${idBase}-tab-${tab}`}>
      {children}
    </div>
  );
}

// --- DashboardTopPanel (heading + illustration + tabs, one shared colored
// panel — deliberately identical structure/spacing for vendor and admin) ---

const DASHBOARD_ILLUSTRATION_SIZE = { width: 340, height: 190 };

export function DashboardTopPanel<T extends string>({
  title,
  subtitle,
  avatarName,
  illustration,
  accent,
  tabs,
  activeTab,
  onTabChange,
  bottomSpacing = 32,
  hideTabs = false,
  badge,
  eyebrow,
  actions,
}: {
  title: string;
  subtitle: string;
  avatarName: string;
  illustration?: ReactNode;
  accent: "green" | "orange";
  tabs: { key: T; label: string; icon?: ReactNode }[];
  activeTab: T;
  onTabChange: (v: T) => void;
  bottomSpacing?: number;
  /** Skips rendering the tab row inside this panel — for callers whose tab
   * count has outgrown a horizontal row and use a NavSidebar instead,
   * opened from the burger button in Header.tsx (see DashboardNavContext). */
  hideTabs?: boolean;
  /** Optional pill(s) rendered under the title/subtitle, e.g. a verified /
   * member-since badge. */
  badge?: ReactNode;
  /** Small "/ Vendor" / "/ Admin" label above the title — the dashboards'
   * one recurring eyebrow motif (see NavRail's own use of the same "/"
   * mark), sized as a label, not a second headline. */
  eyebrow?: string;
  /** Right-aligned quick-action cluster, opposite the avatar/title block —
   * e.g. a "View public profile" CTA. Mutually exclusive with `illustration`
   * in practice (no current caller uses both together); a future caller
   * needing both would need a real 3-column layout instead of this. */
  actions?: ReactNode;
}) {
  const isGreen = accent === "green";
  const blob = isGreen ? "rgba(30,122,76,.14)" : "rgba(232,98,42,.14)";
  const rightSlot = illustration ? "illustration" : actions ? "actions" : null;

  return (
    <div style={{ marginBottom: bottomSpacing }}>
      <div
        className="grid-responsive"
        style={{ display: "grid", gridTemplateColumns: rightSlot ? "1fr auto" : "1fr", gap: 24, alignItems: "center", marginBottom: 22 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Avatar name={avatarName} size={44} />
          <div>
            {eyebrow && (
              <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0, textTransform: "uppercase", color: colors.orangeDark, marginBottom: 4 }}>
                {eyebrow}
              </div>
            )}
            <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(32px, 3.8vw, 52px)", margin: 0, letterSpacing: 0, lineHeight: 1.05 }}>{title}</h1>
            <p style={{ color: colors.muted, fontSize: 13, margin: badge ? "6px 0 8px" : "6px 0 0" }}>{subtitle}</p>
            {badge}
          </div>
        </div>

        {rightSlot === "illustration" && (
          <div className="dash-illustration" style={{ position: "relative", ...DASHBOARD_ILLUSTRATION_SIZE, flex: "none" }}>
            <div style={{ position: "absolute", top: -22, right: 8, width: 130, height: 130, borderRadius: "50%", background: blob }} />
            <div style={{ position: "absolute", bottom: -28, left: 10, width: 115, height: 115, borderRadius: "50%", background: blob }} />
            <div style={{ position: "relative", width: "100%", height: "100%" }}>{illustration}</div>
          </div>
        )}

        {rightSlot === "actions" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none", flexWrap: "wrap" }}>{actions}</div>
        )}
      </div>

      {!hideTabs && <Tabs value={activeTab} onChange={onTabChange} options={tabs} />}
    </div>
  );
}

// --- StatTile ----------------------------------------------------------

// Dashboard redesign pass: dropped the old colored-icon-square chip (a
// different hue per tile — the "more than one accent color" pattern the
// redesign audit flagged) in favor of a plain, uniformly-muted icon and a
// big display-weight number as the actual focal point. `sublabelColor`
// stays a real prop (not decorative) — it's the one place a tile's color
// carries genuine meaning (danger red for payment failures/open reports,
// green for live, orange for pending), so it's semantic, not decorative.
export function StatTile({
  icon,
  value,
  label,
  sublabel,
  sublabelColor,
}: {
  icon?: ReactNode;
  value: number | string;
  label: string;
  sublabel: string;
  sublabelColor: string;
}) {
  // Workspaces: an icon card, like the admin Overview's number cards.
  if (useInWorkspace())
    return (
      <div className="ws-stat">
        {icon && (
          <span className="ws-stat-icon wd-ico" data-tone={detailIcon(label).tone} aria-hidden="true">
            {icon}
          </span>
        )}
        <span className="ws-stat-value">{value}</span>
        <span className="ws-stat-label">{label}</span>
        <span className="ws-stat-sub" style={{ color: sublabelColor }}>
          {sublabel}
        </span>
      </div>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "18px 22px", flex: 1, minWidth: 170 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, color: colors.faint }}>
        {icon}
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0, textTransform: "uppercase", color: colors.mutedLight }}>{label}</span>
      </div>
      <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 30, lineHeight: 1, letterSpacing: 0, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 11.5, color: sublabelColor, fontWeight: 700 }}>{sublabel}</div>
    </div>
  );
}

// --- KpiHero / KpiStrip --------------------------------------------------
// Header + KPI redesign pass: rather than N identical StatTiles in a row,
// one number is promoted to a large "hero" figure and the rest sit beside
// it as a supporting StatRow — an asymmetric composition (one thing given
// real weight, everything else in support) in place of the generic
// same-size-tile grid, matching the dashboards' broader "confident type /
// asymmetry over uniform grids" direction.

export function KpiHero({
  icon,
  value,
  label,
  sublabel,
  sublabelColor,
}: {
  icon?: ReactNode;
  value: number | string;
  label: string;
  sublabel: string;
  sublabelColor: string;
}) {
  if (useInWorkspace()) return <StatTile icon={icon} value={value} label={label} sublabel={sublabel} sublabelColor={sublabelColor} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, color: colors.faint }}>
        {icon}
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0, textTransform: "uppercase", color: colors.mutedLight }}>{label}</span>
      </div>
      <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 60, lineHeight: 0.9, letterSpacing: 0, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 12.5, color: sublabelColor, fontWeight: 700 }}>{sublabel}</div>
    </div>
  );
}

/** Pairs one `KpiHero` with a supporting `StatRow` of `StatTile`s, sharing
 * one hairline frame — `hero` renders large on the left (or on its own row
 * above on narrow screens, via `.kpi-strip` in index.css), `children` are
 * the ordinary-size `StatTile`s that make up the rest of the KPI row. */
export function KpiStrip({ hero, children, marginBottom = 34 }: { hero: ReactNode; children: ReactNode; marginBottom?: number }) {
  // Workspaces: one row of equal icon cards.
  if (useInWorkspace())
    return (
      <div className="ws-stats" style={{ marginBottom }}>
        {hero}
        {children}
      </div>
    );
  return (
    <div
      className="kpi-strip"
      style={{
        display: "flex",
        alignItems: "stretch",
        borderTop: `1px solid ${colors.border}`,
        borderBottom: `1px solid ${colors.border}`,
        marginBottom,
      }}
    >
      <div className="kpi-strip-hero" style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "20px 32px 20px 0", flex: "none" }}>
        {hero}
      </div>
      {/* nowrap + horizontal scroll, not flex-wrap — a wrapped flex row would
          break the `.manage-stat-row` "divider between every sibling" rule
          (the tile that wraps onto a new line still isn't a first-child, so
          it'd get a stray, disconnected-looking left rule with nothing
          above it). Scrolling only kicks in once there are enough supporting
          tiles to overflow, which in practice is admin-only (7 tiles). */}
      <div className="manage-stat-row" style={{ display: "flex", flexWrap: "nowrap", overflowX: "auto", flex: 1, minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}

// --- Switch (toggle) --------------------------------------------------------
// A binary on/off control with the same click target and keyboard behavior as
// a checkbox (it *is* one, visually hidden) — introduced for Profile's
// notification/privacy preference rows, which previously used raw
// `<input type="checkbox">` with `accentColor: colors.green`. Not a retrofit
// of every existing checkbox in the app — those keep working unchanged.
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  /** Accessible name — required when no visible text sits next to the switch. */
  label?: string;
}) {
  return (
    <label style={{ position: "relative", display: "inline-flex", width: 38, height: 22, flex: "none", cursor: "pointer" }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        style={{ position: "absolute", inset: 0, opacity: 0, margin: 0, cursor: "pointer" }}
      />
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: radius.pill,
          background: checked ? colors.green : colors.borderStrong,
          transition: "background .15s ease",
          pointerEvents: "none",
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 18 : 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: colors.surface,
          boxShadow: "0 1px 3px rgba(0,0,0,.25)",
          transition: "left .15s ease",
          pointerEvents: "none",
        }}
      />
    </label>
  );
}

// --- shared form field styles (still inline — no interactive state needed) -

export const inputStyle: CSSProperties = {
  width: "100%",
  padding: "11px 13px",
  border: `1px solid ${colors.inputBorder}`,
  borderRadius: radius.control,
  fontSize: 14,
  background: colors.surface,
  color: colors.text,
  outline: "none",
  transition: "border-color .15s ease, box-shadow .15s ease",
};
export const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: colors.muted,
  margin: "0 0 6px",
  letterSpacing: 0,
};

// --- shared table styles ---------------------------------------------------
// Plain <table> markup, not a generic <Table> component — column-specific
// content (StatusBadge, Avatar, action buttons) inside cells fights a
// prop-driven abstraction more than it's helped by one. Wrap every table in
// a `<div style={{ overflowX: "auto" }}>` so it scrolls on narrow viewports
// instead of breaking layout.

/** OG-23 — a data table that stacks into labelled rows on a phone instead of
 * scrolling sideways (`.hc-stack-table` in index.css). Each cell's label is
 * copied from its column header, kept in step as rows load or change. */
export function StackTable({ children, style, ...rest }: React.TableHTMLAttributes<HTMLTableElement>) {
  const ref = useRef<HTMLTableElement>(null);
  useEffect(() => {
    const table = ref.current;
    if (!table) return;
    const label = () => {
      const heads = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
      table.querySelectorAll("tbody tr").forEach((tr) => {
        let col = 0;
        Array.from(tr.children).forEach((cell) => {
          const head = heads[col] ?? "";
          if (head && cell.getAttribute("data-label") !== head) cell.setAttribute("data-label", head);
          col += Number((cell as HTMLTableCellElement).colSpan) || 1;
        });
      });
    };
    label();
    const obs = new MutationObserver(label);
    obs.observe(table, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);
  return (
    <table ref={ref} className="hc-stack-table" style={{ ...tableStyle, ...style }} {...rest}>
      {children}
    </table>
  );
}

export const tableStyle: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13.5 };
export const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  color: colors.mutedLight,
  fontWeight: 700,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0,
  borderBottom: `2px solid ${colors.border}`,
  whiteSpace: "nowrap",
};
export const tdStyle: CSSProperties = { padding: "10px", borderBottom: `1px solid ${colors.border}`, verticalAlign: "middle" };

// --- Drawer --------------------------------------------------------------
/** Formerly a side/bottom sliding drawer. Task and record content no longer
 * slides in from the side (UI completion 2026-10-14): every existing caller
 * now gets the shared centred dialog (`Modal`), which keeps focus inside,
 * restores focus, closes on Escape and scrolls within the viewport on small
 * screens. Kept as a name so existing call sites keep working. */
export function Drawer({
  open,
  onClose,
  title,
  children,
  size = "default",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** "wide" for content that genuinely needs the room. */
  size?: "default" | "wide";
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size={size}>
      {children}
    </Modal>
  );
}

// --- Modal ---------------------------------------------------------------
// The default overlay for a focused task or detail view — a centred popup
// (booking/enrol forms, share/invite, participant lists, check-in, admin
// detail). `Drawer` now renders this too — nothing slides in from the side
// (UI completion 2026-10-14). Same scrim, Escape and
// backdrop-click behaviour as Drawer; z-index matches Drawer's so a
// ConfirmDialog (modal layer) still opens above it. On a phone it's the
// same centred card with a 16px gutter, scrolling inside if it's tall.

const MODAL_EXIT_MS = 180;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Moves focus to the next/previous focusable element inside `panel`,
 * wrapping at the ends (HC-QA-069/088). */
function cycleFocus(panel: HTMLElement, backwards: boolean) {
  const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
  if (!items.length) { panel.focus(); return; }
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next = index === -1 ? (backwards ? items.length - 1 : 0) : (index + (backwards ? -1 : 1) + items.length) % items.length;
  items[next].focus();
}

/** Modal keyboard behaviour for hand-rolled dialogs (HC-QA-069): on open,
 * move focus inside (the first field, else `initial`, else the panel);
 * while open, keep Tab/Shift+Tab inside the panel; on close, hand focus
 * back to whatever opened it. Escape stays the caller's own decision. */
export function useDialogFocus(open: boolean, panelRef: { current: HTMLElement | null }, opts: { initial?: () => HTMLElement | null } = {}) {
  const initialRef = useRef(opts.initial);
  initialRef.current = opts.initial;
  useEffect(() => {
    if (!open) return;
    const restore = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      const field = panel.querySelector<HTMLElement>("input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled])");
      (field ?? initialRef.current?.() ?? panel).focus();
    }, 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !panelRef.current) return;
      // Move focus ourselves on EVERY Tab, not just at the edges: Safari's
      // default Tab skips buttons/links, so leaving mid-dialog presses to
      // the browser lets focus escape the modal (HC-QA-088).
      e.preventDefault();
      cycleFocus(panelRef.current, e.shiftKey);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey, true);
      if (restore && document.contains(restore)) restore.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}


export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  toolbar,
  footer,
  size = "default",
  confirmClose,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** One line of context under the title (a date, a venue, a price). */
  subtitle?: ReactNode;
  children: ReactNode;
  /** Pinned between the header and the scrolling body — e.g. a search box or
   * a progress count that must stay visible while a long list scrolls. */
  toolbar?: ReactNode;
  /** Pinned below the scrolling body — put the primary action here so it's
   * always visible, however long the content is. */
  footer?: ReactNode;
  /** "wide" for multi-field forms or long lists; "default" for compact content. */
  size?: "default" | "wide";
  /** When set (e.g. a half-filled form), closing via Escape, the backdrop or
   * the close button asks first instead of throwing the input away. */
  confirmClose?: { title: string; message: string };
}) {
  const [render, setRender] = useState(open);
  const [closing, setClosing] = useState(false);
  const [askingToClose, setAskingToClose] = useState(false);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // A click only counts as "outside" if it also *started* outside — so
  // selecting text in a field and releasing over the backdrop doesn't close.
  const pressStartedOnBackdrop = useRef(false);

  const requestClose = () => {
    if (confirmClose) setAskingToClose(true);
    else onClose();
  };

  useEffect(() => {
    if (open) {
      setRender(true);
      setClosing(false);
      return;
    }
    setAskingToClose(false);
    if (!render) return;
    setClosing(true);
    const t = window.setTimeout(() => {
      setRender(false);
      setClosing(false);
    }, MODAL_EXIT_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Focus: move into the popup on open (first field, else the close
  // button), keep Tab inside it, and hand focus back to whatever opened it.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      // On a touchscreen, focusing a field would pop the keyboard straight
      // away — focus the dialog itself there (screen readers still land in it).
      const touch = window.matchMedia("(pointer: coarse)").matches;
      const firstField = touch
        ? null
        : panel.querySelector<HTMLElement>("[data-modal-body] input:not([disabled]), [data-modal-body] select:not([disabled]), [data-modal-body] textarea:not([disabled])");
      (firstField ?? panel).focus();
    }, 30);
    return () => {
      window.clearTimeout(t);
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // A ConfirmDialog opened from inside this popup (or the discard
        // prompt) handles its own Escape — don't close the popup under it.
        if (askingToClose || document.querySelector("[data-confirm-dialog]")) return;
        e.stopPropagation();
        requestClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      // A ConfirmDialog stacked on top owns Tab (it traps focus itself).
      if (document.querySelector("[data-confirm-dialog]")) return;
      // HC-QA-088 — cycle focus ourselves on every Tab (Safari's default Tab
      // skips buttons, which let focus leave the popup mid-cycle).
      e.preventDefault();
      cycleFocus(panelRef.current, e.shiftKey);
    };
    window.addEventListener("keydown", onKey);
    // Stop the page behind scrolling, and pad for the scrollbar that
    // disappears so the page doesn't shift sideways on desktop.
    const prevOverflow = document.body.style.overflow;
    const prevPadding = document.body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPadding;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, askingToClose, confirmClose]);

  if (!render) return null;

  return createPortal(
    <div
      className={closing ? "backdrop-out" : "backdrop-in"}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: zIndex.drawer,
        background: "rgba(20,22,20,.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onMouseDown={(e) => {
        pressStartedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressStartedOnBackdrop.current) requestClose();
        pressStartedOnBackdrop.current = false;
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={closing ? "modal-out" : "modal-in"}
        style={{
          width: size === "wide" ? "min(680px, 100%)" : "min(480px, 100%)",
          maxHeight: "calc(100dvh - 32px)",
          background: colors.bg,
          borderRadius: radius.card,
          boxShadow: "0 24px 64px rgba(20,22,20,.28)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          outline: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            padding: "16px 20px",
            borderBottom: `1px solid ${colors.border}`,
            flex: "none",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              id={titleId}
              style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
            >
              {title}
            </div>
            {subtitle && <div style={{ fontSize: 13, color: colors.mutedLight, marginTop: 3 }}>{subtitle}</div>}
          </div>
          <button
            data-modal-close
            onClick={requestClose}
            aria-label="Close"
            style={{
              background: colors.panel,
              border: "none",
              borderRadius: "50%",
              width: 36,
              height: 36,
              color: colors.text,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flex: "none",
            }}
          >
            <CloseIcon size={16} />
          </button>
        </div>
        {toolbar && <div style={{ flex: "none", padding: "14px 20px", borderBottom: `1px solid ${colors.border}` }}>{toolbar}</div>}
        <div data-modal-body style={{ flex: 1, overflowY: "auto", padding: "20px", overscrollBehavior: "contain" }}>
          {children}
        </div>
        {footer && (
          <div style={{ flex: "none", padding: "14px 20px calc(14px + env(safe-area-inset-bottom, 0px))", borderTop: `1px solid ${colors.border}`, background: colors.surface }}>
            {footer}
          </div>
        )}
      </div>
      {confirmClose && (
        <ConfirmDialog
          open={askingToClose}
          title={confirmClose.title}
          message={confirmClose.message}
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          onConfirm={() => {
            setAskingToClose(false);
            onClose();
          }}
          onCancel={() => setAskingToClose(false)}
        />
      )}
    </div>,
    document.body
  );
}

// --- ConfirmDialog -------------------------------------------------------
// A centered yes/no interrupt for destructive actions — distinct from Drawer
// (a slide-over for detail/edit views), so it doesn't slide in and isn't
// full-height. z-index 400, one above Drawer's 300, since a confirm can fire
// from inside an already-open Drawer (e.g. deleting a listing from its own
// edit drawer) and must always render on top of it.

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  tone = "danger",
  busy,
  confirmDisabled,
  children,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "neutral";
  busy?: boolean;
  confirmDisabled?: boolean;
  /** Extra content between the message and the action buttons — e.g. a
   * reason select for a destructive action that needs one (spec §56). */
  children?: ReactNode;
  /** May return a promise: the dialog then shows progress, blocks a second
   * click (and Escape) until it settles, and stays open with the error if it
   * rejects. Resolving to `false` also keeps it open (the caller reported the
   * failure itself). Closing on success stays the caller's job. */
  onConfirm: () => unknown;
  onCancel: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setPending(false);
      setFailure(null);
    }
  }, [open]);
  const working = !!busy || pending;
  const confirm = () => {
    if (working) return;
    setFailure(null);
    const result = onConfirm();
    if (result && typeof (result as Promise<unknown>).then === "function") {
      setPending(true);
      (result as Promise<unknown>)
        .then(() => setPending(false))
        .catch((e: unknown) => {
          setPending(false);
          setFailure(e instanceof Error && e.message ? e.message : "That didn't work. Nothing was changed — try again.");
        });
    }
  };
  // HC-QA-069 — focus moves in (a field if present, else the least
  // destructive action), Tab stays inside, focus returns to the trigger.
  useDialogFocus(open, panelRef, { initial: () => panelRef.current?.querySelector<HTMLButtonElement>("[data-confirm-actions] button") ?? null });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !working) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, working]);

  if (!open) return null;

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: zIndex.modal, background: "rgba(20,22,20,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={() => !working && onCancel()}
    >
      <div
        ref={panelRef}
        data-confirm-dialog
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        tabIndex={-1}
        className="modal-in"
        aria-busy={working || undefined}
        style={{ background: colors.surface, borderRadius: radius.card, padding: 24, maxWidth: 440, width: "100%", maxHeight: "calc(100dvh - 40px)", overflowY: "auto", boxShadow: "0 20px 60px rgba(20,22,20,.25)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>{title}</h3>
        <div id={messageId} style={{ fontSize: 14, color: colors.muted, lineHeight: 1.5, marginBottom: children ? 16 : 20 }}>{message}</div>
        {children && <div style={{ marginBottom: 20 }}>{children}</div>}
        {failure && (
          <div role="alert" style={{ fontSize: 13.5, color: colors.danger, fontWeight: 600, margin: "-8px 0 16px" }}>
            {failure}
          </div>
        )}
        <div data-confirm-actions style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={onCancel} disabled={working}>
            {cancelLabel}
          </Button>
          <Button variant="dark" onClick={confirm} disabled={working || confirmDisabled} aria-busy={working || undefined} style={tone === "danger" ? { background: colors.dangerSolid } : undefined}>
            {working ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// --- NavSidebar --------------------------------------------------------
// A true sidebar, not a modal drawer: no dimming backdrop, the rest of the
// page stays visible and interactive while it's open. Used by Admin/Vendor
// dashboards to replace their horizontal tab strip once it outgrows a
// single row (Admin has 10 tabs). Closes via Escape, clicking a nav item,
// or clicking anywhere outside the panel (a document-level listener, same
// pattern Header.tsx already uses for its dropdowns — there's no backdrop
// element here to catch that click). Half the width of a standard Drawer,
// since a nav list doesn't need as much room as a detail form.

// Shared button-list rendering for both the mobile drawer (NavSidebar) and
// the persistent desktop rail (NavRail) below — a left accent bar on the
// active item (the dashboards' one deliberate accent, per the redesign
// pass) rather than NavSidebar's old solid-fill pill, so the two surfaces
// read as the same nav language at any width.
function NavOptionButtons<T extends string>({
  options,
  value,
  onChange,
  onSelect,
}: {
  /** `group`, when given, renders a small uppercase heading above the first
   * option in each run that shares one — options with no `group` (every
   * existing call site) render as a flat list, unchanged. */
  options: { key: T; label: string; icon?: ReactNode; group?: string }[];
  value: T;
  onChange: (v: T) => void;
  /** Extra action to run after onChange — NavSidebar closes the drawer, NavRail has none. */
  onSelect?: () => void;
}) {
  let lastGroup: string | undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {options.map((o) => {
        const active = o.key === value;
        const showGroupHeading = o.group !== undefined && o.group !== lastGroup;
        lastGroup = o.group;
        return (
          <Fragment key={o.key}>
            {showGroupHeading && (
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0,
                  textTransform: "uppercase",
                  color: colors.faint,
                  padding: "16px 12px 6px",
                }}
              >
                {o.group}
              </div>
            )}
            <button
              type="button"
              // HC-QA-070 — the dashboard section currently shown.
              aria-current={active ? "page" : undefined}
              onClick={() => {
                onChange(o.key);
                onSelect?.();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                textAlign: "left",
                background: active ? colors.panel : "none",
                color: active ? colors.text : colors.muted,
                border: "none",
                borderLeft: `2px solid ${active ? colors.orange : "transparent"}`,
                borderRadius: 0,
                padding: "10px 12px",
                fontSize: 13.5,
                fontWeight: active ? 700 : 500,
                cursor: "pointer",
                lineHeight: 1.3,
              }}
            >
              {o.icon}
              {o.label}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Persistent left-rail navigation for ManageShell, visible above the
 * `.manage-rail` CSS breakpoint (1025px, see index.css) — replaces "the
 * hidden burger drawer is the only way to switch tabs" for desktop, the
 * dashboard redesign audit's top usability finding. Below that breakpoint
 * this renders `display: none` (CSS, not a JS media query, matching every
 * other responsive utility class in this app) and NavSidebar's drawer takes
 * over instead. */
export function NavRail<T extends string>({
  title,
  options,
  value,
  onChange,
  showLogo = true,
}: {
  title: string;
  options: { key: T; label: string; icon?: ReactNode; group?: string }[];
  value: T;
  onChange: (v: T) => void;
  /** Vendor/Admin dashboards keep the logo lockup (default); Profile's own
   * rail already sits under the app's own header, so a second logo directly
   * below it just repeats the brand mark with nothing new to say. */
  showLogo?: boolean;
}) {
  return (
    <aside className="manage-rail" style={{ flexDirection: "column", position: "sticky", top: 24 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "0 12px 14px",
          borderBottom: `1px solid ${colors.border}`,
          marginBottom: 10,
        }}
      >
        {showLogo && <BrandLogo decorative style={{ height: 20, flex: "none" }} />}
        <span
          style={{
            fontFamily: 'ui-monospace, "SF Mono", "Roboto Mono", Menlo, monospace',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0,
            textTransform: "uppercase",
            color: colors.mutedLight,
          }}
        >
          {title}
        </span>
      </div>
      <NavOptionButtons options={options} value={value} onChange={onChange} />
    </aside>
  );
}

export function NavSidebar<T extends string>({
  open,
  onClose,
  title,
  options,
  value,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  options: { key: T; label: string; icon?: ReactNode; group?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDocClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    // mousedown, not click — matches Header.tsx's dropdown-outside-click
    // pattern, and avoids racing the burger button's own click handler.
    document.addEventListener("mousedown", onDocClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    // Full-screen section menu (UI completion 2026-10-14: no side drawers).
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${title} sections`}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: zIndex.drawer,
        width: "100%",
        background: colors.bg,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 16px",
          borderBottom: `1px solid ${colors.border}`,
          flex: "none",
        }}
      >
        <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15 }}>{title}</span>
        <button
          autoFocus
          onClick={onClose}
          aria-label="Close menu"
          style={{
            background: colors.panel,
            border: "none",
            borderRadius: "50%",
            width: 30,
            height: 30,
            color: colors.text,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flex: "none",
          }}
        >
          <CloseIcon size={14} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
        <NavOptionButtons options={options} value={value} onChange={onChange} onSelect={onClose} />
      </div>
    </div>,
    document.body
  );
}
