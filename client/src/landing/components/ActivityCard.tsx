import { ClockIcon, PinIcon } from "../../components/icons";
import type { LandingActivity } from "../data";
import { lc, lcFonts, lcRadius } from "../theme";

export function ActivityCard({ activity, width = 280 }: { activity: LandingActivity; width?: number }) {
  return (
    <article className="lc-card" style={{ width, background: lc.white, borderRadius: 18, overflow: "hidden", border: `1px solid ${lc.line}` }}>
      <div className="lc-card-image" style={{ height: 176 }}>
        <img src={activity.image} alt="" loading="lazy" />
        <span
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            background: "rgba(250, 248, 242, 0.94)",
            color: lc.ink,
            fontSize: 11.5,
            fontWeight: 700,
            padding: "5px 10px",
            borderRadius: lcRadius.pill,
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <ClockIcon size={11} /> {activity.when}
        </span>
      </div>
      <div style={{ padding: "16px 16px 18px" }}>
        <h4 style={{ fontFamily: lcFonts.display, fontSize: 16.5, fontWeight: 700, color: lc.ink, margin: 0 }}>{activity.title}</h4>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 8, fontSize: 13, color: lc.inkSoft }}>
          <PinIcon size={12} /> {activity.venue} · {activity.distanceKm} km
        </div>
        <div style={{ fontSize: 12.5, color: lc.inkSoft, marginTop: 4 }}>{activity.meta}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: lc.forest }}>{activity.price}</span>
          <button className="lc-btn" style={{ background: lc.ink, color: lc.white, padding: "9px 18px", fontSize: 13.5 }}>
            {activity.cta}
          </button>
        </div>
      </div>
    </article>
  );
}
