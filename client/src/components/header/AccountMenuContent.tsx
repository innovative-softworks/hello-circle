import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeftRight, Bell, Building2, ClipboardCheck, Heart, LayoutDashboard, LogOut, MessageCircle, Moon, Settings, Sun, Ticket, UserRound, UsersRound, type LucideIcon } from "lucide-react";
import type { ManageWorkspaces } from "../../api/manage";
import { accountItemKeys, type AccountItemKey } from "../../navigation/navConfig";
import { colors } from "../../theme";
import type { AuthUser, Resident } from "../../types";
import { Avatar } from "../ui";
import { NOTIFICATIONS_INBOX } from "./NotificationsList";
import { ICON_STROKE, countLabel, dividerStyle, inlineCountStyle, menuLabelStyle } from "./headerStyles";

// The account menu's content — rendered in the desktop avatar dropdown and in
// the mobile Account & More sheet, so the two never disagree. Which items a
// session gets comes from navConfig.accountItemKeys(); the destinations keep
// enforcing their own access (requireVendor / requireAdmin / resident routes).

export interface AccountMenuProps {
  user: AuthUser | null;
  resident: Resident | null;
  guestEmail: string | null;
  workspaces: ManageWorkspaces | null;
  hasHostedGames: boolean;
  myLifeCount: number;
  chatUnread: number;
  unreadNotifs: number;
  businessCount: number;
  resolvedTheme: "light" | "dark";
  onToggleTheme: () => void;
  onSwitchVendor: () => void;
  onSwitchPersonal: () => void;
  onSignOut: () => void;
  onNavigate: () => void;
  /** Extra rows before the theme/sign-out rows (the mobile sheet adds Suggest a place, Help…). */
  extra?: ReactNode;
}

const Icon = ({ icon: I }: { icon: LucideIcon }) => (
  <span className="hc-row-icon" aria-hidden="true">
    <I size={20} strokeWidth={ICON_STROKE} />
  </span>
);

function Row({ to, icon, children, count, onNavigate }: { to: string; icon: LucideIcon; children: ReactNode; count?: number; onNavigate: () => void }) {
  return (
    <Link className="hc-menu-row" to={to} onClick={onNavigate}>
      <Icon icon={icon} />
      {children}
      {!!count && count > 0 && <span style={inlineCountStyle}>{countLabel(count)}</span>}
    </Link>
  );
}

