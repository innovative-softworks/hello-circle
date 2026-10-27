import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { EXPLORE_LEARN, EXPLORE_PATHS, EXPLORE_PLACES, EXPLORE_PLACES_SOON, EXPLORE_THINGS, FREE_TIME_ITEM, START_GROUPS, START_PATHS, isUnder, visibleItems, type NavContext, type NavItem } from "../navigation/navConfig";
import { Compass, House, Plus, UserRound, UsersRound } from "lucide-react";
import { ICON_STROKE } from "./header/headerStyles";
import { Drawer } from "./ui";
import { useMyStuff } from "../MyStuffContext";
import { colors, radius } from "../theme";
import { useOpenBookingOpen } from "../paidCheckout";
import { VENUE_PAGES_PUBLIC } from "../venueLaunch";

// IA spec five-layer audit's single highest-leverage remaining gap: mobile
// nav was a hamburger-triggered drawer, a genuinely different pattern from
// the spec's persistent 5-item bottom tab bar (Home/Explore/Create/Circles/
// My Life), not a smaller version of the same one — see
// [[ia-spec-five-layer]] memory. This is that bar. Only rendered/visible at
// the same <=860px breakpoint the header's own hamburger cutover already
// uses (`.mobile-tab-bar` in index.css) — untouched above that width, where
// Header.tsx's desktop nav already covers all five destinations.
//
// "Explore" and "Create" open a Drawer sheet rather than navigating
// directly, since each covers several real destinations (matches the
// header's existing Explore dropdown for browsing; Create is new — the
// audit's own "no unifying Create hub" finding, addressed here since the
// tab needs *something* behind it to be more than a label). Home/Circles/
// My Life navigate directly, same as the header's desktop nav.

const itemButtonStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 3,
  flex: 1,
  background: "none",
  border: "none",
  padding: "6px 4px",
  fontSize: 10.5,
  fontWeight: 700,
  cursor: "pointer",
};

const sheetItemStyle: React.CSSProperties = {
  display: "flex",
  textDecoration: "none",
  alignItems: "center",
  gap: 12,
  width: "100%",
  background: colors.panel,
  border: "none",
  borderRadius: 10,
  padding: "14px 16px",
  fontSize: 15,
  fontWeight: 600,
  color: colors.text,
  textAlign: "left",
  cursor: "pointer",
  marginBottom: 8,
};

const sheetGroupLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: colors.muted,
  textTransform: "uppercase",
  letterSpacing: 0,
  padding: "4px 2px 8px",
};

