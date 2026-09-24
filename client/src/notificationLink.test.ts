import { describe, expect, it } from "vitest";
import { notificationHref } from "./notificationLink";

// Resident Experience Polish — NotificationInboxPanel previously never
// navigated anywhere on click, for any kind. This mirrors the server's own
// pushPathFor()/DETAIL_PATH_BY_LISTING_TYPE exactly.

describe("notificationHref", () => {
  it("routes booking/registration/program/experience to My Life, scoped by ref", () => {
    for (const kind of ["booking", "registration", "program", "experience"] as const) {
      expect(notificationHref({ kind, listingType: "centre", listingId: "x", ref: "HB-123456" })).toBe("/bookings?ref=HB-123456");
    }
  });

  it("routes a game notification to the game's detail page", () => {
    expect(notificationHref({ kind: "game", listingType: "game", listingId: "game-1", ref: "game-1" })).toBe("/games/game-1");
  });

  it("routes a circle notification to the circle's detail page", () => {
    expect(notificationHref({ kind: "circle", listingType: "circle", listingId: "circle-1", ref: "circle-1" })).toBe("/circles/circle-1");
  });

  it("routes a waitlist notification by its underlying listing type, not a fixed path", () => {
    expect(notificationHref({ kind: "waitlist", listingType: "club", listingId: "club-1", ref: "5" })).toBe("/clubs/club-1");
  });

  it("returns null rather than a broken link for a listing type with no detail page", () => {
    expect(notificationHref({ kind: "intent_match", listingType: "intent", listingId: "intent-1", ref: "intent-1" })).toBeNull();
  });

  // Platform Pre-Launch Polish — Changeset 2. This client mirror had fallen
  // out of sync with the server's DETAIL_PATH_BY_LISTING_TYPE — these 4
  // types silently no-opped on click before this changeset.
  it("routes a vendor-listingType notification to the provider profile", () => {
    expect(notificationHref({ kind: "waitlist", listingType: "vendor", listingId: "vendor-1", ref: "vendor-1" })).toBe("/provider/vendor-1");
  });

  it("routes a host-listingType notification to the host profile", () => {
    expect(notificationHref({ kind: "waitlist", listingType: "host", listingId: "host-1", ref: "host-1" })).toBe("/host/host-1");
  });

  it("routes an experience-listingType notification to the experience detail page", () => {
    expect(notificationHref({ kind: "waitlist", listingType: "experience", listingId: "exp-1", ref: "exp-1" })).toBe("/experiences/exp-1");
  });

  it("routes a program-listingType notification to the program detail page", () => {
    expect(notificationHref({ kind: "waitlist", listingType: "program", listingId: "prog-1", ref: "prog-1" })).toBe("/programs/prog-1");
  });
});
