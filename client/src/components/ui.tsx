import { useState, type CSSProperties, type ReactNode } from "react";
import { CheckIcon, StarIcon } from "./icons";
import { colors, fonts } from "../theme";

// Shared, reusable building blocks for the vendor/admin/reviews UI — kept in
// one place so button/card/badge styling can't drift between dashboards.

export type ListingStatus = "pending" | "approved" | "rejected" | "suspended" | "deleted";

// --- Button ------------------------------------------------------------

type ButtonVariant = "primary" | "orange" | "dark" | "ghost" | "danger";

const buttonBase: CSSProperties = {
  borderRadius: 10,
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
  ghost: { background: "#fff", color: colors.text, border: `1px solid ${colors.borderStrong}` },
  danger: { background: "none", color: "#b00020", border: "none", padding: "6px 6px", fontWeight: 600, fontSize: 13 },
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
        background: "#fff",
        border: `1px solid ${colors.border}`,
        borderRadius: 16,
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
  rejected: { bg: "#F6E3E3", fg: "#b00020", label: "Rejected" },
  suspended: { bg: "#F6E3E3", fg: "#b00020", label: "Suspended" },
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

// --- EmptyState --------------------------------------------------------

export function EmptyState({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle?: string }) {
  return (
    <div
      style={{
        border: `1.5px dashed ${colors.border}`,
        borderRadius: 16,
        padding: "36px 20px",
        textAlign: "center",
        color: colors.mutedLight,
      }}
    >
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 10, color: colors.faint }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 14, color: colors.muted, marginBottom: subtitle ? 4 : 0 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13 }}>{subtitle}</div>}
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
              background: active ? colors.dark : "#fff",
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
            <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>{subtitle}</p>
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

      <Tabs value={activeTab} onChange={onTabChange} options={tabs} />
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
        background: "#fff",
        border: `1px solid ${colors.border}`,
        borderRadius: 16,
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
  background: "#fff",
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
