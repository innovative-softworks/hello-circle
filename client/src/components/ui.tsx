import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, CloseIcon, StarIcon } from "./icons";
import { colors, fonts, maxWidth, radius, zIndex } from "../theme";

// Shared, reusable building blocks for the vendor/admin/reviews UI — kept in
// one place so button/card/badge styling can't drift between dashboards.

export type ListingStatus = "pending" | "approved" | "rejected" | "suspended" | "deleted";

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

// --- Button ------------------------------------------------------------

type ButtonVariant = "primary" | "orange" | "dark" | "ghost" | "danger";

const buttonBase: CSSProperties = {
  borderRadius: radius.control,
  fontWeight: 700,
  fontSize: 14,
  padding: "10px 16px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
};

const buttonVariants: Record<ButtonVariant, CSSProperties> = {
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
}: {
  variant?: ButtonVariant;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  style?: CSSProperties;
  type?: "button" | "submit";
  full?: boolean;
}) {
  return (
    <button
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

// --- StatusBadge -----------------------------------------------------------

const statusStyles: Record<ListingStatus, { bg: string; fg: string; label: string }> = {
  pending: { bg: "#FCEDE4", fg: colors.orangeDark, label: "Pending review" },
  approved: { bg: colors.greenBg, fg: colors.greenText, label: "Live" },
  rejected: { bg: colors.dangerBg, fg: colors.danger, label: "Rejected" },
  suspended: { bg: colors.dangerBg, fg: colors.danger, label: "Suspended" },
  deleted: { bg: colors.panel, fg: colors.muted, label: "Deleted" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = statusStyles[status as ListingStatus] ?? statusStyles.deleted;
  return (
    <span
      className={status === "pending" ? "badge-dot-pending" : undefined}
      style={{
        background: s.bg,
        color: s.fg,
        borderRadius: 20,
        padding: "3px 11px",
        fontSize: 12,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        letterSpacing: ".01em",
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

const availabilityStyles: Record<AvailabilityState, { bg: string; fg: string }> = {
  open: { bg: colors.greenBg, fg: colors.greenText },
  urgent: { bg: colors.orangeBg, fg: colors.orangeDark },
  full: { bg: colors.panel, fg: colors.muted },
  waitlist: { bg: colors.orangeBg, fg: colors.orangeDark },
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
        letterSpacing: ".01em",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// --- Avatar (initials, deterministic colour from the name) -----------------

const AVATAR_PALETTE = [colors.green, colors.orange, "#4C6FE7", "#B8548C", "#2E9B9B", colors.gold];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  const bg = AVATAR_PALETTE[hashString(name) % AVATAR_PALETTE.length];
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
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 18, overflow: "hidden" }}>
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
        <div style={{ border: `1px solid ${colors.border}`, borderRadius: 18, padding: 22 }}>
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

export function EmptyState({ icon, title, subtitle, action }: { icon: ReactNode; title: string; subtitle?: string; action?: ReactNode }) {
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
}) {
  const isGreen = accent === "green";
  const blob = isGreen ? "rgba(30,122,76,.14)" : "rgba(232,98,42,.14)";

  return (
    <div style={{ marginBottom: bottomSpacing }}>
      <div
        className="grid-responsive"
        style={{ display: "grid", gridTemplateColumns: illustration ? "1fr auto" : "1fr", gap: 24, alignItems: "center", marginBottom: 22 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Avatar name={avatarName} size={44} />
          <div>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 27, margin: 0, letterSpacing: "-.02em" }}>{title}</h1>
            <p style={{ color: colors.muted, fontSize: 13, margin: badge ? "0 0 8px" : 0 }}>{subtitle}</p>
            {badge}
          </div>
        </div>

        {illustration && (
          <div className="dash-illustration" style={{ position: "relative", ...DASHBOARD_ILLUSTRATION_SIZE, flex: "none" }}>
            <div style={{ position: "absolute", top: -22, right: 8, width: 130, height: 130, borderRadius: "50%", background: blob }} />
            <div style={{ position: "absolute", bottom: -28, left: 10, width: 115, height: 115, borderRadius: "50%", background: blob }} />
            <div style={{ position: "relative", width: "100%", height: "100%" }}>{illustration}</div>
          </div>
        )}
      </div>

      {!hideTabs && <Tabs value={activeTab} onChange={onTabChange} options={tabs} />}
    </div>
  );
}

// --- StatTile ----------------------------------------------------------

export function StatTile({
  icon,
  iconBg,
  iconColor,
  value,
  label,
  sublabel,
  sublabelColor,
}: {
  icon: ReactNode;
  iconBg: string;
  iconColor: string;
  value: number | string;
  label: string;
  sublabel: string;
  sublabelColor: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "20px 20px", flex: 1, minWidth: 170 }}>
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 12,
          background: iconBg,
          color: iconColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
        }}
      >
        {icon}
      </div>
      <div>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 12, color: colors.mutedLight, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 11, color: sublabelColor, fontWeight: 700 }}>{sublabel}</div>
      </div>
    </div>
  );
}

