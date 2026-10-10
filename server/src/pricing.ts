import { db } from "./db/index.js";

/** Standard Irish VAT rate, applied to the taxable amount (subtotal minus
 * any coupon discount) — not to refundable deposits, which aren't a supply. */
export const VAT_RATE = 0.23;
/** Hello Circle's service fee, shown as a separate line item on top of the
 * vendor's price — the vendor is paid their full listed price. */
export const PLATFORM_FEE_RATE = 0.05;

export interface PricingBreakdown {
  subtotalCents: number;
  discountCents: number;
  taxableCents: number;
  vatCents: number;
  platformFeeCents: number;
  depositCents: number;
  totalCents: number;
  couponCode: string | null;
}

export function computePricing(subtotalCents: number, depositCents: number, discountCents: number, couponCode: string | null): PricingBreakdown {
  const taxableCents = Math.max(0, subtotalCents - discountCents);
  const vatCents = Math.round(taxableCents * VAT_RATE);
  const platformFeeCents = Math.round(taxableCents * PLATFORM_FEE_RATE);
  const totalCents = taxableCents + vatCents + platformFeeCents + depositCents;
  return { subtotalCents, discountCents, taxableCents, vatCents, platformFeeCents, depositCents, totalCents, couponCode };
}

/** Open Booking (implementation plan Phase 3) — splits a booking's total
 * evenly across the booker plus every open spot, rounding up so the sum
 * of what joiners pay never falls short of the booking's own total.
 * Deliberately simple: each joiner pays their own share via the existing
 * paid-game Stripe flow (checkoutService.ts) as new, separate revenue —
 * this does not reduce or refund the original booker's charge. Real cost-
 * splitting (crediting the booker back as others join) would need actual
 * refund automation, which this app deliberately doesn't have yet (see
 * bookings.ts/registrations.ts/games.ts's identical "refunds are handled
 * off-platform" convention on cancellation). */
export function splitCostPerPerson(totalCents: number, openSpots: number): number {
  return Math.ceil(totalCents / (openSpots + 1));
}

interface CouponRow {
  id: number;
  code: string;
  kind: "percent" | "fixed";
  amount: number;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  active: number;
  eligible_listing_type: string | null;
  eligible_listing_id: string | null;
  created_by_vendor_id: string | null;
  created_by_resident_id: string | null;
  funding: "partner" | "platform" | "split";
  platform_share_bps: number;
  min_spend_cents: number | null;
  max_discount_cents: number | null;
  per_customer_limit: number | null;
  starts_at: string | null;
  archived_at: string | null;
}

/** Commerce audit R4 — server-side bounds for any coupon a partner or admin
 * creates. Returns an error message, or null when the shape is valid. */
export function couponAmountError(kind: unknown, amount: unknown): string | null {
  if (kind !== "percent" && kind !== "fixed") return "kind must be percent or fixed";
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) return "Amount must be a whole number of at least 1";
  if (kind === "percent" && amount > 100) return "Percent amount must be 1-100";
  return null;
}

const LISTING_OWNER_SQL: Record<string, string> = {
  centre: `SELECT vendor_id FROM centres WHERE id = ?`,
  club: `SELECT vendor_id FROM clubs WHERE id = ?`,
  program: `SELECT vendor_id FROM programs WHERE id = ?`,
  experience: `SELECT vendor_id FROM experiences WHERE id = ?`,
};

/** True when the listing belongs to any vendor in the coupon creator's org —
 * the same org scope orgVendorIds() gives the vendor dashboard. */
async function listingInCreatorOrg(creatorVendorId: string, ctx: CouponListingContext): Promise<boolean> {
  const sql = LISTING_OWNER_SQL[ctx.listingType];
  if (!sql) return false;
  const listing = (await db.prepare(sql).get(ctx.listingId)) as { vendor_id: string | null } | undefined;
  if (!listing?.vendor_id) return false;
  if (listing.vendor_id === creatorVendorId) return true;
  const row = (await db
    .prepare(`SELECT 1 as ok FROM users a JOIN users b ON a.org_id = b.org_id WHERE a.id = ? AND b.id = ? AND a.org_id IS NOT NULL`)
    .get(creatorVendorId, listing.vendor_id)) as { ok: number } | undefined;
  return !!row;
}

