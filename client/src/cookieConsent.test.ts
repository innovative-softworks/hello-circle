import { describe, expect, it } from "vitest";
import { consentModeSignals, parseStoredChoice } from "./cookieConsent";

describe("cookie consent (Stage 5c)", () => {
  it("migrates the old single choice without granting advertising", () => {
    expect(parseStoredChoice("accepted")).toMatchObject({ analytics: true, advertising: false });
    expect(parseStoredChoice("rejected")).toMatchObject({ analytics: false, advertising: false });
    expect(parseStoredChoice(null)).toBeNull();
    expect(parseStoredChoice("{bad json")).toBeNull();
    expect(parseStoredChoice(JSON.stringify({ v: 1, analytics: true }))).toBeNull();
  });

  it("keeps analytics and advertising independent", () => {
    expect(parseStoredChoice(JSON.stringify({ v: 2, analytics: false, advertising: true, decidedAt: "x" }))).toMatchObject({ analytics: false, advertising: true });
    expect(consentModeSignals({ analytics: true, advertising: false })).toEqual({ analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
    expect(consentModeSignals({ analytics: false, advertising: true })).toEqual({ analytics_storage: "denied", ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted" });
    expect(consentModeSignals(null)).toEqual({ analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
  });
});