export function StatRow({ children, marginBottom = 34 }: { children: ReactNode; marginBottom?: number }) {
  return (
    <div
      className="card-surface"
      style={{
        display: "flex",
        flexWrap: "wrap",
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.card,
        marginBottom,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

// --- shared form field styles (still inline — no interactive state needed) -

export const inputStyle: CSSProperties = {
  width: "100%",
  padding: "11px 13px",
  border: `1px solid ${colors.inputBorder}`,
  borderRadius: 11,
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
  letterSpacing: ".01em",
};

// --- shared table styles ---------------------------------------------------
// Plain <table> markup, not a generic <Table> component — column-specific
// content (StatusBadge, Avatar, action buttons) inside cells fights a
// prop-driven abstraction more than it's helped by one. Wrap every table in
// a `<div style={{ overflowX: "auto" }}>` so it scrolls on narrow viewports
// instead of breaking layout.

export const tableStyle: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13.5 };
export const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  color: colors.muted,
  fontWeight: 700,
  fontSize: 12,
  borderBottom: `2px solid ${colors.border}`,
  whiteSpace: "nowrap",
};
export const tdStyle: CSSProperties = { padding: "10px", borderBottom: `1px solid ${colors.border}`, verticalAlign: "middle" };

// --- Drawer --------------------------------------------------------------
// Generalizes PhotoGallery.tsx's Lightbox overlay mechanics (portal to
// document.body, fixed scrim, Escape/backdrop-click to close) into a
// reusable slide-over panel for entity detail views — the list behind it
// stays visible/scrolled in place rather than being replaced or navigated
// away from. z-index 300 is one level above the lightbox's existing 200 so
// a drawer can never be hidden behind an open photo lightbox (they're not
// expected to be open together, but this keeps the ordering unambiguous).

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
  /** "wide" is for content that genuinely needs the room — a multi-field
   * edit form — rather than a compact detail/actions view. */
  size?: "default" | "wide";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: zIndex.drawer, background: "rgba(20,22,20,.45)" }} onClick={onClose}>
      <div
        className="slide-in-right"
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: size === "wide" ? "min(680px, 94vw)" : "min(480px, 92vw)",
          background: colors.bg,
          boxShadow: "-16px 0 40px rgba(20,22,20,.18)",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "18px 22px",
            borderBottom: `1px solid ${colors.border}`,
            flex: "none",
          }}
        >
          <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17 }}>{title}</span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: colors.panel,
              border: "none",
              borderRadius: "50%",
              width: 34,
              height: 34,
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
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 22px" }}>{children}</div>
      </div>
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
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: zIndex.modal, background: "rgba(20,22,20,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={onCancel}
    >
      <div
        className="pop-in"
        style={{ background: colors.surface, borderRadius: radius.card, padding: 24, maxWidth: 380, width: "100%", boxShadow: "0 20px 60px rgba(20,22,20,.25)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>{title}</h3>
        <div style={{ fontSize: 14, color: colors.muted, lineHeight: 1.5, marginBottom: 20 }}>{message}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant="dark" onClick={onConfirm} disabled={busy} style={tone === "danger" ? { background: colors.danger } : undefined}>
            {busy ? "…" : confirmLabel}
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
  options: { key: T; label: string; icon?: ReactNode }[];
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
    <div
      ref={panelRef}
      className="slide-in-left"
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        bottom: 0,
        zIndex: zIndex.drawer,
        width: "min(240px, 80vw)",
        background: colors.bg,
        borderRight: `1px solid ${colors.border}`,
        boxShadow: "16px 0 40px rgba(20,22,20,.12)",
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
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {options.map((o) => {
            const active = o.key === value;
            return (
              <button
                key={o.key}
                onClick={() => {
                  onChange(o.key);
                  onClose();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  textAlign: "left",
                  background: active ? colors.dark : "none",
                  color: active ? "#fff" : colors.text,
                  border: "none",
                  borderRadius: radius.control,
                  padding: "11px 12px",
                  fontSize: 13.5,
                  fontWeight: active ? 700 : 500,
                  cursor: "pointer",
                }}
              >
                {o.icon}
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