export type CouponRejection = "invalid" | "not_yet_active" | "expired" | "min_spend" | "limit" | "not_applicable";
export interface CouponResult {
  valid: boolean;
  error?: string;
  /** Stage 5f — machine-readable reason for a rejected code (the UI picks its own wording). */
  reason?: CouponRejection;
  discountCents?: number;
  code?: string;
  /** Commerce Engine Phase 3 — who pays for the discount. */
  couponId?: number;
  funding?: "partner" | "platform" | "split";
  /** Share of the discount HelloCircle funds, in basis points (0 = partner pays all). */
  platformShareBps?: number;
  perCustomerLimit?: number | null;
}

/** Host Manage spec §17 — a vendor-created coupon may be scoped to one
 * listing (eligible_listing_type/id both set); every existing admin/
 * platform-wide coupon has both NULL and keeps applying everywhere,
 * unchanged. Only checked when the caller actually knows which listing
 * the code is being used against (bookings.ts/registrations.ts/
 * experiences.ts all do); the standalone /coupons/validate preview
 * endpoint has no listing context to check against, so it validates
 * everything else about the code but can't preview a listing mismatch —
 * the real enforcement still happens at checkout, where this is called
 * again with real context. */
export interface CouponListingContext {
  listingType: string;
  listingId: string;
}

/** Validates a coupon against a subtotal and returns the discount it grants
 * — never trusts a client-supplied discount amount. */
export async function evaluateCoupon(rawCode: string, subtotalCents: number, listingContext?: CouponListingContext): Promise<CouponResult> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { valid: false, error: "Enter a code", reason: "invalid" };

  const row = (await db.prepare(`SELECT * FROM coupons WHERE code = ?`).get(code)) as CouponRow | undefined;
  if (!row || !row.active || row.archived_at) return { valid: false, error: "That code isn't valid", reason: "invalid" };
  if (row.starts_at && new Date(row.starts_at) > new Date()) return { valid: false, error: "That code isn't active yet", reason: "not_yet_active" };
  if (row.expires_at && new Date(row.expires_at) < new Date()) return { valid: false, error: "That code has expired", reason: "expired" };
  if (row.min_spend_cents !== null && row.min_spend_cents !== undefined && subtotalCents < row.min_spend_cents) {
    return { valid: false, error: `That code needs a minimum spend of €${(row.min_spend_cents / 100).toFixed(2)}`, reason: "min_spend" };
  }
  if (row.max_uses !== null && row.used_count >= row.max_uses) return { valid: false, error: "That code has been fully redeemed", reason: "limit" };
  // Commerce audit R4 — a malformed row (e.g. created before partner-route
  // validation existed) never applies, rather than producing a negative or
  // >100% discount.
  if (couponAmountError(row.kind, row.amount)) return { valid: false, error: "That code isn't valid", reason: "invalid" };
  if (row.eligible_listing_id) {
    const matches = listingContext && row.eligible_listing_type === listingContext.listingType && row.eligible_listing_id === listingContext.listingId;
    if (!matches) return { valid: false, error: "That code isn't valid for this listing", reason: "not_applicable" };
  } else if (row.created_by_resident_id) {
    // Host coupons are always game-scoped at creation; one without a game
    // must never fall through to "valid everywhere".
    return { valid: false, error: "That code isn't valid for this listing", reason: "not_applicable" };
  } else if (row.created_by_vendor_id && listingContext) {
    // Commerce audit R4 — a vendor coupon with no single listing means "all
    // of this vendor's org's listings", never every listing platform-wide.
    // Without listing context (the standalone preview) it can't be checked;
    // checkout always calls again with context.
    if (!(await listingInCreatorOrg(row.created_by_vendor_id, listingContext))) return { valid: false, error: "That code isn't valid for this listing", reason: "not_applicable" };
  }

  let discountCents = row.kind === "percent" ? Math.round((subtotalCents * row.amount) / 100) : Math.min(row.amount, subtotalCents);
  if (row.max_discount_cents !== null && row.max_discount_cents !== undefined) discountCents = Math.min(discountCents, row.max_discount_cents);
  // Partner-created coupons are partner-funded whatever the stored value says.
  const partnerOwned = !!(row.created_by_vendor_id || row.created_by_resident_id);
  const funding = partnerOwned ? "partner" : (row.funding ?? "platform");
  const platformShareBps = funding === "partner" ? 0 : funding === "platform" ? 10_000 : Math.max(0, Math.min(10_000, Number(row.platform_share_bps ?? 10_000)));
  return { valid: true, discountCents, code: row.code, couponId: row.id, funding, platformShareBps, perCustomerLimit: row.per_customer_limit ?? null };
}

