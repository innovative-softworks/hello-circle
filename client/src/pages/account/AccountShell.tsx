import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Avatar, NavSidebar } from "../../components/ui";
import { useDashboardNav } from "../../DashboardNavContext";
import { useGuest } from "../../GuestContext";
import { ACCOUNT_HELP, accountHref, type AccountSectionDef, type AccountSectionKey } from "./accountSections";
import { useConfirmLeave } from "./accountUi";
import "./account.css";

// The account area's frame (account redesign 2026-10-24). Replaces
// ManageShell here — that one is the operational-dashboard shell (burger
// registration, uppercase mono rail title, fade-in) and made a resident's own
// settings look like a back office. Desktop: compact identity + a flat settings nav
// rail beside the page. Phones: no sidebar; /profile with no ?tab= is the
// account home (identity + every section as a row), and each page carries
// its own "‹ Account" back link (AccountPage).

function memberSince(createdAt?: string | null): string | null {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-IE", { month: "long", year: "numeric" });
}

function useGuardedNav() {
  const navigate = useNavigate();
  const confirmLeave = useConfirmLeave();
  return async (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (await confirmLeave()) navigate(href);
  };
}

function identityMeta(county?: string | null, createdAt?: string | null): string {
  const since = memberSince(createdAt);
  return [county || null, since ? `Member since ${since}` : null].filter(Boolean).join(" · ");
}

export function AccountShell({
  sections,
  active,
  showHome,
  children,
}: {
  sections: AccountSectionDef[];
  active: AccountSectionKey;
  /** Phones only: render the account home instead of a page. */
  showHome: boolean;
  children: ReactNode;
}) {
  const { resident } = useGuest();
  const go = useGuardedNav();
  const navigate = useNavigate();
  const confirmLeave = useConfirmLeave();
  const name = resident?.name || "Your account";
  const meta = identityMeta(resident?.homeCounty, resident?.createdAt);

  // Restored (owner 2026-10-24): the header's menu button opens the account
  // sections as a full-screen menu on smaller screens, as it did before.
  const [menuOpen, setMenuOpen] = useState(false);
  const { setOpenNav } = useDashboardNav();
  useEffect(() => {
    setOpenNav(() => setMenuOpen(true));
    return () => setOpenNav(null);
  }, [setOpenNav]);
  const menuOptions = sections.map((s) => {
    const Icon = s.icon;
    return { key: s.key, label: s.label, icon: <Icon size={17} strokeWidth={1.9} aria-hidden="true" /> };
  });

  return (
    <div className="acct">
      <NavSidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Settings"
        options={menuOptions}
        value={active}
        onChange={async (key) => {
          setMenuOpen(false);
          if (await confirmLeave()) navigate(accountHref(key));
        }}
      />
      <div className="acct-grid">
        <aside className="acct-rail" aria-label="Account">
          <Link to={accountHref("account")} className="acct-id" onClick={(e) => go(e, accountHref("account"))} aria-label={`${name}, your profile`}>
            <Avatar name={resident?.name || "?"} src={resident?.avatarUrl} size={44} />
            <span style={{ minWidth: 0 }}>
              <span className="acct-id-name" style={{ display: "block" }}>{name}</span>
              {resident?.email && <span className="acct-id-meta" style={{ display: "block", overflowWrap: "anywhere" }}>{resident.email}</span>}
              {meta && <span className="acct-id-meta" style={{ display: "block" }}>{meta}</span>}
            </span>
          </Link>
          <nav className="acct-nav" aria-label="Settings">
            <ul>
              {[...sections, ACCOUNT_HELP].map((s) => {
                const Icon = s.icon;
                const href = accountHref(s.key);
                return (
                  <li key={s.key} className={s.key === ACCOUNT_HELP.key ? "acct-nav-foot" : undefined}>
                    <Link to={href} className="acct-nav-link" aria-current={s.key === active ? "page" : undefined} onClick={(e) => go(e, href)}>
                      <Icon size={17} strokeWidth={1.9} aria-hidden="true" />
                      {s.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        <div style={{ minWidth: 0 }}>{showHome ? <AccountHome sections={sections} name={name} meta={meta} /> : children}</div>
      </div>
    </div>
  );
}

function AccountHome({ sections, name, meta }: { sections: AccountSectionDef[]; name: string; meta: string }) {
  const { resident } = useGuest();
  return (
    <div>
      <div className="acct-home-id">
        <Avatar name={resident?.name || "?"} src={resident?.avatarUrl} size={60} />
        <div style={{ minWidth: 0 }}>
          <h1>{name}</h1>
          {resident?.email && <div className="acct-id-meta" style={{ fontSize: 13.5, overflowWrap: "anywhere" }}>{resident.email}</div>}
          {meta && <div className="acct-id-meta" style={{ fontSize: 13.5 }}>{meta}</div>}
          <Link to={accountHref("account")} className="acct-text-btn" style={{ paddingLeft: 0, minHeight: 36 }}>
            Edit profile
          </Link>
        </div>
      </div>
      {[sections, [ACCOUNT_HELP]].map((items, i) => (
        <ul key={i} className="acct-home-list" style={i ? { marginTop: 24 } : undefined} aria-label={i ? "Help" : "Settings"}>
          {items.map((s) => {
            const Icon = s.icon;
            return (
              <li key={s.key}>
                <Link to={accountHref(s.key)} className="acct-home-row">
                  <Icon size={20} strokeWidth={1.9} aria-hidden="true" />
                  <span style={{ minWidth: 0 }}>
                    <span className="acct-home-row-label" style={{ display: "block" }}>{s.label}</span>
                    <span className="acct-home-row-hint" style={{ display: "block" }}>{s.hint}</span>
                  </span>
                  <ChevronRight size={18} className="acct-home-row-chev" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      ))}
    </div>
  );
}
