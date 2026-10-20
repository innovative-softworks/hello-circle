import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Lock, Menu, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useDashboardNav } from "../../DashboardNavContext";
import { PageHeader } from "../admin/adminUi";
import "@fontsource-variable/inter";
import "../admin/admin.css";
import { InWorkspaceContext, WorkspacePageSubtitleContext, WorkspacePageTitleContext } from "./inWorkspace";

// Approved cream workspace shell (2026-10-14) for the Partner (/vendor) and
// Host (/manage, /manage/circles/:id) workspaces — the same strip, grouped
// sidebar, Sections sheet, page header and compact footer the admin
// workspace uses (AdminShell), driven by the caller's own nav items instead
// of the admin catalogue. Older tab content renders inside `.adm`, where
// admin.css already squares and re-borders the legacy primitives.

/** A record page inside a workspace tool (e.g. one listing) renders its own
 * page header (record name as the single H1, breadcrumb back to the list,
 * record actions); while it's mounted the shell hides its tool header. */
const HeaderContext = createContext<{ workspaceLabel: string; toolLabel: string; setRecordShown: (shown: boolean) => void } | null>(null);

export function useRecordHeader() {
  const ctx = useContext(HeaderContext);
  const set = ctx?.setRecordShown;
  useEffect(() => {
    if (!set) return;
    set(true);
    return () => set(false);
  }, [set]);
  return { workspaceLabel: ctx?.workspaceLabel ?? "Workspace", toolLabel: ctx?.toolLabel ?? "" };
}

export interface WorkspaceNavItem<T extends string> {
  key: T;
  label: string;
  icon?: ReactNode;
  /** Sidebar group heading; items without one go under `defaultGroup`. */
  group?: string;
  /** Small count badge, e.g. unread messages. */
  count?: number;
  /** Shown but not usable by this person (e.g. outside their admin role). */
  locked?: boolean;
}

