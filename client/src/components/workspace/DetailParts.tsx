import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, ImageOff, type LucideIcon } from "lucide-react";
import { useUrlParam } from "../../useUrlTab";
import { detailIcon, type DetailTone } from "./detailIcons";

/** A small tinted icon tile; the icon and colour follow the label unless given. */
export function DetailIcon({ label, icon, tone, size = "md" }: { label: string; icon?: LucideIcon; tone?: DetailTone; size?: "sm" | "md" }) {
  const auto = detailIcon(label);
  const Icon = icon ?? auto.Icon;
  return (
    <span className="wd-ico" data-tone={tone ?? auto.tone} data-size={size} aria-hidden="true">
      <Icon size={size === "sm" ? 13 : 16} strokeWidth={2} />
    </span>
  );
}

// Detail-page template parts (2026-10-20). A record page is RecordView with an
// `aside`: the left 70% holds the header, an optional hero, optional tabs and
// DetailSections divided by thin lines; the right 30% is a compact context
// panel of ContextSections. Each record type composes only the parts it needs.

/** A titled block in the main column. Sections are separated by a rule, not boxed. */
export function DetailSection({
  title,
  action,
  children,
  id,
  note,
  icon,
  tone,
}: {
  title: string;
  /** Overrides the icon picked from the title; false hides it. */
  icon?: LucideIcon | false;
  tone?: DetailTone;
  /** A contextual action for this section (Edit, Add, View all). */
  action?: ReactNode;
  children: ReactNode;
  id?: string;
  /** One line under the heading. */
  note?: ReactNode;
}) {
  return (
    <section className="wd-sec" id={id} aria-label={title}>
      <div className="wd-sec-head">
        <h2 className="wd-sec-title">
          {icon !== false && <DetailIcon label={title} icon={icon || undefined} tone={tone} />}
          {title}
        </h2>
        {action && <div className="wd-sec-action">{action}</div>}
      </div>
      {note && <p className="wd-sec-note">{note}</p>}
      {children}
    </section>
  );
}

