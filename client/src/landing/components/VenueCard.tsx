import { PinIcon } from "../../components/icons";
import type { LandingVenue } from "../data";
import { lc, lcFonts } from "../theme";

export function VenueCard({ venue }: { venue: LandingVenue }) {
  return (
    <article className="lc-card" style={{ background: lc.white, borderRadius: 18, overflow: "hidden", border: `1px solid ${lc.line}` }}>
      <div className="lc-card-image" style={{ height: 168 }}>
        <img src={venue.image} alt="" loading="lazy" />
        {venue.unclaimed && (
          <span style={{ position: "absolute", top: 12, left: 12, background: lc.emberBg, color: lc.ember, fontSize: 11, fontWeight: 700, padding: "5px 10px", borderRadius: 999 }}>
            Unclaimed venue
          </span>
        )}
      </div>
      <div style={{ padding: "16px 18px 18px" }}>
        <h4 style={{ fontFamily: lcFonts.display, fontSize: 16.5, fontWeight: 700, color: lc.ink }}>{venue.name}</h4>
        <div style={{ fontSize: 13, color: lc.inkSoft, marginTop: 7 }}>{venue.tags}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, fontSize: 12.5, color: lc.inkSoft }}>
          <PinIcon size={12} /> {venue.distanceKm} km · {venue.availability}
        </div>
        <button
          className="lc-btn"
          style={{
            marginTop: 14,
            width: "100%",
            background: venue.unclaimed ? lc.emberBg : lc.paperRaised,
            color: venue.unclaimed ? lc.ember : lc.ink,
            padding: "10px 16px",
            fontSize: 13.5,
          }}
        >
          {venue.cta}
        </button>
      </div>
    </article>
  );
}
