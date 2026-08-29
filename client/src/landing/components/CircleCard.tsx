import { CalendarIcon, UsersIcon } from "../../components/icons";
import type { LandingCircle } from "../data";
import { lc, lcFonts } from "../theme";

export function CircleCard({ circle }: { circle: LandingCircle }) {
  return (
    <article className="lc-card" style={{ background: lc.white, borderRadius: 18, overflow: "hidden", border: `1px solid ${lc.line}` }}>
      <div className="lc-card-image" style={{ height: 150 }}>
        <img src={circle.image} alt="" loading="lazy" />
      </div>
      <div style={{ padding: "16px 18px 18px" }}>
        <h4 style={{ fontFamily: lcFonts.display, fontSize: 16.5, fontWeight: 700, color: lc.ink }}>{circle.name}</h4>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 9, fontSize: 13, color: lc.inkSoft }}>
          <UsersIcon size={13} /> {circle.members}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, fontSize: 13, color: lc.forest, fontWeight: 600 }}>
          <CalendarIcon size={13} /> {circle.next}
        </div>
      </div>
    </article>
  );
}
