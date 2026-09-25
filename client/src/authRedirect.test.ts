import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./authRedirect";

// Auth UX audit (§6/§7) — safeReturnTo already guarded against an open
// redirect (external/protocol-relative targets); this adds the "never point
// a returnTo back at an auth page" loop guard (a session-expiry or cold
// deep-link redirect to /login?returnTo=/login would otherwise bounce
// straight back into the same screen it's trying to recover from) and a
// caller-supplied fallback for the vendor/admin side, which shouldn't
// default to the resident "/bookings" destination.

describe("safeReturnTo", () => {
  it("defaults to /bookings for a missing or empty value", () => {
    expect(safeReturnTo(null)).toBe("/bookings");
    expect(safeReturnTo("")).toBe("/bookings");
  });

  it("honours a caller-supplied fallback", () => {
    expect(safeReturnTo(null, "/vendor")).toBe("/vendor");
    expect(safeReturnTo("", "/admin")).toBe("/admin");
  });

  it("rejects an absolute external URL (open-redirect guard)", () => {
    expect(safeReturnTo("https://evil.example.com/phish")).toBe("/bookings");
    expect(safeReturnTo("http://evil.example.com")).toBe("/bookings");
  });

  it("rejects a protocol-relative URL", () => {
    expect(safeReturnTo("//evil.example.com")).toBe("/bookings");
  });

  it("accepts a normal same-origin relative path", () => {
    expect(safeReturnTo("/games/123")).toBe("/games/123");
    expect(safeReturnTo("/vendor/centres/abc?tab=rooms")).toBe("/vendor/centres/abc?tab=rooms");
  });

  it("rejects a returnTo pointing back at an auth page (loop guard)", () => {
    expect(safeReturnTo("/login")).toBe("/bookings");
    expect(safeReturnTo("/login?foo=bar")).toBe("/bookings");
    expect(safeReturnTo("/signin")).toBe("/bookings");
    expect(safeReturnTo("/signin/create")).toBe("/bookings");
    expect(safeReturnTo("/signin/email-link")).toBe("/bookings");
    expect(safeReturnTo("/accept-invite?token=abc")).toBe("/bookings");
    expect(safeReturnTo("/forgot-password")).toBe("/bookings");
    expect(safeReturnTo("/reset-password?token=abc")).toBe("/bookings");
    expect(safeReturnTo("/vendor/signup")).toBe("/bookings");
  });

  it("loop guard uses the caller's fallback, not the resident default", () => {
    expect(safeReturnTo("/login", "/vendor")).toBe("/vendor");
  });

  it("does not reject a legitimate path that merely starts with an auth path's name", () => {
    // Not an auth page — just happens to share a prefix character-wise.
    // Confirms the guard matches whole path segments, not a bare startsWith.
    expect(safeReturnTo("/loginhelp")).toBe("/loginhelp");
  });
});

describe("safeReturnTo — malformed and hash handling (onboarding audit)", () => {
  it("preserves query and hash on a safe path", () => {
    expect(safeReturnTo("/circles/abc?tab=plans#poll-3")).toBe("/circles/abc?tab=plans#poll-3");
  });

  it("rejects backslash and control-character tricks", () => {
    expect(safeReturnTo("/\\evil.example.com")).toBe("/bookings");
    expect(safeReturnTo("/games/1\r\nSet-Cookie: x=1")).toBe("/bookings");
    expect(safeReturnTo("/games/1\u0000")).toBe("/bookings");
  });

  it("rejects a non-path scheme and an auth page hidden behind a hash", () => {
    expect(safeReturnTo("javascript:alert(1)")).toBe("/bookings");
    expect(safeReturnTo("/login#/games/1")).toBe("/bookings");
  });
});