/** Label / value pairs. Empty values are left out rather than shown as dashes. */
export function DetailFacts({ rows, columns = 2 }: { rows: [string, ReactNode][]; columns?: 1 | 2 }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== false);
  if (!shown.length) return null;
  return (
    <dl className="wd-facts" data-columns={columns}>
      {shown.map(([k, v]) => (
        <div key={k} className="wd-fact">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A compact panoramic image with previous/next when there are several.
 * Without images it shows a restrained empty state, never a stock picture. */
export function DetailHero({
  images,
  name,
  emptyLabel = "No photos yet",
  emptyAction,
  icon: EmptyIcon = ImageOff,
  variant = "wide",
}: {
  /** Ready-to-use image URLs, cover first. */
  images: string[];
  /** The record's name, for alt text. */
  name: string;
  emptyLabel?: string;
  emptyAction?: ReactNode;
  icon?: LucideIcon;
  /** "panel": a 4:3 photo at the top of the context panel instead of a wide strip. */
  variant?: "wide" | "panel";
}) {
  const [at, setAt] = useState(0);
  const count = images.length;
  useEffect(() => setAt(0), [images.join("|")]);
  if (!count) {
    return (
      <div className="wd-hero wd-hero--empty" data-variant={variant}>
        <EmptyIcon size={22} strokeWidth={1.7} aria-hidden="true" />
        <span>{emptyLabel}</span>
        {emptyAction}
      </div>
    );
  }
  const go = (d: number) => setAt((i) => (i + d + count) % count);
  const onKey = (e: KeyboardEvent) => {
    if (count < 2) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
    }
  };
  return (
    <section className="wd-hero" data-variant={variant} aria-roledescription="carousel" aria-label={`Photos of ${name}`} onKeyDown={onKey}>
      <img src={images[at]} alt={at === 0 ? `Cover photo for ${name}` : `Photo ${at + 1} of ${count} for ${name}`} />
      {count > 1 && (
        <>
          <button type="button" className="wd-hero-nav" data-side="prev" onClick={() => go(-1)} aria-label="Previous photo" data-tip="Previous photo" data-tip-align="center">
            <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <button type="button" className="wd-hero-nav" data-side="next" onClick={() => go(1)} aria-label="Next photo" data-tip="Next photo" data-tip-align="center">
            <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <span className="wd-hero-count" aria-live="polite">
            {at + 1} / {count}
          </span>
        </>
      )}
    </section>
  );
}

export interface DetailStat {
  label: string;
  /** Overrides the icon and colour picked from the label. */
  icon?: LucideIcon;
  tone?: DetailTone;
  value: ReactNode;
  /** A short qualifier under the value ("12 reviews", "next 30 days"). */
  sub?: ReactNode;
}

/** The record's key numbers, in one strip under the header. Values must come
 * from real data; pass "—" or a plain phrase when there is nothing yet. */
export function DetailStats({ items, label = "Key numbers" }: { items: DetailStat[]; label?: string }) {
  if (!items.length) return null;
  return (
    <dl className="wd-stats" aria-label={label}>
      {items.map((it) => (
        <div key={it.label} className="wd-stat" data-tone={it.tone ?? detailIcon(it.label).tone}>
          <dt>
            <DetailIcon label={it.label} icon={it.icon} tone={it.tone} size="sm" />
            {it.label}
          </dt>
          <dd>
            <span className="wd-stat-value">{it.value}</span>
            {it.sub && <span className="wd-stat-sub">{it.sub}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface DetailTab<K extends string> {
  key: K;
  label: string;
  /** A count shown after the label. */
  count?: number;
}

/** The record's own tab, kept in the URL (`?rtab=`) so Back and sharing keep it. */
export function useDetailTab<K extends string>(keys: readonly K[], fallback: K): [K, (k: K) => void] {
  const [raw, set] = useUrlParam<string>("rtab", fallback);
  const value = (keys as readonly string[]).includes(raw) ? (raw as K) : fallback;
  return [value, set as (k: K) => void];
}

/** Underline tabs with arrow-key movement (WAI-ARIA tabs pattern). The panel
 * for the active tab is rendered by the caller inside <DetailTabPanel>. */
export function DetailTabs<K extends string>({ label, tabs, value, onChange, idBase = "rtab" }: { label: string; tabs: DetailTab<K>[]; value: K; onChange: (k: K) => void; idBase?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const last = tabs.length - 1;
    const to = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(tabs[to].key);
    refs.current[to]?.focus();
  };
  return (
    <div className="wd-tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.key}
          ref={(el) => (refs.current[i] = el)}
          type="button"
          role="tab"
          id={`${idBase}-${t.key}`}
          aria-selected={value === t.key}
          aria-controls={`${idBase}-panel`}
          tabIndex={value === t.key ? 0 : -1}
          className="wd-tab"
          onClick={() => onChange(t.key)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
          {t.count !== undefined && <span className="wd-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function DetailTabPanel({ active, children, idBase = "rtab" }: { active: string; children: ReactNode; idBase?: string }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel`} aria-labelledby={`${idBase}-${active}`} className="wd-tabpanel">
      {children}
    </div>
  );
}

// --- context panel (right 30%) ---------------------------------------------

/** One block of the context panel: a small heading, then facts or actions. */
export function ContextSection({ title, action, children, icon }: { title: string; action?: ReactNode; children: ReactNode; icon?: LucideIcon | false }) {
  return (
    <section className="wd-ctx" aria-label={title}>
      <div className="wd-ctx-head">
        <h2 className="wd-ctx-title">
          {icon !== false && <DetailIcon label={title} icon={icon || undefined} size="sm" />}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A value with a copy button (ids, references). */
export function CopyValue({ value, label = "reference" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions); the value stays selectable.
    }
  };
  return (
    <span className="wd-copy">
      <span className="adm-mono">{value}</span>
      <button type="button" className="wd-copy-btn" onClick={copy} aria-label={copied ? `Copied ${label}` : `Copy ${label}`} data-tip={copied ? "Copied" : `Copy ${label}`}>
        {copied ? <Check size={14} strokeWidth={2.2} aria-hidden="true" /> : <Copy size={14} strokeWidth={1.9} aria-hidden="true" />}
      </button>
      <span className="adm-visually-hidden" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </span>
  );
}

export interface ContextAction {
  label: string;
  icon?: LucideIcon;
  onSelect?: () => void;
  /** A link (public page, external) instead of a button. */
  href?: string;
  external?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** Shown as aria-pressed (on/off actions such as Feature). */
  pressed?: boolean;
}

/** A short list of management actions. Pass only actions the viewer may perform. */
export function ContextActions({ actions }: { actions: ContextAction[] }) {
  if (!actions.length) return null;
  return (
    <ul className="wd-actions">
      {actions.map((a) => {
        const Icon = a.icon;
        const inner = (
          <>
            {Icon && <Icon size={16} strokeWidth={1.9} aria-hidden="true" />}
            <span>{a.label}</span>
          </>
        );
        return (
          <li key={a.label}>
            {a.href ? (
              <a className="wd-action" href={a.href} target={a.external ? "_blank" : undefined} rel={a.external ? "noreferrer" : undefined} data-danger={a.danger || undefined}>
                {inner}
              </a>
            ) : (
              <button type="button" className="wd-action" onClick={a.onSelect} disabled={a.disabled} aria-pressed={a.pressed} data-danger={a.danger || undefined}>
                {inner}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
