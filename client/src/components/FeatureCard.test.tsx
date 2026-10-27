import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { FeatureCard, featureFits, type FeatureCardData } from "./FeatureCard";
import { categoryWord } from "./categories/CategoryChips";

// Card styles placement (owner plan, 2026-10-23): what each premium style
// needs, and that only real fields render.

const html = (el: JSX.Element) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);
const base: FeatureCardData = { href: "/games/g1", title: "Hiking Group Walk", image: "https://example.test/p.jpg", ph: "#eee", price: "Free", date: "2026-10-24", time: "13:00" };

describe("featureFits — compact fallback rules", () => {
  it("Immersive and Adventure need a photo", () => {
    expect(featureFits("immersive", { image: null })).toBe(false);
    expect(featureFits("adventure", { image: "" })).toBe(false);
    expect(featureFits("immersive", { image: "x.jpg" })).toBe(true);
  });
  it("Editorial needs a date", () => {
    expect(featureFits("editorial", { date: null })).toBe(false);
    expect(featureFits("editorial", { date: "2026-10-24" })).toBe(true);
  });
  it("Bold needs a real category", () => {
    expect(featureFits("bold", { category: null })).toBe(false);
    expect(featureFits("bold", { category: "Hiking" })).toBe(true);
  });
});

describe("FeatureCard", () => {
  it("Bold sets the category as the big word without repeating it as a pill", () => {
    const m = html(<FeatureCard variant="bold" data={{ ...base, category: "Hiking" }} onOpen={() => {}} />);
    expect(m).toContain("fc-bold-word");
    expect(m).toContain(">Hiking<");
    expect(m).not.toContain("lc-tag");
  });
  it("Immersive shows the date over the photo", () => {
    const m = html(<FeatureCard variant="immersive" data={base} onOpen={() => {}} />);
    expect(m).toContain("fc-title--over");
    expect(m).toContain("13:00");
  });
  it("Adventure shows duration and skill only when the listing has them", () => {
    const plain = html(<FeatureCard variant="adventure" data={base} onOpen={() => {}} />);
    expect(plain).not.toMatch(/\d hrs?\b|\d+ min/);
    expect(plain).not.toContain("Moderate");
    const m = html(<FeatureCard variant="adventure" data={{ ...base, durationMinutes: 80, skill: "Moderate" }} onOpen={() => {}} />);
    expect(m).toContain("1 hr 20 min");
    expect(m).toContain("Moderate");
  });
  it("uses a supplied action instead of the open arrow", () => {
    const m = html(<FeatureCard variant="editorial" data={base} onOpen={() => {}} action={<button>Join waitlist</button>} />);
    expect(m).toContain("Join waitlist");
    expect(m).not.toContain("lc-arrow");
  });
});

describe("categoryWord — the Bold card's word", () => {
  const cat = (name: string) => ({ name }) as never;
  it("prefers the chosen subcategory", () => {
    expect(categoryWord({ selected: cat("Outdoors & adventure"), selectedSub: cat("Hiking"), legacyLabel: null })).toBe("Hiking");
  });
  it("otherwise uses the first part of the category name", () => {
    expect(categoryWord({ selected: cat("Outdoors & adventure"), selectedSub: null, legacyLabel: null })).toBe("Outdoors");
    expect(categoryWord({ selected: cat("Water sports"), selectedSub: null, legacyLabel: null })).toBe("Water sports");
  });
  it("is empty with no category, so the page keeps its normal row", () => {
    expect(categoryWord({ selected: null, selectedSub: null, legacyLabel: null })).toBeNull();
  });
});