/** Called from stripeWebhook.ts's confirm* functions, after payment has
 * already succeeded — so this can no longer reject the booking/registration
 * itself if the coupon turns out to be exhausted. The conditional WHERE
 * (rather than a plain increment) closes the TOCTOU race where two
 * concurrent checkouts both pass evaluateCoupon's read while used_count is
 * one below max_uses and both then increment — at most one of them can win
 * this update. If it doesn't apply, the charge already happened; that's
 * logged for manual/admin follow-up (refund or honor it) rather than
 * silently over-redeeming a single-use code. */
export async function recordCouponUse(code: string) {
  const normalized = code.trim().toUpperCase();
  const info = await db
    .prepare(`UPDATE coupons SET used_count = used_count + 1 WHERE code = ? AND (max_uses IS NULL OR used_count < max_uses)`)
    .run(normalized);
  if (info.changes === 0) {
    console.error(`[coupons] recordCouponUse: "${normalized}" was already at max_uses when this paid order tried to record its use — needs manual review`);
  }
}

export interface CouponLimits {
  minSpendCents: number | null;
  maxDiscountCents: number | null;
  perCustomerLimit: number | null;
  startsAt: string | null;
}

/** Commerce Engine Phase 3 — the optional per-coupon limits any creator
 * (admin, vendor, host) may set. Absent/null means "no limit" — exactly the
 * pre-Phase-3 behaviour. Dates are taken as given (ISO) and stored UTC. */
export function parseCouponLimits(b: Record<string, unknown>): { ok: true; limits: CouponLimits } | { ok: false; error: string } {
  const intOrNull = (v: unknown, min: number, label: string): number | null | string => {
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "number" || !Number.isInteger(v) || v < min) return `${label} must be a whole number of at least ${min}`;
    return v;
  };
  const minSpend = intOrNull(b.minSpendCents, 0, "Minimum spend");
  if (typeof minSpend === "string") return { ok: false, error: minSpend };
  const maxDiscount = intOrNull(b.maxDiscountCents, 1, "Maximum discount");
  if (typeof maxDiscount === "string") return { ok: false, error: maxDiscount };
  const perCustomer = intOrNull(b.perCustomerLimit, 1, "Uses per customer");
  if (typeof perCustomer === "string") return { ok: false, error: perCustomer };
  let startsAt: string | null = null;
  if (b.startsAt !== undefined && b.startsAt !== null && b.startsAt !== "") {
    const d = new Date(String(b.startsAt));
    if (Number.isNaN(d.getTime())) return { ok: false, error: "Start date isn't a valid date" };
    startsAt = d.toISOString().slice(0, 19).replace("T", " ");
  }
  return { ok: true, limits: { minSpendCents: minSpend, maxDiscountCents: maxDiscount, perCustomerLimit: perCustomer, startsAt } };
}
