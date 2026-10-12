import { describe, expect, it } from "vitest";
import { availableViews, earningsHref, initialView } from "./earningsViews";
import { centsPriceSignal, clubPriceSignal } from "../priceSignal";

const p = (q: string) => new URLSearchParams(q);

describe("Earnings sections (commercial UX R1, §3.3)", () => {
  it("shows only Balance when Connect, Pro and rewards are all off", () => {
    expect(availableViews({ payouts: false, plan: false })).toEqual(["balance"]);
  });
  it("adds Payouts and Plan & billing only when the server says they're on", () => {
    expect(availableViews({ payouts: true, plan: false })).toEqual(["balance", "payouts"]);
    expect(availableViews({ payouts: false, plan: true })).toEqual(["balance", "plan"]);
    expect(availableViews({ payouts: true, plan: true })).toEqual(["balance", "payouts", "plan"]);
  });

  const all = availableViews({ payouts: true, plan: true });
  it("honours ?view= deep links", () => {
    expect(initialView(p("tab=earnings&view=plan"), all)).toBe("plan");
    expect(initialView(p("tab=earnings&view=payouts"), all)).toBe("payouts");
    expect(initialView(p("tab=earnings"), all)).toBe("balance");
  });
  it("opens the section a Stripe return lands on (server return paths are ?tab=earnings)", () => {
    expect(initialView(p("tab=earnings&pro=success"), all)).toBe("plan");
    expect(initialView(p("tab=earnings&payouts=return"), all)).toBe("payouts");
    expect(initialView(p("tab=earnings&payouts=refresh"), all)).toBe("payouts");
  });
  it("falls back to Balance for a hidden or unknown section", () => {
    expect(initialView(p("view=plan"), ["balance"])).toBe("balance");
    expect(initialView(p("pro=success"), ["balance", "payouts"])).toBe("balance");
    expect(initialView(p("view=nonsense"), all)).toBe("balance");
  });
  it("builds deep links per scope", () => {
    expect(earningsHref("vendor", "plan")).toBe("/vendor?tab=earnings&view=plan");
    expect(earningsHref("host", "payouts")).toBe("/manage?tab=earnings&view=payouts");
    expect(earningsHref("host")).toBe("/manage?tab=earnings");
  });
});

describe("listing price signal (C1)", () => {
  it("clubs: €0 is Free, a trial is Free trial, otherwise nothing", () => {
    expect(clubPriceSignal({ price: 0, trial: true })).toBe("free");
    expect(clubPriceSignal({ price: 40, trial: true })).toBe("free_trial");
    expect(clubPriceSignal({ price: 40, trial: false })).toBeNull();
  });
  it("cent prices: 0 or none is Free (same rule as formatPrice)", () => {
    expect(centsPriceSignal(0)).toBe("free");
    expect(centsPriceSignal(null)).toBe("free");
    expect(centsPriceSignal(undefined)).toBe("free");
    expect(centsPriceSignal(1500)).toBeNull();
  });
});
