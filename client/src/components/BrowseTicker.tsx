import type { ReactNode } from "react";
import { CardIcon, CheckCircleIcon, GraduationCapIcon, PinIcon, TagIcon, UsersIcon } from "./icons";
import { colors, fonts } from "../theme";

// Marquee ticker for the Community centres/Sports clubs browse header —
// reuses the exact .fv-marquee-viewport/.fv-marquee-track mechanism
// VendorBenefitStrip.tsx already established (index.css's fv-marquee
// keyframe: two copies of the track shift left by one copy's width so the
// loop is invisible, pauses on hover, disabled under prefers-reduced-
// motion). Fills the horizontal space the header's old illustration used
// to occupy, edge to edge, rather than cramming content into a narrow
// right-hand column. Every label is a real, existing capability of this
// page (compare, cash-or-online payment, free trials) — never an invented
// stat, same rule the rest of the My Life redesign follows.

const CENTRE_FACTS: { icon: ReactNode; label: string }[] = [
  { icon: <CheckCircleIcon size={16} />, label: "Verified centres" },
  { icon: <TagIcon size={16} />, label: "Compare prices & capacity" },
  { icon: <CardIcon size={16} />, label: "Book online or pay cash" },
  { icon: <PinIcon size={16} />, label: "Ireland wide" },
];

const CLUB_FACTS: { icon: ReactNode; label: string }[] = [
  { icon: <CheckCircleIcon size={16} />, label: "Verified clubs" },
  { icon: <GraduationCapIcon size={16} />, label: "Free trial sessions" },
  { icon: <UsersIcon size={16} />, label: "Every age welcome" },
  { icon: <PinIcon size={16} />, label: "Ireland wide" },
];

function TickerGroup({ facts, accentColor, ariaHidden }: { facts: { icon: ReactNode; label: string }[]; accentColor: string; ariaHidden?: boolean }) {
  return (
    <div aria-hidden={ariaHidden} style={{ display: "flex", alignItems: "center" }}>
      {facts.map((f, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 20, padding: "0 28px" }}>
          <span style={{ color: accentColor, display: "flex" }}>{f.icon}</span>
          <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, whiteSpace: "nowrap" }}>{f.label}</span>
          <span style={{ color: colors.borderStrong, fontWeight: 700 }} aria-hidden="true">
            /
          </span>
        </span>
      ))}
    </div>
  );
}

export function BrowseTicker({ isClubs }: { isClubs: boolean }) {
  const facts = isClubs ? CLUB_FACTS : CENTRE_FACTS;
  const accentColor = isClubs ? colors.orangeDark : colors.greenText;
  return (
    <section style={{ borderTop: `1px solid ${colors.border}`, borderBottom: `1px solid ${colors.border}` }}>
      <div
        className="fv-marquee-viewport"
        style={{ overflow: "hidden", padding: "16px 0" }}
        role="list"
        aria-label={isClubs ? "Sports clubs on HelloCircle" : "Community centres on HelloCircle"}
      >
        <div className="fv-marquee-track">
          <TickerGroup facts={facts} accentColor={accentColor} />
          <TickerGroup facts={facts} accentColor={accentColor} ariaHidden />
        </div>
      </div>
    </section>
  );
}
