import { useEffect, useState } from "react";
import { fetchCompanyDetails } from "./api";

// Who runs HelloCircle, for the About and Contact pages (sitemap audit P1-02).
//
// The operator itself is confirmed by the owner (2026-10-12): Innovative
// Softworks Technologies Limited is the legal company, iSoftworks its
// corporate brand, HelloCircle a product brand — not a separate company and
// not a confirmed registered trading name. Mirrors server/src/companyIdentity.ts.
//
// Every other legal detail (trading name, registered office, CRO and VAT
// numbers, phone, legal and privacy emails) comes ONLY from GET
// /api/policies/company, which returns a Policy CMS value only once it
// appears in a published, legally signed-off policy. No code defaults: until
// approved, the pages say the details are being confirmed. (Admins see what's
// missing in Admin → Policies & trust → Company details.)
//
// HelloCircle's own inboxes (support@ for customers, partners@ for
// partnerships — owner-decided) are operational routing, not legal details;
// an approved SUPPORT_EMAIL in the CMS takes over when there is one.

export interface CompanyDetails {
  brandName: string;
  brandWebsite: string;
  /** The legal operator — owner-confirmed, or the approved CMS value. */
  legalName: string;
  // Other legal identity — null until approved.
  tradingName: string | null;
  registeredAddress: string | null;
  companyNumber: string | null;
  vatNumber: string | null;
  phone: string | null;
  legalEmail: string | null;
  // Operational contact routes.
  supportEmail: string;
  partnersEmail: string;
  /** Pending until an approved PRIVACY_EMAIL exists — never defaulted. */
  privacyEmail: string | null;
}

export const LEGAL_OPERATOR = "Innovative Softworks Technologies Limited";
export const COMPANY_BRAND = { brandName: "iSoftworks", brandWebsite: "https://isoftworks.eu" } as const;
const OPERATIONAL_DEFAULTS = { supportEmail: "support@hellocircle.ie", partnersEmail: "partners@hellocircle.ie" } as const;

const UNCONFIRMED: CompanyDetails = {
  ...COMPANY_BRAND,
  legalName: LEGAL_OPERATOR,
  tradingName: null,
  registeredAddress: null,
  companyNumber: null,
  vatNumber: null,
  phone: null,
  legalEmail: null,
  supportEmail: OPERATIONAL_DEFAULTS.supportEmail,
  partnersEmail: OPERATIONAL_DEFAULTS.partnersEmail,
  privacyEmail: null,
};

/** Map the approved CMS values onto the page model (exported for tests). */
export function companyDetailsFrom(v: Awaited<ReturnType<typeof fetchCompanyDetails>>): CompanyDetails {
  const supportEmail = v.SUPPORT_EMAIL ?? OPERATIONAL_DEFAULTS.supportEmail;
  return {
    ...UNCONFIRMED,
    legalName: v.LEGAL_ENTITY_NAME ?? LEGAL_OPERATOR,
    tradingName: v.TRADING_NAME ?? null,
    registeredAddress: v.REGISTERED_ADDRESS ?? null,
    companyNumber: v.COMPANY_NUMBER ?? null,
    vatNumber: v.VAT_NUMBER ?? null,
    phone: v.PHONE_NUMBER ?? null,
    legalEmail: v.LEGAL_EMAIL ?? null,
    supportEmail,
    privacyEmail: v.PRIVACY_EMAIL ?? null,
  };
}

/** True once the registered details (where, and the CRO number) are approved. */
export function legalIdentityConfirmed(c: CompanyDetails): boolean {
  return !!c.registeredAddress && !!c.companyNumber;
}

export function useCompanyDetails(): CompanyDetails {
  const [details, setDetails] = useState<CompanyDetails>(UNCONFIRMED);
  useEffect(() => {
    let live = true;
    fetchCompanyDetails()
      .then((v) => live && setDetails(companyDetailsFrom(v)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return details;
}