// HC-QA-070 — a tab that navigates exposes aria-current="page" when it IS the
// current page; a tab that opens a sheet exposes its expanded state instead.
function TabButton({ icon, label, active, badge, onClick, current, expanded }: { icon: ReactNode; label: string; active: boolean; badge?: number; onClick: () => void; current?: boolean; expanded?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? "page" : undefined}
      aria-expanded={expanded}
      aria-haspopup={expanded === undefined ? undefined : "dialog"}
      style={{ ...itemButtonStyle, color: active ? colors.orange : colors.textSoft, position: "relative", transition: "color 150ms ease" }}
    >
      {icon}
      {label}
      {!!badge && (
        <span
          style={{
            position: "absolute",
            top: 0,
            right: "22%",
            background: colors.orange,
            color: "#fff",
            borderRadius: radius.pill,
            fontSize: 9,
            fontWeight: 700,
            minWidth: 14,
            height: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 3px",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

export function MobileTabBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { count } = useMyStuff();
  const { user } = useAuth();
  const [exploreOpen, setExploreOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // "/" is Home too once the launch gate is open (App.tsx); while gated it is
  // the vendor pitch, so the Home tab mustn't light up there.
  const openBooking = useOpenBookingOpen();
  const navCtx: NavContext = { venuesPublic: VENUE_PAGES_PUBLIC, openBooking, isVendor: user?.role === "vendor" };
  const isHome = location.pathname === "/home" || (location.pathname === "/" && import.meta.env.VITE_LAUNCH_MODE === "public");
  const close = () => {
    setExploreOpen(false);
    setCreateOpen(false);
  };
  const go = (path: string) => {
    close();
    navigate(path);
  };

  const startActive = isUnder(location.pathname, START_PATHS);
  const exploreActive = isUnder(location.pathname, EXPLORE_PATHS) && !startActive;
  const places = [...visibleItems(EXPLORE_PLACES, navCtx), ...visibleItems(EXPLORE_PLACES_SOON, navCtx)];

  // Sheet rows are real links (header audit P1-2), from the shared nav config.
  const sheetLink = (item: NavItem) => (
    <Link key={item.key} to={item.to} className="hc-menu-row" style={sheetItemStyle} onClick={close} aria-current={location.pathname === item.to ? "page" : undefined}>
      <span style={{ display: "inline-flex", color: colors.orange, flex: "none" }} aria-hidden="true">
        <item.icon size={20} strokeWidth={ICON_STROKE} />
      </span>
      {item.label}
      {item.soon && <span className="hc-ed-soon" style={{ marginLeft: "auto" }}>Soon</span>}
    </Link>
  );

  return (
    <>
      <nav className="mobile-tab-bar" aria-label="Primary">
        <TabButton icon={<House size={23} strokeWidth={ICON_STROKE} aria-hidden="true" />} label="Home" active={isHome} current={isHome} onClick={() => go("/home")} />
        <TabButton icon={<Compass size={23} strokeWidth={ICON_STROKE} aria-hidden="true" />} label="Explore" active={exploreActive} expanded={exploreOpen} onClick={() => setExploreOpen(true)} />
        <TabButton
          icon={
            // Start is the primary action: its icon stays orange (the tab label follows the normal active state).
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 7, background: colors.orange, color: "#fff" }} aria-hidden="true">
              <Plus size={19} strokeWidth={2.4} />
            </span>
          } label="Start" active={startActive} expanded={createOpen} onClick={() => setCreateOpen(true)} />
        <TabButton icon={<UsersRound size={23} strokeWidth={ICON_STROKE} aria-hidden="true" />} label="Circles" active={isUnder(location.pathname, ["/circles"]) && !startActive} current={location.pathname === "/circles"} onClick={() => go("/circles")} />
        <TabButton icon={<UserRound size={23} strokeWidth={ICON_STROKE} aria-hidden="true" />} label="My Life" active={isUnder(location.pathname, ["/bookings", "/my-life"])} current={location.pathname === "/bookings" || location.pathname === "/my-life"} badge={count} onClick={() => go("/bookings")} />
      </nav>

      <Drawer open={exploreOpen} onClose={() => setExploreOpen(false)} title="Explore">
        <div style={sheetGroupLabelStyle}>Things to do</div>
        {EXPLORE_THINGS.map(sheetLink)}
        <div style={sheetGroupLabelStyle}>Learn & give back</div>
        {EXPLORE_LEARN.map(sheetLink)}
        {/* Sitemap audit P1-06 — only while venue pages are public; otherwise
            both would land on /coming-soon. */}
        {places.length > 0 && (
          <>
            <div style={sheetGroupLabelStyle}>Places</div>
            {places.map(sheetLink)}
          </>
        )}
        <div style={sheetGroupLabelStyle}>Not sure yet?</div>
        {sheetLink(FREE_TIME_ITEM)}
      </Drawer>

      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title="Start">
        <p style={{ fontSize: 13, color: colors.mutedLight, margin: "0 0 16px" }}>Start something new.</p>
        {/* Same groups as the desktop Start menu (navConfig START_GROUPS). */}
        {START_GROUPS.map((g) => {
          const items = visibleItems(g.items, navCtx);
          if (!items.length) return null;
          return (
            <div key={g.key}>
              <div style={sheetGroupLabelStyle}>{g.label}</div>
              {items.map(sheetLink)}
            </div>
          );
        })}
      </Drawer>
    </>
  );
}
