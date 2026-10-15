import { useCallback, useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, EyeOff, Inbox, Lock, MoreHorizontal, Search, Users, X } from "lucide-react";
import { ApiError } from "../../api/core";
import { useUrlParam } from "../../useUrlTab";
import { useToast } from "../Toast";

// Admin workspace primitives (2026-10-14 redesign). Styling lives in
// admin.css under `.adm-*`; everything here is markup + behaviour only, so
// the legacy admin tools (Finance, Commerce, …) and the redesigned pages
// share one visual system.

export const ICON = { size: 16, strokeWidth: 1.9 } as const;

// --- buttons ---------------------------------------------------------------

type AdminButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "dark" | "quiet" | "danger";
  size?: "md" | "sm";
};

export function AdminButton({ variant = "secondary", size = "md", className, type = "button", ...rest }: AdminButtonProps) {
  const cls = ["adm-btn", variant !== "secondary" && `adm-btn--${variant}`, size === "sm" && "adm-btn--sm", className].filter(Boolean).join(" ");
  return <button type={type} className={cls} {...rest} />;
}

// --- page header -------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  crumbs,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  crumbs: { label: string; onClick?: () => void }[];
  actions?: ReactNode;
}) {
  return (
    <header className="adm-head">
      <div style={{ minWidth: 0 }}>
        <nav aria-label="Breadcrumb">
          <ol className="adm-crumbs">
            {crumbs.map((c, i) => (
              <li key={i}>
                {c.onClick ? <button type="button" onClick={c.onClick}>{c.label}</button> : <span aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c.label}</span>}
              </li>
            ))}
          </ol>
        </nav>
        <h1 className="adm-title">{title}</h1>
        {subtitle && <p className="adm-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="adm-head-actions">{actions}</div>}
    </header>
  );
}

// --- panels ------------------------------------------------------------------

export function Box({
  title,
  subtitle,
  actions,
  children,
  flush,
  headingLevel = 2,
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** No body padding — for tables, queues and toolbars that run edge to edge. */
  flush?: boolean;
  headingLevel?: 2 | 3;
  id?: string;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className="adm-box" id={id} aria-label={typeof title === "string" ? title : undefined}>
      {(title || actions) && (
        <div className="adm-box-head">
          <div style={{ minWidth: 0 }}>
            {title && <H className="adm-box-title">{title}</H>}
            {subtitle && <p className="adm-box-sub">{subtitle}</p>}
          </div>
          {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>}
        </div>
      )}
      {flush ? children : <div className="adm-box-body">{children}</div>}
    </section>
  );
}

// --- metrics -----------------------------------------------------------------

export function MetricStrip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label}>
      <dl className="adm-metrics" style={{ margin: 0 }}>{children}</dl>
    </section>
  );
}

/** One metric. `period` is mandatory so no number is shown without saying
 * what window it covers. */