export function AccountMenuContent(p: AccountMenuProps) {
  const { user, resident, workspaces } = p;
  const keys = accountItemKeys({
    resident: !!resident,
    role: user?.role === "vendor" || user?.role === "admin" ? user.role : null,
    vendorApproved: user?.status === "approved",
    vendorLinkedResident: !!user?.residentId,
    linkedVendor: workspaces?.vendor ? (workspaces.vendor.status === "approved" ? "approved" : "pending") : null,
    hasHosted: p.hasHostedGames,
    organisedCircles: workspaces?.circlesOrganising.length ?? 0,
  });
  const has = (k: AccountItemKey) => keys.includes(k);
  const name = resident?.name || user?.name || "";
  const email = resident?.email || user?.email || p.guestEmail || "";
  const signedIn = !!user || !!p.guestEmail;
  const nav = p.onNavigate;
  const personal = has("my-life") || has("saved") || has("messages");
  const work = has("manage-hosting") || has("switch-to-vendor") || has("vendor-pending") || has("vendor-dashboard") || has("admin-dashboard") || has("switch-to-personal");

  return (
    <div>
      {signedIn && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px 12px" }}>
          <Avatar name={name || email || "?"} size={44} src={resident?.avatarUrl ?? null} />
          <div style={{ minWidth: 0 }}>
            {name && <div style={{ fontWeight: 700, fontSize: 15, color: colors.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>}
            {email && <div style={{ fontSize: 12.5, color: colors.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email}</div>}
            {has("profile") && (
              <Link to="/profile?tab=account" className="hc-text-link" onClick={nav}>
                View profile
              </Link>
            )}
          </div>
        </div>
      )}

      {personal && <div style={dividerStyle} />}
      {has("my-life") && <Row to="/bookings" icon={UserRound} count={p.myLifeCount} onNavigate={nav}>My Life</Row>}
      {has("my-bookings") && <Row to="/bookings#my-bookings" icon={Ticket} onNavigate={nav}>My bookings</Row>}
      {has("my-circles") && <Row to="/bookings#my-circles" icon={UsersRound} onNavigate={nav}>My Circles</Row>}
      {has("saved") && <Row to="/profile?tab=favourites" icon={Heart} onNavigate={nav}>Saved</Row>}
      {has("notifications") && <Row to={NOTIFICATIONS_INBOX} icon={Bell} count={p.unreadNotifs} onNavigate={nav}>Notifications</Row>}
      {has("messages") && <Row to="/chats" icon={MessageCircle} count={p.chatUnread} onNavigate={nav}>Messages</Row>}
      {has("settings") && <Row to="/profile?tab=preferences" icon={Settings} onNavigate={nav}>Settings</Row>}

      {work && (
        <>
          <div style={dividerStyle} />
          <div style={menuLabelStyle}>Manage</div>
        </>
      )}
      {has("manage-hosting") && <Row to="/manage" icon={LayoutDashboard} onNavigate={nav}>Manage hosting</Row>}
      {has("manage-circles") &&
        workspaces?.circlesOrganising.map((c) => (
          <Row key={c.id} to={`/manage/circles/${c.slug ?? c.id}`} icon={UsersRound} onNavigate={nav}>
            Manage {c.name}
          </Row>
        ))}
      {has("switch-to-vendor") && (
        <button type="button" className="hc-menu-row" onClick={p.onSwitchVendor}>
          <Icon icon={ArrowLeftRight} />
          Switch to {workspaces?.vendor?.businessName || "your vendor account"}
        </button>
      )}
      {has("vendor-pending") && (
        <div className="hc-menu-row" style={{ cursor: "default", color: colors.mutedLight, fontSize: 13, fontWeight: 500 }}>
          <Icon icon={Building2} />
          {workspaces?.vendor?.businessName || "Vendor account"} — awaiting approval
        </div>
      )}
      {has("vendor-dashboard") && (
        <Row to="/vendor" icon={Building2} onNavigate={nav}>
          {user?.businessName || "Vendor dashboard"}
          {user?.status !== "approved" && <span style={{ fontSize: 12, fontWeight: 500, color: colors.mutedLight }}>· awaiting approval</span>}
        </Row>
      )}
      {/* Header audit P1-4: pending/rejected listings are listing work, not
          "notifications" — named for what they are, linked to that tab. */}
      {has("vendor-listings") && p.businessCount > 0 && (
        <Row to="/vendor?tab=listings" icon={ClipboardCheck} count={p.businessCount} onNavigate={nav}>
          Listings needing attention
        </Row>
      )}
      {has("switch-to-personal") && (
        <button type="button" className="hc-menu-row" onClick={p.onSwitchPersonal}>
          <Icon icon={ArrowLeftRight} />
          Switch to Personal
        </button>
      )}
      {has("admin-dashboard") && <Row to="/admin" icon={LayoutDashboard} onNavigate={nav}>Admin dashboard</Row>}
      {has("admin-pending") && (
        <Row to="/admin?tab=pending" icon={ClipboardCheck} count={p.businessCount} onNavigate={nav}>
          Pending approvals
        </Row>
      )}

      {p.extra}

      <div style={dividerStyle} />
      <button type="button" className="hc-menu-row" onClick={p.onToggleTheme}>
        <Icon icon={p.resolvedTheme === "dark" ? Sun : Moon} />
        {p.resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
      </button>
      {signedIn && (
        <button type="button" className="hc-menu-row" onClick={p.onSignOut}>
          <Icon icon={LogOut} />
          Sign out
        </button>
      )}
    </div>
  );
}
