import { readFileSync, readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Pricing } from "./pages/Pricing";
import { FEE_MODEL_HELP_KEYS, HYPOTHETICAL_PLAN_MODEL_NOTE, PARTNER_FEE_MODEL_CONFIRMED, visibleBenefitKeys } from "./partnerPricing";

// R3B finding F1 — the Free 9% / Pro 7% partner success-fee model isn't what
// checkout charges. Until it is (PARTNER_FEE_MODEL_CONFIRMED), no public or
// partner page may promise it. These checks fail if a page starts doing so.

const MISLEADING = [/\b9%/, /\b7%/, /success fee/i, /No booking fee/i, /pays for itself/i, /What you'd earn/i, /weekly transfers/i];
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("partner fee model is not presented as live", () => {
  it("is not confirmed (R3B D1 open)", () => {
    expect(PARTNER_FEE_MODEL_CONFIRMED).toBe(false);
  });

  it("/pricing shows the pending notice and accurate free-plan facts, and no fee promises", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Pricing />
      </MemoryRouter>
    );
    const t = text(html);
    expect(t).toContain("Pricing for partners");
    expect(t).toContain("being finalised");
    expect(t).toContain("Free listing");
    expect(t).toContain("No fee on free events");
    expect(t).toContain("Nothing on this page is a fee you'll be charged today");
    for (const claim of [...MISLEADING, /€29/, /Price per place/]) expect(t, String(claim)).not.toMatch(claim);
  });

  it("hides Pro's lower-fee benefits but keeps the reward-month benefit", () => {
    expect(visibleBenefitKeys(["pro_benefit_1", "pro_benefit_2", "pro_benefit_3"])).toEqual(["pro_benefit_3"]);
    expect(FEE_MODEL_HELP_KEYS).toEqual(expect.arrayContaining(["pro_benefit_1", "pro_benefit_2"]));
  });

  it("labels the admin simulator as hypothetical, naming what checkout really uses", () => {
    expect(HYPOTHETICAL_PLAN_MODEL_NOTE).toMatch(/^Hypothetical\./);
    expect(HYPOTHETICAL_PLAN_MODEL_NOTE).toContain("Checkout and settlement don't charge this today");
  });

  it("every partner-facing use of the plan fee figures is gated", () => {
    const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
    // Pages/components that can render success-fee figures or the estimator must check the gate.
    for (const f of ["./pages/Pricing.tsx", "./pages/ProDetailsPage.tsx", "./components/EarningsSummary.tsx"]) {
      expect(read(f), f).toContain("PARTNER_FEE_MODEL_CONFIRMED");
    }
    // The estimator is only mounted from gated places (and admin, which is labelled).
    const users = ["./pages/Pricing.tsx", "./components/EarningsSummary.tsx"];
    for (const f of users) expect(read(f), f).toMatch(/PARTNER_FEE_MODEL_CONFIRMED[\s\S]*PricingCalculator|PricingCalculator[\s\S]*PARTNER_FEE_MODEL_CONFIRMED/);
    expect(read("./components/AdminFinance.tsx")).toContain("HYPOTHETICAL_PLAN_MODEL_NOTE");
  });
});

describe("the UI constant can't enable a financial feature", () => {
  it("is read only by display code — never by an API module or the server", () => {
    const apiDir = new URL("./api/", import.meta.url);
    for (const f of readdirSync(apiDir)) expect(readFileSync(new URL(f, apiDir), "utf8"), f).not.toContain("PARTNER_FEE_MODEL_CONFIRMED");
    const serverGate = readFileSync(new URL("../../server/src/commerce/releaseGates.ts", import.meta.url), "utf8");
    expect(serverGate).not.toContain("PARTNER_FEE_MODEL_CONFIRMED");
    expect(serverGate).toContain('PARTNER_FEE_MODEL_STATUS: "proposed" | "approved" = "proposed"');
  });
});
