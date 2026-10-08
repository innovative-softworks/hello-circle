import { describe, expect, it } from "vitest";
import { hashGatePassword, parseGateUsers, readGateSession, safeNext, signGateSession, verifyGatePassword } from "./stagingGate.js";

const secret = "x".repeat(40);

describe("staging gate", () => {
  it("verifies the right password and rejects others", async () => {
    const users = parseGateUsers(`anita:${await hashGatePassword("correct horse")}\nnot a valid line\n`);
    expect([...users.keys()]).toEqual(["anita"]);
    expect(await verifyGatePassword(users.get("anita"), "correct horse")).toBe(true);
    expect(await verifyGatePassword(users.get("anita"), "wrong")).toBe(false);
    expect(await verifyGatePassword(users.get("nobody"), "correct horse")).toBe(false);
  });

  it("accepts a signed, unexpired session and rejects tampered or expired ones", () => {
    const now = 1_000_000;
    const cookie = signGateSession("anita", now + 60_000, secret);
    expect(readGateSession(cookie, secret, now)).toBe("anita");
    expect(readGateSession(cookie.replace("anita", "admin"), secret, now)).toBeNull();
    expect(readGateSession(cookie, "y".repeat(40), now)).toBeNull();
    expect(readGateSession(cookie, secret, now + 120_000)).toBeNull();
    expect(readGateSession(undefined, secret, now)).toBeNull();
  });

  it("only redirects to same-site paths", () => {
    expect(safeNext("/book/c1?x=1")).toBe("/book/c1?x=1");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext(undefined)).toBe("/");
  });
});
