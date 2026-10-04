import { useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BallIcon,
  BuildingIcon,
  GridIcon,
  HandshakeIcon,
  HomeIcon,
  PersonIcon,
  PinIcon,
  PlusIcon,
  RepeatIcon,
  TreeIconSmall,
} from "./icons";
import { Drawer } from "./ui";
import { useMyStuff } from "../MyStuffContext";
import { colors, radius } from "../theme";

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
  alignItems: "center",
  gap: 12,
  width: "100%",
  background: colors.panel,
  border: "none",
  borderRadius: 12,
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
  letterSpacing: ".04em",
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
      style={{ ...itemButtonStyle, color: active ? colors.greenText : colors.mutedLight, position: "relative" }}
    >
      {icon}
      {label}
      {!!badge && (
        <span
          style={{
            position: "absolute",
            top: 0,
            right: "22%",
            background: colors.green,
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
  const [exploreOpen, setExploreOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const isActive = (prefixes: string[]) => prefixes.some((p) => location.pathname.startsWith(p));
  const go = (path: string) => {
    setExploreOpen(false);
    setCreateOpen(false);
    navigate(path);
  };

  const exploreActive = isActive(["/browse/centres", "/centres/", "/browse/clubs", "/clubs/", "/games", "/adventures", "/experiences", "/programs"]);

  return (
    <>
      <nav className="mobile-tab-bar" aria-label="Primary">
        <TabButton icon={<HomeIcon size={20} />} label="Home" active={location.pathname === "/home"} current={location.pathname === "/home"} onClick={() => go("/home")} />
        <TabButton icon={<GridIcon size={20} />} label="Explore" active={exploreActive} expanded={exploreOpen} onClick={() => setExploreOpen(true)} />
        <TabButton icon={<PlusIcon size={20} />} label="Start" active={false} expanded={createOpen} onClick={() => setCreateOpen(true)} />
        <TabButton icon={<RepeatIcon size={20} />} label="Circles" active={isActive(["/circles"])} current={location.pathname === "/circles"} onClick={() => go("/circles")} />
        <TabButton icon={<PersonIcon size={20} />} label="My Life" active={isActive(["/bookings", "/my-life"])} current={location.pathname === "/bookings" || location.pathname === "/my-life"} badge={count} onClick={() => go("/bookings")} />
      </nav>

      <Drawer open={exploreOpen} onClose={() => setExploreOpen(false)} title="Explore">
        <div style={sheetGroupLabelStyle}>Explore</div>
        <button style={sheetItemStyle} onClick={() => go("/games")} aria-current={location.pathname === "/games" ? "page" : undefined}>
          <RepeatIcon size={18} style={{ color: colors.greenText, flex: "none" }} /> Join a session
        </button>
        <button style={sheetItemStyle} onClick={() => go("/adventures")} aria-current={location.pathname === "/adventures" ? "page" : undefined}>
          <TreeIconSmall size={18} style={{ color: colors.greenText, flex: "none" }} /> Adventures
        </button>
        <button style={sheetItemStyle} onClick={() => go("/experiences")} aria-current={location.pathname === "/experiences" ? "page" : undefined}>
          <TreeIconSmall size={18} style={{ color: colors.orangeDark, flex: "none" }} /> Experiences
        </button>
        {/* Programs has its own browse page (/programs), same as the
            desktop mega menu — it used to land on Explore's mixed results. */}
        <button style={sheetItemStyle} onClick={() => go("/programs")} aria-current={location.pathname === "/programs" ? "page" : undefined}>
          <GridIcon size={18} style={{ color: colors.greenText, flex: "none" }} /> Programs
        </button>
        {/* Product Language & IA Polish — Changeset 1C — mirrors Header.tsx's
            desktop mega-menu's same convergence on "Places". */}
        <div style={sheetGroupLabelStyle}>Places</div>
        <button style={sheetItemStyle} onClick={() => go("/browse/centres")} aria-current={location.pathname === "/browse/centres" ? "page" : undefined}>
          <BuildingIcon size={18} style={{ color: colors.greenText, flex: "none" }} /> Community centres
        </button>
        <button style={sheetItemStyle} onClick={() => go("/browse/clubs")} aria-current={location.pathname === "/browse/clubs" ? "page" : undefined}>
          <BallIcon size={18} style={{ color: colors.greenText, flex: "none" }} /> Sports clubs
        </button>
      </Drawer>

      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title="Start">
        <p style={{ fontSize: 13, color: colors.mutedLight, margin: "0 0 16px" }}>Start something new.</p>
        <button style={sheetItemStyle} onClick={() => go("/browse/centres")} aria-current={location.pathname === "/browse/centres" ? "page" : undefined}>
          <BuildingIcon size={18} style={{ color: colors.greenText, flex: "none" }} /> Book a place
        </button>
        <button style={sheetItemStyle} onClick={() => go("/games")} aria-current={location.pathname === "/games" ? "page" : undefined}>
          <PlusIcon size={18} style={{ color: colors.greenText, flex: "none" }} /> Start a session
        </button>
        <button style={sheetItemStyle} onClick={() => go("/make-it-happen")} aria-current={location.pathname === "/make-it-happen" ? "page" : undefined}>
          <HandshakeIcon size={18} style={{ color: colors.orangeDark, flex: "none" }} /> Make It Happen
        </button>
        <button style={sheetItemStyle} onClick={() => go("/suggest-place")} aria-current={location.pathname === "/suggest-place" ? "page" : undefined}>
          <PinIcon size={18} style={{ color: colors.greenText, flex: "none" }} /> Suggest a place
        </button>
      </Drawer>
    </>
  );
}
