import { createVendorCoupon, fetchVendorCoupons, fetchVendorListings, setVendorCouponActive } from "../api";
import type { VendorCoupon } from "../api";
import { Loaded, errorMessage, useAdminData } from "./admin/adminUi";
import { useToast } from "./Toast";
import { OfferDialog, OffersList, type OfferInput } from "./workspace/OfferParts";
import type { VendorListingSummary } from "../types";

// Host Manage spec §17 — vendor self-service promo codes, didn't exist at
// all before (coupons were strictly admin/platform-wide, routes/admin.ts).
// The create form is the shared popup in workspace/OfferParts.tsx.
// No "early-bird"/"group discount" special kinds — those are really a
// percent/fixed coupon plus a date window (already have expiresAt) or a
// min-quantity concept that doesn't exist anywhere in the pricing engine
// today; adding one is real pricing-engine work, out of scope here.
export function VendorOffersTab() {
  const toast = useToast();
  const state = useAdminData(async () => {
    const [coupons, listings] = await Promise.all([fetchVendorCoupons(), fetchVendorListings()]);
    return { coupons, listings };
  });

  return (
    <Loaded state={state} title="Couldn't load your offers">
      {({ coupons, listings }) => {
        const toggle = async (c: VendorCoupon) => {
          try {
            await setVendorCouponActive(c.id, !c.active);
            state.reload();
          } catch (e) {
            toast.error(errorMessage(e, "Couldn't change that offer. Try again."));
          }
        };
        const listingName = (c: VendorCoupon) => {
          if (!c.eligibleListingId) return "Any listing";
          const pool = c.eligibleListingType === "centre" ? listings.centres : listings.clubs;
          return pool.find((l: VendorListingSummary) => l.id === c.eligibleListingId)?.name ?? c.eligibleListingType;
        };
        const targets = [
          { value: "", label: "Any of your listings" },
          ...listings.centres.filter((c: VendorListingSummary) => c.status !== "deleted").map((c: VendorListingSummary) => ({ value: `centre:${c.id}`, label: c.name })),
          ...listings.clubs.filter((c: VendorListingSummary) => c.status !== "deleted").map((c: VendorListingSummary) => ({ value: `club:${c.id}`, label: c.name })),
        ];
        const create = async (input: OfferInput) => {
          const [listingType, listingId] = input.target ? (input.target.split(":") as ["centre" | "club", string]) : [undefined, undefined];
          await createVendorCoupon({
            code: input.code,
            kind: input.kind,
            amount: input.amount,
            expiresAt: input.expiresAt,
            eligibleListingType: listingId ? listingType : undefined,
            eligibleListingId: listingId || undefined,
          });
          toast.success(`Offer ${input.code} created`);
          state.reload();
        };
        return (
          <div className="fade-panel">
            <OffersList
              offers={coupons}
              appliesToLabel="Applies to"
              appliesTo={(o) => listingName(o as VendorCoupon) ?? "A listing"}
              onToggle={(o) => toggle(o as VendorCoupon)}
              emptyHint="A code people enter at checkout for money off your listings."
            />
            <OfferDialog targets={targets} targetLabel="Applies to" onCreate={create} />
          </div>
        );
      }}
    </Loaded>
  );
}