function readCollapsed(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeCollapsed(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {
    /* storage unavailable — the toggle still works for this visit */
  }
}

function groupsOf<T extends string>(items: WorkspaceNavItem<T>[], defaultGroup: string) {
  const groups: { label: string; items: WorkspaceNavItem<T>[] }[] = [];
  for (const item of items) {
    const label = item.group ?? defaultGroup;
    let g = groups.find((x) => x.label === label);
    if (!g) groups.push((g = { label, items: [] }));
    g.items.push(item);
  }
  return groups;
}

function NavList<T extends string>({ items, defaultGroup, active, onSelect, collapsed = false, idPrefix, countLabel }: { items: WorkspaceNavItem<T>[]; defaultGroup: string; active: T; onSelect: (k: T) => void; collapsed?: boolean; idPrefix: string; countLabel: string }) {
  return (
    <>
      {groupsOf(items, defaultGroup).map((group) => {
        const headingId = `${idPrefix}-${group.label.replace(/\W+/g, "-")}`;
        return (
          <div className="adm-nav-group" key={group.label}>
            <p className="adm-nav-heading" id={headingId}>
              {group.label}
            </p>
            <ul className="adm-nav-list" aria-labelledby={headingId}>
              {group.items.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    className="adm-nav-item"
                    aria-current={active === item.key ? "page" : undefined}
                    data-locked={item.locked || undefined}
                    data-tip={collapsed ? `${item.label}${item.locked ? " (not included in your role)" : item.count ? ` (${item.count})` : ""}` : undefined}
                    data-tip-side="right"
                    onClick={() => onSelect(item.key)}
                  >
                    {item.icon}
                    <span className="adm-nav-label">{item.label}</span>
                    {item.locked ? (
                      <span className="adm-nav-lock" title="Not included in your role">
                        <Lock size={14} strokeWidth={1.9} aria-hidden="true" />
                        <span className="adm-visually-hidden"> (not included in your role)</span>
                      </span>
                    ) : item.count ? (
                      <span className="adm-nav-count">
                        {item.count}
                        <span className="adm-visually-hidden"> {countLabel}</span>
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

function SectionSheet({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const restore = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => ref.current?.querySelector<HTMLElement>("[aria-current='page']")?.focus(), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
      if (e.key !== "Tab" || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>("button, a[href]"));
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (i === -1 || (e.shiftKey && i === 0) || (!e.shiftKey && i === items.length - 1)) {
        e.preventDefault();
        items[e.shiftKey ? items.length - 1 : 0]?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      if (restore && document.contains(restore)) restore.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <>
      <div className="adm-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={ref} className="adm-sheet" role="dialog" aria-modal="true" aria-label={label}>
        <div className="adm-sheet-head">
          <span>{label}</span>
          <button type="button" className="adm-btn adm-btn--quiet" onClick={onClose} aria-label="Close sections" data-tip="Close sections" data-tip-side="bottom">
            <X size={18} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>
        <nav aria-label={label}>{children}</nav>
      </div>
    </>,
    document.body
  );
}

export function WorkspaceShell<T extends string>({
  workspaceLabel,
  account,
  externalLink,
  navItems,
  defaultGroup = "Workspace",
  active,
  onNavigate,
  title,
  subtitle,
  crumbs,
  actions,
  collapseKey = "hc_workspace_sidebar_collapsed",
  countLabel = "new",
  children,
}: {
  /** Strip label, e.g. "Partner workspace". Also the first breadcrumb. */
  workspaceLabel: string;
  /** Who is signed in, e.g. "Owner · Rathmines Hall · jo@example.ie". */
  account: string;
  /** Strip link, e.g. the public profile. Defaults to "View platform". */
  externalLink?: { label: string; to: string; newTab?: boolean };
  navItems: WorkspaceNavItem<T>[];
  defaultGroup?: string;
  active: T;
  onNavigate: (key: T) => void;
  title: string;
  subtitle?: ReactNode;
  /** Defaults to workspace › group › page. */
  crumbs?: { label: string; onClick?: () => void }[];
  actions?: ReactNode;
  /** localStorage key for the collapsed-sidebar preference. */
  collapseKey?: string;
  /** Screen-reader word after a nav count, e.g. "new" or "waiting". */
  countLabel?: string;
  children: ReactNode;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [recordShown, setRecordShown] = useState(false);
  const [collapsed, setCollapsed] = useState(() => readCollapsed(collapseKey));
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      writeCollapsed(collapseKey, !c);
      return !c;
    });
  const { setOpenNav, setWorkspace } = useDashboardNav();
  useEffect(() => {
    setOpenNav(() => setSheetOpen(true));
    return () => setOpenNav(null);
  }, [setOpenNav]);
  // The workspace name, account line, "View platform" and the collapse toggle
  // live in the global header (2026-10-16), not in a strip under it.
  const link = externalLink ?? { label: "View platform", to: "/" };
  useEffect(() => {
    setWorkspace({ label: workspaceLabel, account, link, collapsed, onToggleCollapse: toggleCollapsed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceLabel, account, link.label, link.to, link.newTab, collapsed, setWorkspace]);
  useEffect(() => () => setWorkspace(null), [setWorkspace]);
  // Dialogs and menus opened from the workspace are portaled to <body>; this
  // class gives them the workspace's corner tokens too (admin.css).
  useEffect(() => {
    document.body.classList.add("in-workspace");
    return () => document.body.classList.remove("in-workspace");
  }, []);

  const go = (k: T) => {
    setSheetOpen(false);
    onNavigate(k);
  };
  const first = navItems[0]?.key;
  const activeItem = navItems.find((i) => i.key === active);
  const defaultCrumbs = [
    { label: workspaceLabel, onClick: first !== undefined && active !== first ? () => go(first) : undefined },
    ...(activeItem?.group ? [{ label: activeItem.group }] : []),
    { label: title },
  ];
  const headerCtx = useMemo(() => ({ workspaceLabel, toolLabel: title, setRecordShown }), [workspaceLabel, title]);
  const sectionsLabel = `${workspaceLabel} sections`;

  return (
    <div className="adm ws">
      <div className="adm-layout" data-collapsed={collapsed || undefined}>
        <aside className="adm-side">
          <nav aria-label={sectionsLabel} id="ws-side-nav">
            <NavList items={navItems} defaultGroup={defaultGroup} active={active} onSelect={go} collapsed={collapsed} idPrefix="ws-nav" countLabel={countLabel} />
          </nav>
        </aside>

        <div className="adm-main">
          <div className="adm-mobile-nav">
            <button type="button" className="adm-btn" onClick={() => setSheetOpen(true)} aria-haspopup="dialog">
              <Menu size={18} strokeWidth={1.9} aria-hidden="true" /> Sections
            </button>
          </div>
          {!recordShown && <PageHeader title={title} subtitle={subtitle} crumbs={crumbs ?? defaultCrumbs} actions={actions} />}
          <HeaderContext.Provider value={headerCtx}>
            <InWorkspaceContext.Provider value={true}>
              <WorkspacePageTitleContext.Provider value={title}>
                <WorkspacePageSubtitleContext.Provider value={typeof subtitle === "string" ? subtitle : null}>{children}</WorkspacePageSubtitleContext.Provider>
              </WorkspacePageTitleContext.Provider>
            </InWorkspaceContext.Provider>
          </HeaderContext.Provider>
        </div>
      </div>

      <footer className="adm-footer">
        <div className="adm-footer-inner">
          <span>© {new Date().getFullYear()} HelloCircle · {workspaceLabel}</span>
          <nav aria-label={`${workspaceLabel} footer`}>
            <Link to="/">View platform</Link>
            <Link to="/contact">Help &amp; contact</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/cookies">Cookies</Link>
          </nav>
        </div>
      </footer>

      <SectionSheet open={sheetOpen} onClose={() => setSheetOpen(false)} label={sectionsLabel}>
        <NavList items={navItems} defaultGroup={defaultGroup} active={active} onSelect={go} idPrefix="ws-sheet" countLabel={countLabel} />
      </SectionSheet>
    </div>
  );
}
