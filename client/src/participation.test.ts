import { describe, expect, it } from "vitest";
import { isUpcomingProgramEnrollment, shouldPromptProgramFeedback } from "./participation";

// Resident Experience Polish — the eligibility predicate that decides
// whether a program enrollment contributes a real dated entry to My Life's
// Next Up timeline. Never true when there's nothing honest to show.

describe("isUpcomingProgramEnrollment", () => {
  const TODAY = "2026-09-22";

  it("is true when a future session exists", () => {
    expect(isUpcomingProgramEnrollment({ status: "confirmed", nextSessionDate: "2026-09-29" }, TODAY)).toBe(true);
  });

  it("is true when the next session is today", () => {
    expect(isUpcomingProgramEnrollment({ status: "confirmed", nextSessionDate: TODAY }, TODAY)).toBe(true);
  });

  it("is false when there is no future session (nextSessionDate is null)", () => {
    expect(isUpcomingProgramEnrollment({ status: "confirmed", nextSessionDate: null }, TODAY)).toBe(false);
  });

  it("is false when the only session on record is in the past", () => {
    expect(isUpcomingProgramEnrollment({ status: "confirmed", nextSessionDate: "2026-08-01" }, TODAY)).toBe(false);
  });

  it("is false when the enrollment is cancelled, even with a future session", () => {
    expect(isUpcomingProgramEnrollment({ status: "cancelled", nextSessionDate: "2026-09-29" }, TODAY)).toBe(false);
  });
});

describe("shouldPromptProgramFeedback", () => {
  const base = { status: "confirmed", hasPastSession: true };
  it("waits until a session has happened, and never for a cancelled enrollment", () => {
    expect(shouldPromptProgramFeedback({ ...base, hasPastSession: false })).toBe(false);
    expect(shouldPromptProgramFeedback({ ...base, status: "cancelled" })).toBe(false);
  });
  it("treats no register as unknown, so the prompt still shows", () => {
    expect(shouldPromptProgramFeedback(base)).toBe(true);
    expect(shouldPromptProgramFeedback({ ...base, sessionsAttended: 0, sessionsMissed: 0 })).toBe(true);
  });
  it("hides it only when every recorded session was missed", () => {
    expect(shouldPromptProgramFeedback({ ...base, sessionsAttended: 0, sessionsMissed: 2 })).toBe(false);
    expect(shouldPromptProgramFeedback({ ...base, sessionsAttended: 1, sessionsMissed: 2 })).toBe(true);
  });
});

describe("attendance state + feedback prompt", async () => {
  const { attendanceStateOf, shouldPromptFeedback } = await import("./participation");
  it("maps each table's raw signal to one vocabulary", () => {
    expect(attendanceStateOf({ cancelled: true, attendance: "present" })).toBe("cancelled");
    expect(attendanceStateOf({ cancelled: false, attendance: "present" })).toBe("attended");
    expect(attendanceStateOf({ cancelled: false, attendance: "no_show" })).toBe("no_show");
    expect(attendanceStateOf({ cancelled: false, selfReportedAttended: true })).toBe("attended");
    expect(attendanceStateOf({ cancelled: false })).toBe("registered");
  });
  it("prompts only after it happened, and never after a cancellation or no-show", () => {
    expect(shouldPromptFeedback("attended", true)).toBe(true);
    expect(shouldPromptFeedback("registered", true)).toBe(true);
    expect(shouldPromptFeedback("registered", false)).toBe(false);
    expect(shouldPromptFeedback("no_show", true)).toBe(false);
    expect(shouldPromptFeedback("cancelled", true)).toBe(false);
  });
});
