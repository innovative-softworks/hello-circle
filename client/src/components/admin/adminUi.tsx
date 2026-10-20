import { DetailIcon } from "../workspace/DetailParts";
import { useWorkspacePageSubtitle, useWorkspacePageTitle } from "../workspace/inWorkspace";
import { detailIcon } from "../workspace/detailIcons";
import { ActionMenu } from "../ActionMenu";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, ChevronLeft, ChevronRight, EyeOff, Inbox, Lock, Search, Users, X, type LucideIcon } from "lucide-react";
import { ApiError } from "../../api/core";
import { useUrlParam } from "../../useUrlTab";
import { useToast } from "../Toast";
import { Modal } from "../ui";

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

/** A section description that opens with the page's own description drops
 * that repeated part ("Everyone with … account, newest first." → "Newest first."). */
function withoutRepeat(text: ReactNode, page: string | null): ReactNode {
  if (typeof text !== "string" || !page) return text;
  const head = page.replace(/[.\s]+$/, "");
  if (!text.toLowerCase().startsWith(head.toLowerCase())) return text;
  const rest = text.slice(head.length).replace(/^[\s,.;:—-]+/, "");
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : null;
}

export function Box({
  title,
  subtitle,
  actions,
  children,
  flush,
  headingLevel = 2,
  id,
  icon,
}: {
  /** Optional Lucide icon shown in a tile before the title. */
  icon?: LucideIcon;
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
  // A section titled like its page (People on the People page) doesn't repeat
  // the heading; its description and actions stay (owner, 2026-10-20).
  const pageTitle = useWorkspacePageTitle();
  const pageSubtitle = useWorkspacePageSubtitle();
  const repeatsPage = typeof title === "string" && !!pageTitle && title.trim().toLowerCase() === pageTitle.trim().toLowerCase();
  if (repeatsPage) {
    return (
      <section className="adm-box adm-box--page" id={id} aria-label={title as string}>
        {(subtitle || actions) && (
          <div className="adm-box-head adm-box-head--page">
            {subtitle && <p className="adm-box-sub">{withoutRepeat(subtitle, pageSubtitle)}</p>}
            {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>}
          </div>
        )}
        {flush ? children : <div className="adm-box-body">{children}</div>}
      </section>
    );
  }
  return (
    <section className="adm-box" id={id} aria-label={typeof title === "string" ? title : undefined}>
      {(title || actions) && (
        <div className="adm-box-head">
          <div style={{ minWidth: 0, display: "flex", gap: 12, alignItems: "flex-start" }}>
            {icon && <IconTile icon={icon} label={typeof title === "string" ? title : undefined} />}
            <div style={{ minWidth: 0 }}>
              {title && <H className="adm-box-title">{title}</H>}
              {subtitle && <p className="adm-box-sub">{subtitle}</p>}
            </div>
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
  return <Badge tone={STATUS[status]?.tone ?? "neutral"}>{label ?? statusLabel(status)}</Badge>;
}

/** The label StatusTag shows: a known status's name, else the raw value in sentence case. */
export function statusLabel(status: string): string {
  return STATUS[status]?.label ?? (status ? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ") : "—");
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

/** OG-24 — the page number of a list the server pages (kept in the URL like
 * `usePaged`), back to page 1 whenever `resetKey` (the filters) changes. */
export function useUrlPage(resetKey: unknown, urlParam = "page") {
  const [urlPage, setUrlPage] = useUrlParam<string>(urlParam, "1");
  const page = Math.max(1, Number(urlPage) || 1);
  const setPage = useCallback((p: number) => setUrlPage(String(p)), [setUrlPage]);
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) {
      firstKey.current = false;
      return;
    }
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);
  return [page, setPage] as const;
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
  if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return e.message || "You don't have access to this.";
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

export function ErrorMessage({ error, onRetry, title = "Couldn't load this" }: { error: unknown; onRetry?: () => void; title?: string }) {
  const forbidden = error instanceof ApiError && (error.status === 401 || error.status === 403);
  return (
    <div className="adm-state" data-tone="error" role="alert">
      {forbidden ? <Lock size={22} strokeWidth={1.9} aria-hidden="true" /> : <AlertTriangle size={22} strokeWidth={1.9} aria-hidden="true" />}
      <div className="adm-state-title">{forbidden ? "Not available to you" : title}</div>
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
export function Loaded<T>({ state, children, rows, title }: { state: AdminData<T>; children: (data: T) => ReactNode; rows?: number; title?: string }) {
  if (state.error) return <ErrorMessage error={state.error} onRetry={state.reload} title={title} />;
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
  // On detail pages (and editors) the label gets the same tinted icon as the
  // template's sections; elsewhere the icon is hidden by CSS.
  const text = typeof children === "string" ? children : Array.isArray(children) ? children.filter((c) => typeof c === "string" || typeof c === "number").join("") : "";
  return (
    <h2 className="adm-section-label">
      {text && (
        <span className="sl-ico">
          <DetailIcon label={text} size="sm" />
        </span>
      )}
      {children}
    </h2>
  );
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
 * visible; the rest go here). OG-21 — the same ActionMenu partner and host
 * workspaces use (one keyboard/positioning implementation), with the admin's
 * compact icon trigger. */
export function OverflowMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  if (!actions.length) return null;
  return <ActionMenu appearance="icon" label={label} items={actions} />;
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

// --- icons, icon tabs, tiles (2026-10-16 icon pass) ------------------------------

/** Square icon tile; `tone="hot"` when something is waiting. */
export function IconTile({ icon: Icon, tone, size = 36, label }: { icon: LucideIcon; tone?: "hot" | "good"; size?: number; label?: string }) {
  // With a label (a section title), the tile takes the detail pages' colour for it.
  const auto = !tone && label ? detailIcon(label).tone : undefined;
  return (
    <span className={auto ? "adm-itile wd-ico" : "adm-itile"} data-tone={tone ?? auto} style={{ width: size, height: size }}>
      <Icon size={Math.round(size / 2)} strokeWidth={1.9} aria-hidden="true" />
    </span>
  );
}

export interface IconTabItem<T extends string> {
  key: T;
  label: string;
  icon: LucideIcon;
  count?: number;
  /** Tabs with a different group get a thin divider before them. */
  group?: string;
}

/** Section tabs with icons and optional counts (one shared style for every admin page). */
export function IconTabs<T extends string>({ label, items, value, onChange }: { label: string; items: IconTabItem<T>[]; value: T; onChange: (k: T) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // On phones the row scrolls sideways: keep the selected tab in view.
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    const row = ref.current;
    if (el && row && row.scrollWidth > row.clientWidth) row.scrollLeft = el.offsetLeft - 16;
  }, [value]);
  // When the row scrolls sideways, fade the edge that has more tabs past it.
  const [more, setMore] = useState<{ start: boolean; end: boolean }>({ start: false, end: false });
  useEffect(() => {
    const row = ref.current;
    if (!row) return;
    const update = () => {
      const start = row.scrollLeft > 2;
      const end = row.scrollLeft + row.clientWidth < row.scrollWidth - 2;
      setMore((m) => (m.start === start && m.end === end ? m : { start, end }));
    };
    update();
    row.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(row);
    return () => {
      row.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, []);
  return (
    <div role="tablist" aria-label={label} className="adm-itabs" ref={ref} data-more-start={more.start || undefined} data-more-end={more.end || undefined}>
      {items.map((t, i) => {
        const Icon = t.icon;
        const divider = i > 0 && t.group !== undefined && t.group !== items[i - 1].group;
        return (
          <span key={t.key} style={{ display: "contents" }}>
            {divider && <span className="adm-itabs-sep" aria-hidden="true" />}
            <button type="button" role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}>
              <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
              {t.label}
              {!!t.count && <span className="adm-itabs-count">{t.count}</span>}
            </button>
          </span>
        );
      })}
    </div>
  );
}

/** Banner for "N things need attention" with one main action. */
export function AttentionBanner({ icon: Icon, children, action }: { icon: LucideIcon; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="adm-attn" role="status">
      <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {action}
    </div>
  );
}

/** A form in a popup, styled as the admin workspace (2026-10-16). Put the main
 * action in `footer`; pass `dirty` so closing a half-filled form asks first. */
export function AdminModal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide,
  dirty,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  dirty?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      size={wide ? "wide" : "default"}
      confirmClose={dirty ? { title: "Discard your changes?", message: "What you've typed in this form will be lost." } : undefined}
      footer={footer ? <div className="adm-dlg adm-dlg-foot">{footer}</div> : undefined}
    >
      <div className="adm-dlg">{children}</div>
    </Modal>
  );
}

// --- server-paged lists (OG-24) ----------------------------------------------------

export interface ServerPaged<T> {
  items: T[];
  /** First page still loading (nothing to show yet). */
  loading: boolean;
  error: unknown;
  hasMore: boolean;
  loadingMore: boolean;
  moreFailed: boolean;
  loadMore: () => void;
  reload: () => void;
}

/** A list the server pages with an opaque cursor. Changing `deps` (filters)
 * starts again from the first page; a failed "load more" never clears what's
 * already on screen. */
export function useServerPage<T>(fetchPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>, deps: unknown[]): ServerPaged<T> {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const seq = useRef(0);
  const reload = useCallback(() => {
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    setMoreFailed(false);
    fetchRef
      .current(null)
      .then((p) => {
        if (n !== seq.current) return;
        setItems(p.items);
        setCursor(p.nextCursor);
      })
      .catch((e) => n === seq.current && setError(e))
      .finally(() => n === seq.current && setLoading(false));
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, deps);
  const loadMore = useCallback(() => {
    if (!cursor) return;
    const n = seq.current;
    setLoadingMore(true);
    setMoreFailed(false);
    fetchRef
      .current(cursor)
      .then((p) => {
        if (n !== seq.current) return;
        setItems((prev) => [...prev, ...p.items]);
        setCursor(p.nextCursor);
      })
      .catch(() => n === seq.current && setMoreFailed(true))
      .finally(() => setLoadingMore(false));
  }, [cursor]);
  return { items, loading, error, hasMore: !!cursor, loadingMore, moreFailed, loadMore, reload };
}

/** Debounced text for server searches (so each keystroke isn't a request). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

// --- table selection and row options (2026-10-20) ------------------------------
// Owner: every table row has a ⋯ options menu; tables whose rows share a real
// action (one that exists today, called once per row) also get checkboxes,
// select-all and a bulk bar. Nothing here adds a server action.

/** Selected row keys for one table. `pageKeys` are the selectable rows shown. */
export function useRowSelection(pageKeys: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const keyStr = pageKeys.join("|");
  // Rows that disappear (filtered, decided, deleted) leave the selection.
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((k) => pageKeys.includes(k)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyStr]);
  const allSelected = pageKeys.length > 0 && pageKeys.every((k) => selected.has(k));
  return {
    selected,
    count: selected.size,
    has: (k: string) => selected.has(k),
    toggle: (k: string) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        return next;
      }),
    toggleAll: () => setSelected(allSelected ? new Set() : new Set(pageKeys)),
    clear: () => setSelected(new Set()),
    allSelected,
    someSelected: selected.size > 0 && !allSelected,
  };
}
export type RowSelection = ReturnType<typeof useRowSelection>;

export function SelectAllHeader({ sel, label }: { sel: RowSelection; label: string }) {
  return (
    <th scope="col" className="adm-col-check">
      <input
        type="checkbox"
        className="adm-check"
        checked={sel.allSelected}
        ref={(el) => {
          if (el) el.indeterminate = sel.someSelected;
        }}
        onChange={sel.toggleAll}
        aria-label={label}
      />
    </th>
  );
}

export function SelectCell({ sel, rowKey, label, disabled }: { sel: RowSelection; rowKey: string; label: string; disabled?: boolean }) {
  return (
    <td className="adm-col-check" onClick={(e) => e.stopPropagation()}>
      {!disabled && <input type="checkbox" className="adm-check" checked={sel.has(rowKey)} onChange={() => sel.toggle(rowKey)} aria-label={label} />}
    </td>
  );
}

/** The dark bar that appears once rows are selected. */
export function BulkBar({ sel, noun, children }: { sel: RowSelection; noun: string; children: ReactNode }) {
  if (!sel.count) return null;
  return (
    <div className="adm-bulk" role="region" aria-label="Bulk actions">
      <span aria-live="polite">
        {sel.count} {noun}
        {sel.count === 1 ? "" : "s"} selected
      </span>
      {children}
      <AdminButton variant="quiet" size="sm" onClick={sel.clear}>
        Clear
      </AdminButton>
    </div>
  );
}

/** A row's ⋯ options: its existing actions, then "Copy reference". */
export function RowMenu({ name, items = [], copy }: { name: string; items?: MenuAction[]; copy?: { label?: string; value: string } }) {
  const all: MenuAction[] = [
    ...items,
    ...(copy
      ? [
          {
            label: copy.label ?? "Copy reference",
            onSelect: () => {
              navigator.clipboard?.writeText(copy.value).catch(() => undefined);
            },
          },
        ]
      : []),
  ];
  if (!all.length) return null;
  return <OverflowMenu label={`More actions for ${name}`} actions={all} />;
}
