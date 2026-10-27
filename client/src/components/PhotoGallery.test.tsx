import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PhotoGallery } from "./PhotoGallery";

// Batch 2 — one cover for every detail page: same frame for one or many
// photos; slide controls only when there's more than one.

describe("PhotoGallery cover", () => {
  it("several photos: carousel region, arrows, dots and a counter", () => {
    const m = renderToStaticMarkup(<PhotoGallery images={["/a.jpg", "/b.jpg", "/c.jpg"]} alt="Hike" ph="#eee" />);
    expect(m).toContain('aria-roledescription="carousel"');
    expect(m).toContain('aria-label="Previous photo"');
    expect(m).toContain('aria-label="Next photo"');
    expect(m).toContain('aria-label="Photo 3 of 3"');
    expect(m).toContain("1 / 3");
    expect(m).toContain("aspect-ratio:16/9");
  });

  it("one photo: the same frame, no controls", () => {
    const m = renderToStaticMarkup(<PhotoGallery images={["/a.jpg", null]} alt="Football" ph="#eee" overlay={<span>Wed 21 Oct</span>} />);
    expect(m).toContain("cover-frame");
    expect(m).toContain("aspect-ratio:16/9");
    expect(m).not.toContain("Next photo");
    expect(m).not.toContain("carousel");
    expect(m).toContain("Wed 21 Oct");
  });

  it("no photo: placeholder with the listing icon; loading photos show the skeleton, not a fade", () => {
    const none = renderToStaticMarkup(<PhotoGallery images={[]} alt="x" ph="#eee" icon={<span>ICON</span>} />);
    expect(none).toContain("ICON");
    const loading = renderToStaticMarkup(<PhotoGallery images={["/a.jpg"]} alt="x" ph="#eee" />);
    expect(loading).toContain('class="skeleton"');
    expect(loading).not.toMatch(/fade|animation/);
  });
});
