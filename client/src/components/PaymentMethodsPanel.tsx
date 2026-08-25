import { useEffect, useState } from "react";
import { fetchPaymentMethods, removePaymentMethod, setDefaultPaymentMethod } from "../api";
import { CardIcon } from "./icons";
import { Button, EmptyState } from "./ui";
import { colors, fonts } from "../theme";
import type { SavedPaymentMethod } from "../types";

// Payment-methods screen (implementation backlog #1) — list/set-default/
// remove only. There's no "add a card" form here on purpose: a card gets
// saved the idiomatic way for a Stripe-Checkout-based app — the "Save my
// payment details" checkbox Stripe Checkout itself shows during a real
// purchase (see checkoutService.ts's createCheckoutSession(),
// saved_payment_method_options) — not a separate SetupIntent flow.
// Unverified against live Stripe: no STRIPE_SECRET_KEY is configured in
// this session's dev environment (server/.env), so this has been
// typecheck/build-verified and matches the SDK's documented shapes, but
// never exercised against a real Stripe account.

const CARD_BRAND_LABEL: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
};

export function PaymentMethodsPanel() {
  const [methods, setMethods] = useState<SavedPaymentMethod[] | null>(null);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = () => {
    fetchPaymentMethods()
      .then((r) => {
        setMethods(r.methods);
        setDefaultId(r.defaultMethodId);
      })
      .catch(() => setUnavailable(true));
  };

  useEffect(load, []);

  const handleSetDefault = async (id: string) => {
    setDefaultId(id);
    await setDefaultPaymentMethod(id);
  };

  const handleRemove = async (id: string) => {
    await removePaymentMethod(id);
    setMethods((m) => m && m.filter((mm) => mm.id !== id));
  };

  if (unavailable) return null;
  if (methods === null) return null;

  return (
    <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <CardIcon size={16} style={{ color: colors.greenText }} />
        <span style={{ fontFamily: fonts.display, fontSize: 15, fontWeight: 700 }}>Payment methods</span>
      </div>
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "8px 0 12px" }}>
        Check "Save my payment details" during checkout on any booking to add a card here — there's no separate
        add-a-card form.
      </p>
      {methods.length === 0 ? (
        <EmptyState icon={<CardIcon size={20} />} title="No saved cards yet" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {methods.map((m) => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: colors.bg, borderRadius: 10, padding: "10px 14px", fontSize: 13.5 }}>
              <span>
                {CARD_BRAND_LABEL[m.brand] ?? m.brand} •••• {m.last4}
                <span style={{ color: colors.faint, marginLeft: 8 }}>Exp {String(m.expMonth).padStart(2, "0")}/{m.expYear}</span>
                {m.id === defaultId && (
                  <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: 999, padding: "2px 8px" }}>Default</span>
                )}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                {m.id !== defaultId && (
                  <Button variant="ghost" onClick={() => handleSetDefault(m.id)}>Set default</Button>
                )}
                <Button variant="danger" onClick={() => handleRemove(m.id)}>Remove</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