export function Metric({
  label,
  value,
  period,
  icon,
  tone,
  action,
}: {
  label: string;
  value: ReactNode;
  period: string;
  icon?: ReactNode;
  tone?: "alert";
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="adm-metric" data-tone={tone}>
      <dt className="adm-metric-label">
        {icon}
        {label}
      </dt>
      <dd style={{ margin: 0 }}>
        <div className="adm-metric-value">{value}</div>
        <div className="adm-metric-period">{period}</div>
        {action && (
          <button type="button" className="adm-metric-link" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </dd>
    </div>
  );
}

// --- toolbar -----------------------------------------------------------------

export function Toolbar({ children, label = "Filters" }: { children: ReactNode; label?: string }) {
  return (
    <div className="adm-toolbar" role="search" aria-label={label}>
      {children}
    </div>
  );
}

export function SearchField({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string }) {
  const id = useId();
  return (
    <div className="adm-field adm-search" style={{ flex: "1 1 240px" }}>
      <label htmlFor={id}>{label}</label>
      <div style={{ position: "relative" }}>
        <Search size={18} strokeWidth={1.9} aria-hidden="true" />
        <input id={id} type="search" className="adm-input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  width,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  width?: number;
}) {
  const id = useId();
  return (
    <div className="adm-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="adm-select" value={value} onChange={(e) => onChange(e.target.value as T)} style={{ width }}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Status views ("All · Pending · Live …") — toggle buttons, so screen readers
 * hear which one is pressed. */
export function ViewTabs<T extends string>({ label, views, value, onChange }: { label: string; views: { key: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="adm-views" role="group" aria-label={label}>
      {views.map((v) => (
        <button key={v.key} type="button" className="adm-view" aria-pressed={value === v.key} onClick={() => onChange(v.key)}>
          {v.label}
          {v.count !== undefined && <span className="adm-view-count">{v.count}</span>}
        </button>
      ))}
    </div>
  );
}

// --- badges ------------------------------------------------------------------

export type BadgeTone = "good" | "warn" | "bad" | "neutral" | "outline";

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className="adm-badge" data-tone={tone}>
      {children}
    </span>
  );
}

const STATUS: Record<string, { tone: BadgeTone; label: string }> = {
  pending: { tone: "warn", label: "Pending review" },
  approved: { tone: "good", label: "Live" },
  active: { tone: "good", label: "Active" },
  verified: { tone: "good", label: "Verified" },
  rejected: { tone: "bad", label: "Rejected" },
  suspended: { tone: "bad", label: "Suspended" },
  deleted: { tone: "neutral", label: "Deleted" },
  draft: { tone: "neutral", label: "Draft" },
  paused: { tone: "neutral", label: "Paused" },
  archived: { tone: "neutral", label: "Archived" },
  dismissed: { tone: "neutral", label: "Dismissed" },
  actioned: { tone: "good", label: "Actioned" },
  cancelled: { tone: "bad", label: "Cancelled" },
};

export function StatusTag({ status, label }: { status: string; label?: string }) {
  const s = STATUS[status] ?? { tone: "neutral" as const, label: status ? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ") : "—" };
  return <Badge tone={s.tone}>{label ?? s.label}</Badge>;
}

export function statusLabel(status: string): string {
  return STATUS[status]?.label ?? status;
}

// --- pagination --------------------------------------------------------------

export function usePaged<T>(items: T[], pageSize: number, resetKey: unknown, urlParam?: string) {
  // With `urlParam` the page number lives in the URL, so returning from a
  // record (or sharing the link) lands on the same page of the same list.
  const [localPage, setLocalPage] = useState(1);
  const [urlPage, setUrlPage] = useUrlParam<string>(urlParam ?? "__unused_page", "1");
  const page = urlParam ? Math.max(1, Number(urlPage) || 1) : localPage;
  const setPage = useCallback((p: number) => (urlParam ? setUrlPage(String(p)) : setLocalPage(p)), [urlParam, setUrlPage]);
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) {
      firstKey.current = false;
      return;
    }
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pageCount);
  const slice = useMemo(() => items.slice((current - 1) * pageSize, current * pageSize), [items, current, pageSize]);
  return { page: current, pageCount, setPage, slice, total: items.length, pageSize };
}

export function Pager({ page, pageCount, total, pageSize, setPage, noun = "items" }: { page: number; pageCount: number; total: number; pageSize: number; setPage: (p: number) => void; noun?: string }) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="adm-pager" aria-label="Pagination">
      <span aria-live="polite">
        Showing {from}–{to} of {total} {noun}
      </span>
      {pageCount > 1 && (
        <div className="adm-pager-buttons">
          <AdminButton size="sm" onClick={() => setPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
            <ChevronLeft size={16} strokeWidth={1.9} aria-hidden="true" /> Prev
          </AdminButton>
          <span style={{ alignSelf: "center", padding: "0 6px" }}>
            Page {page} of {pageCount}
          </span>
          <AdminButton size="sm" onClick={() => setPage(page + 1)} disabled={page >= pageCount} aria-label="Next page">
            Next <ChevronRight size={16} strokeWidth={1.9} aria-hidden="true" />
          </AdminButton>
        </div>
      )}
    </nav>
  );
}

// --- loading / empty / error -------------------------------------------------

export function LoadingRows({ rows = 4, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} style={{ padding: "6px 0" }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: "flex", gap: 14, padding: "12px 18px", borderBottom: "1px solid var(--color-border)" }}>
          <span className="adm-skel" style={{ width: "34%" }} />
          <span className="adm-skel" style={{ width: "22%" }} />
          <span className="adm-skel" style={{ width: "14%", marginLeft: "auto" }} />
        </div>
      ))}
      <span className="adm-visually-hidden">{label}…</span>
    </div>
  );
}

