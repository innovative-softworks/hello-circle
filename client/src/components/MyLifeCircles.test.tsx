import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Circle } from "../types";
import { MyLifeCircles } from "./MyLifeCircles";

// PUB-08 / PUB-31 — My Life's Circles list, checked on server-rendered HTML.

function circle(i: number, extra: Partial<Circle> = {}): Circle {
  return { id: `c${i}`, slug: `circle-${i}`, name: `Circle ${i}`, members: 5, myRole: "member", nextPlan: null, activePlan: null, ...extra } as unknown as Circle;
}
const plan = (source: "circle" | "nearby") => ({ id: "g1", date: "2030-07-15", time: "18:30", joined: 1, capacity: 8, spotsLeft: 7, source });
const html = (circles: Circle[]) => renderToStaticMarkup(<MemoryRouter><MyLifeCircles circles={circles} /></MemoryRouter>);

describe("MyLifeCircles", () => {
  it("shows NEXT only for a plan that belongs to the Circle, never a nearby activity", () => {
    const own = html([circle(1, { nextPlan: plan("circle") })]);
    expect(own).toContain("NEXT");
    const nearby = html([circle(1, { nextPlan: plan("nearby") })]);
    expect(nearby).not.toContain("NEXT");
    expect(nearby).toContain("Nothing planned yet");
  });

  it("shows three rows first and offers every Circle behind Show all", () => {
    const m = html([1, 2, 3, 4, 5].map((i) => circle(i)));
    expect(m.match(/class="stretched-link"/g)).toHaveLength(3);
    expect(m).toContain("Show all 5 Circles");
    expect(m).toContain('aria-expanded="false"');
    expect(html([1, 2, 3].map((i) => circle(i)))).not.toContain("Show all");
  });

  it("has no interactive element nested inside another (organiser Manage link is separate)", () => {
    const m = html([circle(1, { myRole: "organiser" })]);
    expect(m).toContain('href="/manage/circles/circle-1"');
    expect(m).toContain('href="/circles/circle-1"');
    expect(m).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*<button/s);
    expect(m).not.toMatch(/<a [^>]*>(?:(?!<\/a>).)*<a /s);
  });
});
