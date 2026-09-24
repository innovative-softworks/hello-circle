import { describe, expect, it } from "vitest";
import { favouriteDetailHref } from "./favouriteLink";
import type { Favourite } from "./types";

// Resident Experience Polish — Changeset 4. Before this, MyLifeSaved.tsx and
// Profile.tsx each had their own detailHref with no case for circle/
// program_session/club_session — a saved item of those types was always
// non-clickable even when it was still perfectly valid.

function fav(overrides: Partial<Favourite>): Favourite {
  return { listingType: "centre", listingId: "x", status: "interested", name: null, imageUrl: null, subtitle: null, ...overrides };
}

describe("favouriteDetailHref", () => {
  it("links centre/club/game/experience directly by id", () => {
    expect(favouriteDetailHref(fav({ listingType: "centre", listingId: "c1" }))).toBe("/centres/c1");
    expect(favouriteDetailHref(fav({ listingType: "club", listingId: "cl1" }))).toBe("/clubs/cl1");
    expect(favouriteDetailHref(fav({ listingType: "game", listingId: "g1" }))).toBe("/games/g1");
    expect(favouriteDetailHref(fav({ listingType: "experience", listingId: "e1" }))).toBe("/experiences/e1");
  });

  it("links circle by slug when present, falling back to id", () => {
    expect(favouriteDetailHref(fav({ listingType: "circle", listingId: "circle-1", slug: "running-club" }))).toBe("/circles/running-club");
    expect(favouriteDetailHref(fav({ listingType: "circle", listingId: "circle-1" }))).toBe("/circles/circle-1");
  });

  it("links program_session/club_session to their parent, not their own id", () => {
    expect(favouriteDetailHref(fav({ listingType: "program_session", listingId: "session-1", parentId: "program-1" }))).toBe("/programs/program-1");
    expect(favouriteDetailHref(fav({ listingType: "club_session", listingId: "session-2", parentId: "club-1" }))).toBe("/clubs/club-1");
  });

  it("returns null for program_session/club_session when the parent was also removed", () => {
    expect(favouriteDetailHref(fav({ listingType: "program_session", listingId: "session-1" }))).toBeNull();
    expect(favouriteDetailHref(fav({ listingType: "club_session", listingId: "session-2" }))).toBeNull();
  });
});
