import { ClockIcon, PinIcon, UsersIcon } from "../../components/icons";
import type { LandingOpenPlan } from "../data";
import { lc, lcFonts } from "../theme";

export function OpenPlanCard({ plan }: { plan: LandingOpenPlan }) {
  return (
    <article
      style={{
        background: lc.ink,
        color: lc.paper,
        borderRadius: 18,
        padding: "22px 22px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        minWidth: 260,
      }}
    >
      <div>
        <h4 style={{ fontFamily: lcFonts.display, fontSize: 18, fontWeight: 700, color: lc.paper }}>{plan.title}</h4>
        <div style={{ fontSize: 13, color: lc.gold, fontWeight: 600, marginTop: 6 }}>{plan.need}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "rgba(250,248,242,0.72)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}><PinIcon size={13} /> {plan.area}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}><ClockIcon size={13} /> {plan.when}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}><UsersIcon size={13} /> {plan.joined}</span>
      </div>
      <button className="lc-btn" style={{ background: lc.forest, color: lc.white, marginTop: 4 }}>
        {plan.cta}
      </button>
    </article>
  );
}
