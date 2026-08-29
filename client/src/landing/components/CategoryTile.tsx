import type { LandingCategory } from "../data";
import { lc, lcFonts } from "../theme";

export function CategoryTile({ category }: { category: LandingCategory }) {
  return (
    <div className="lc-category-tile" style={{ aspectRatio: "3 / 4", position: "relative" }}>
      <img src={category.image} alt="" loading="lazy" />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, rgba(18,20,14,0) 40%, rgba(18,20,14,0.82) 100%)",
        }}
      />
      <div style={{ position: "absolute", left: 16, right: 16, bottom: 16, color: lc.white }}>
        <div style={{ fontFamily: lcFonts.display, fontSize: 19, fontWeight: 800 }}>{category.label}</div>
        <div style={{ fontSize: 12.5, marginTop: 4, color: "rgba(255,255,255,0.82)" }}>{category.description}</div>
      </div>
    </div>
  );
}
