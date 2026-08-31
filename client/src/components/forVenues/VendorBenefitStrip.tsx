import type { ReactNode } from "react";
import { BallIcon, BuildingIcon, GraduationCapIcon, HandshakeIcon, TreeIconSmall } from "../icons";
import { colors, fonts } from "../../theme";
import { FV_ACCENT } from "./constants";

const BENEFITS: { icon: ReactNode; label: string }[] = [
  { icon: <BuildingIcon size={16} />, label: "Reach more local people" },
  { icon: <BallIcon size={16} />, label: "Manage your availability" },
  { icon: <TreeIconSmall size={16} />, label: "Fill your quieter times" },
  { icon: <HandshakeIcon size={16} />, label: "Connect with local communities" },
  { icon: <GraduationCapIcon size={16} />, label: "Every kind of activity, welcome" },
];

function TickerGroup({ ariaHidden }: { ariaHidden?: boolean }) {
  return (
    <div aria-hidden={ariaHidden} style={{ display: "flex", alignItems: "center" }}>
      {BENEFITS.map((b, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 20, padding: "0 28px" }}>
          <span style={{ color: FV_ACCENT, display: "flex" }}>{b.icon}</span>
          <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, whiteSpace: "nowrap" }}>{b.label}</span>
          <span style={{ color: colors.borderStrong, fontWeight: 700 }} aria-hidden="true">
            /
          </span>
        </span>
      ))}
    </div>
  );
}

export function VendorBenefitStrip() {
  return (
    <section style={{ borderTop: `1px solid ${colors.border}`, borderBottom: `1px solid ${colors.border}` }}>
      <div
        className="fv-marquee-viewport"
        style={{ overflow: "hidden", padding: "20px 0" }}
        role="list"
        aria-label="Built for local places"
      >
        <div className="fv-marquee-track">
          <TickerGroup />
          <TickerGroup ariaHidden />
        </div>
      </div>
    </section>
  );
}
