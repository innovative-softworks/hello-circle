import { createHostGameCoupon, fetchHostGameCoupons, fetchMyGames, setHostGameCouponActive } from "../api";
import type { HostGameCoupon } from "../api";
import { Loaded, errorMessage, useAdminData } from "./admin/adminUi";
import { useToast } from "./Toast";
import { OfferDialog, OffersList, type OfferInput } from "./workspace/OfferParts";
import type { Game } from "../types";

// Vendor-parity pass, Phase 25 — same shared offer popup as VendorOffers.tsx,
// but a specific session is always required (not "any of your games") — see
// games.ts's POST /coupons for why that's a real constraint.
export function HostOffersTab() {
  const toast = useToast();
  const state = useAdminData(async () => {
    const [coupons, games] = await Promise.all([fetchHostGameCoupons(), fetchMyGames({ hostedOnly: true })]);
    return { coupons, games };
  });

  return (
    <Loaded state={state} title="Couldn't load your offers">
      {({ coupons, games }) => {
        const toggle = async (c: HostGameCoupon) => {
          try {
            await setHostGameCouponActive(c.id, !c.active);
            state.reload();
          } catch (e) {
            toast.error(errorMessage(e, "Couldn't change that offer. Try again."));
          }
        };
        const gameLabel = (c: HostGameCoupon) => {
          const g = games.find((g: Game) => g.id === c.eligibleListingId);
          return g ? `${g.activityLabel} — ${g.date}` : "Session";
        };
        const priced = games.filter((g: Game) => g.priceCents);
        const targets = priced.map((g: Game) => ({ value: g.id, label: `${g.activityLabel} — ${g.date}` }));
        const create = async (input: OfferInput) => {
          await createHostGameCoupon({ code: input.code, kind: input.kind, amount: input.amount, expiresAt: input.expiresAt, gameId: input.target });
          toast.success(`Offer ${input.code} created`);
          state.reload();
        };
        return (
          <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {priced.length === 0 && <p className="adm-note" style={{ margin: 0 }}>Offers only apply to a session with a price. Host a paid session first.</p>}
            <OffersList
              offers={coupons}
              appliesToLabel="Session"
              appliesTo={(o) => gameLabel(o as HostGameCoupon)}
              onToggle={(o) => toggle(o as HostGameCoupon)}
              emptyHint="A code people enter when they pay for one of your sessions."
            />
            <OfferDialog targets={targets} targetLabel="Session" onCreate={create} />
          </div>
        );
      }}
    </Loaded>
  );
}
