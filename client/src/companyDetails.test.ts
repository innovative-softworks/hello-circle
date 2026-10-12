import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_OPERATOR, companyDetailsFrom, legalIdentityConfirmed } from "./companyDetails";

// Company identity (owner decisions, 2026-10-12): the legal operator is
// confirmed and always named; every other legal detail only ever comes from
// approved Policy CMS values, never from code defaults.

describe("company details", () => {
  it("names the confirmed operator, and nothing else legal until it's approved", () => {
    const c = companyDetailsFrom({});
    expect(c.legalName).toBe("Innovative Softworks Technologies Limited");
    expect(c.brandName).toBe("iSoftworks");
    for (const k of ["tradingName", "registeredAddress", "companyNumber", "vatNumber", "phone", "legalEmail", "privacyEmail"] as const) {
      expect(c[k], k).toBeNull();
    }
    expect(legalIdentityConfirmed(c)).toBe(false);
    // Owner-decided operational inboxes.
    expect(c.supportEmail).toBe("support@hellocircle.ie");
    expect(c.partnersEmail).toBe("partners@hellocircle.ie");
  });

  it("uses approved values, and never borrows the support email for privacy", () => {
    const c = companyDetailsFrom({ REGISTERED_ADDRESS: "1 Main St", COMPANY_NUMBER: "123456", SUPPORT_EMAIL: "help@example.ie" });
    expect(legalIdentityConfirmed(c)).toBe(true);
    expect(c.supportEmail).toBe("help@example.ie");
    expect(c.privacyEmail).toBeNull();
    expect(companyDetailsFrom({ PRIVACY_EMAIL: "privacy@example.ie" }).privacyEmail).toBe("privacy@example.ie");
  });

  it("keeps the operator in one place and hard-codes no unapproved legal detail", () => {
    const unapproved = /Station Walk|Newbridge|Kildare|W12 ?XA59|\+353|CRO \d|IE\d{7}/;
    for (const f of ["./companyDetails.ts", "./pages/About.tsx", "./pages/Contact.tsx", "./components/Footer.tsx"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src, f).not.toMatch(unapproved);
      // The operator's name is written out only in companyDetails.ts (LEGAL_OPERATOR).
      if (f !== "./companyDetails.ts") expect(src, f).not.toContain(LEGAL_OPERATOR);
    }
  });
});