export function EmptyMessage({ title, detail, icon, action }: { title: string; detail?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="adm-state">
      {icon ?? <Inbox size={22} strokeWidth={1.9} aria-hidden="true" />}
      <div className="adm-state-title">{title}</div>
      {detail && <div>{detail}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function errorMessage(e: unknown, fallback = "Something went wrong."): string {
  if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return e.message || "Your admin role doesn't include this tool.";
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

export function ErrorMessage({ error, onRetry, title = "Couldn't load this" }: { error: unknown; onRetry?: () => void; title?: string }) {
  const forbidden = error instanceof ApiError && (error.status === 401 || error.status === 403);
  return (
    <div className="adm-state" data-tone="error" role="alert">
      {forbidden ? <Lock size={22} strokeWidth={1.9} aria-hidden="true" /> : <AlertTriangle size={22} strokeWidth={1.9} aria-hidden="true" />}
      <div className="adm-state-title">{forbidden ? "Not available for your admin role" : title}</div>
      <div>{errorMessage(error, "Check your connection and try again.")}</div>
      {onRetry && !forbidden && (
        <div style={{ marginTop: 14 }}>
          <AdminButton onClick={onRetry}>Try again</AdminButton>
        </div>
      )}
    </div>
  );
}

/** Renders loading → error → children(data). Never shows an empty state for a
 * load that hasn't finished or that failed (audit finding 3). */
export function Loaded<T>({ state, children, rows }: { state: AdminData<T>; children: (data: T) => ReactNode; rows?: number }) {
  if (state.error) return <ErrorMessage error={state.error} onRetry={state.reload} />;
  if (state.data === null) return <LoadingRows rows={rows} />;
  return <>{children(state.data)}</>;
}

// --- data + action hooks -----------------------------------------------------

export interface AdminData<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
  setData: (d: T) => void;
}

/** Loads once (and on `deps` change); `reload()` refetches without clearing
 * what's on screen, so lists don't flash empty after every action. */
export function useAdminData<T>(loader: () => Promise<T>, deps: unknown[] = []): AdminData<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const seq = useRef(0);
  const reload = useCallback(() => {
    const n = ++seq.current;
    setLoading(true);
    loaderRef
      .current()
      .then((d) => {
        if (n !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (n !== seq.current) return;
        setError(e);
      })
      .finally(() => {
        if (n === seq.current) setLoading(false);
      });
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, deps);
  return { data, error, loading, reload, setData };
}

/** Runs a write with a busy flag and toast feedback. Errors are surfaced, not
 * swallowed (audit finding 5); returns whether it succeeded. */
export function useAdminAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async (key: string, fn: () => Promise<unknown>, messages: { success?: string; error?: string } = {}) => {
      setBusy(key);
      try {
        await fn();
        if (messages.success) toast.success(messages.success);
        return true;
      } catch (e) {
        toast.error(errorMessage(e, messages.error ?? "That didn't work. Try again."));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [toast]
  );
  return { run, busy };
}

export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!shown.length) return null;
  return (
    <dl className="adm-facts">
      {shown.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="adm-section-label">{children}</h2>;
}

/** Case-insensitive "does any of these fields contain the query" helper. */
export function matches(q: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(needle));
}

export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return withTime
    ? d.toLocaleString("en-IE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
}

// --- overflow menu -------------------------------------------------------------

export interface MenuAction {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** "More actions" menu for secondary row actions (spec: frequent actions stay
 * visible; the rest go here). Menu-button pattern: arrows move, Escape closes
 * and returns focus, a click outside closes. */
export function OverflowMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const items = () => Array.from(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => items()[0]?.focus(), 0);
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(i + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };
  if (!actions.length) return null;
  return (
    <div className="adm-menu" ref={wrap} onKeyDown={onKey}>
      <button
        ref={btn}
        type="button"
        className="adm-btn adm-btn--quiet adm-btn--sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={18} strokeWidth={1.9} aria-hidden="true" />
      </button>
      {open && (
        <ul className="adm-menu-list" role="menu" id={menuId} aria-label={label}>
          {actions.map((a) => (
            <li key={a.label} role="none">
              <button
                type="button"
                role="menuitem"
                data-danger={a.danger || undefined}
                disabled={a.disabled}
                onClick={() => {
                  setOpen(false);
                  btn.current?.focus();
                  a.onSelect();
                }}
              >
                {a.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- form fields -----------------------------------------------------------------

/** Label above the control, required marker, and the error right beside it.
 * The render prop wires id / aria-invalid / aria-describedby. */
export function FormField({
  label,
  required,
  error,
  hint,
  children,
  style,
}: {
  label: ReactNode;
  required?: boolean;
  error?: string | null;
  hint?: ReactNode;
  children: (props: { id: string; "aria-invalid"?: true; "aria-describedby"?: string; "aria-required"?: true }) => ReactNode;
  style?: React.CSSProperties;
}) {
  const id = useId();
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="adm-field" style={style}>
      <label htmlFor={id}>
        {label}
        {required && (
          <>
            <span className="adm-req" aria-hidden="true">*</span>
            <span className="adm-visually-hidden"> (required)</span>
          </>
        )}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy, "aria-required": required ? true : undefined })}
      {hint && (
        <span id={hintId} style={{ fontWeight: 400, color: "var(--adm-muted)" }}>
          {hint}
        </span>
      )}
      {error && (
        <span id={errId} className="adm-field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** Says who can read a note or reason, so admins never guess. */
export function Visibility({ who }: { who: "internal" | "shared" }) {
  return (
    <span className="adm-visibility">
      {who === "internal" ? <EyeOff size={14} strokeWidth={1.9} aria-hidden="true" /> : <Users size={14} strokeWidth={1.9} aria-hidden="true" />}
      {who === "internal" ? "Internal — visible to admins only" : "Shared with the person concerned"}
    </span>
  );
}
