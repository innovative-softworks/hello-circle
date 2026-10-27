import { useEffect, useState } from "react";
import { CreditCard, Lock } from "lucide-react";
import { fetchPaymentMethods, removePaymentMethod, setDefaultPaymentMethod } from "../../api";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/Toast";
import { Button, LoadErrorState, RowSkeleton } from "../../components/ui";
import type { SavedPaymentMethod } from "../../types";
import { CreditWallet } from "../../components/CreditWallet";
import { useUrlParam } from "../../useUrlTab";
import { AccountEmpty, AccountPage, AccountSection, AccountTabContext, Note, SegmentedTabs, StatusTag, TextButton } from "./accountUi";
import { PassesPage } from "./PassesPage";
import { ReceiptsPage } from "./ReceiptsPage";

// Saved cards (implementation backlog #1): list / make default / remove. A
// card is saved only through Stripe Checkout's own "Save my payment details"
// box during a real purchase — there is deliberately no add-a-card form.
// Only the masked details Stripe returns are ever shown.

const BRAND: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover" };

function isExpired(m: SavedPaymentMethod, now = new Date()): boolean {
  return m.expYear < now.getFullYear() || (m.expYear === now.getFullYear() && m.expMonth < now.getMonth() + 1);
}

type State = { status: "loading" } | { status: "ready"; methods: SavedPaymentMethod[]; defaultId: string | null } | { status: "unavailable" } | { status: "error" };

function SavedCards() {
  const confirm = useConfirm();
  const toast = useToast();
  const [state, setState] = useState<State>({ status: "loading" });
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    setState({ status: "loading" });
    fetchPaymentMethods()
      .then((r) => setState({ status: "ready", methods: r.methods, defaultId: r.defaultMethodId }))
      .catch((e: unknown) => setState({ status: (e as { status?: number })?.status === 503 ? "unavailable" : "error" }));
  };
  useEffect(load, []);

  const makeDefault = async (m: SavedPaymentMethod) => {
    if (state.status !== "ready") return;
    const before = state.defaultId;
    setBusy(m.id);
    setState({ ...state, defaultId: m.id });
    try {
      await setDefaultPaymentMethod(m.id);
      toast.success(`${BRAND[m.brand] ?? m.brand} •••• ${m.last4} is now your default card`);
    } catch {
      setState((s) => (s.status === "ready" ? { ...s, defaultId: before } : s));
      toast.error("Your default card wasn't changed. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (m: SavedPaymentMethod) => {
    const ok = await confirm({
      title: "Remove this card?",
      message: `${BRAND[m.brand] ?? m.brand} •••• ${m.last4} won't be offered at checkout any more. You can save it again next time you pay.`,
      confirmLabel: "Remove card",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(m.id);
    try {
      await removePaymentMethod(m.id);
      setState((s) => (s.status === "ready" ? { ...s, methods: s.methods.filter((x) => x.id !== m.id) } : s));
      toast.success("Card removed");
    } catch {
      toast.error("That card wasn't removed. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <AccountPage eyebrow="Account" title="Payment methods" lede="Cards you've saved for faster checkout." narrow>
      {state.status === "loading" ? (
        <div style={{ marginTop: 24 }}><RowSkeleton /></div>
      ) : state.status === "error" ? (
        <LoadErrorState title="We couldn't load your saved cards." onRetry={load} />
      ) : state.status === "unavailable" ? (
        <AccountEmpty icon={<CreditCard size={20} aria-hidden="true" />} title="Card payments aren't available right now">
          You can't manage saved cards at the moment. Your bookings aren't affected.
        </AccountEmpty>
      ) : (
        <>
          <AccountSection title="Saved cards">
            {state.methods.length === 0 ? (
              <AccountEmpty icon={<CreditCard size={20} aria-hidden="true" />} title="No saved cards">
                To save a card, tick “Save my payment details” when you pay at checkout. It will show here for next time.
              </AccountEmpty>
            ) : (
              <ul className="acct-list" aria-label="Saved cards">
                {state.methods.map((m) => {
                  const expired = isExpired(m);
                  const isDefault = m.id === state.defaultId;
                  const name = `${BRAND[m.brand] ?? m.brand} •••• ${m.last4}`;
                  return (
                    <li key={m.id} className="acct-item" data-muted={expired ? "true" : undefined}>
                      <span className="acct-thumb" aria-hidden="true"><CreditCard size={20} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="acct-item-title">{name}</div>
                        <div className="acct-item-meta">{expired ? "Expired" : "Expires"} {String(m.expMonth).padStart(2, "0")}/{m.expYear}</div>
                      </div>
                      <div className="acct-item-side">
                        {isDefault && <StatusTag tone="ok">Default</StatusTag>}
                        {expired && <StatusTag tone="warn">Expired</StatusTag>}
                        {!isDefault && !expired && (
                          <Button variant="ghost" onClick={() => makeDefault(m)} disabled={busy === m.id} aria-label={`Make ${name} your default card`}>Make default</Button>
                        )}
                        <TextButton danger onClick={() => remove(m)} disabled={busy === m.id} aria-label={`Remove ${name}`}>Remove</TextButton>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </AccountSection>
          <AccountSection title="Adding a card">
            <p className="acct-section-desc" style={{ marginTop: 0 }}>
              There's no separate form. When you next pay for something, tick “Save my payment details” on the payment page and the card is added here.
            </p>
          </AccountSection>
          <AccountSection>
            <Note icon={<Lock size={16} aria-hidden="true" />}>
              Your card details are held by Stripe, our payment provider. HelloCircle only ever sees the card type, the last four digits and the expiry date.
            </Note>
          </AccountSection>
        </>
      )}
    </AccountPage>
  );
}

// Payments (sidebar merge 2026-10-24): saved cards, receipts, passes and
// HelloCircle credit as tabs of one page. Old ?tab=receipts / passes / credit
// links land here on the matching ?view= (pages/Profile.tsx redirects).

type View = "cards" | "receipts" | "passes" | "credit";

export function PaymentsPage({ creditsEnabled }: { creditsEnabled: boolean }) {
  const [view, setView] = useUrlParam<View>("view", "cards");
  const views: { key: View; label: string }[] = [
    { key: "cards", label: "Cards" },
    { key: "receipts", label: "Receipts" },
    { key: "passes", label: "Passes" },
    ...(creditsEnabled || view === "credit" ? [{ key: "credit" as View, label: "Credit" }] : []),
  ];
  return (
    <AccountPage eyebrow="Account" title="Payments" lede="Your saved cards, what you've paid for, and passes or credit you can spend.">
      <div style={{ marginTop: 18 }}>
        <SegmentedTabs label="Payments" value={view} onChange={setView} options={views} />
      </div>
      <AccountTabContext.Provider value={true}>
        {view === "cards" && <SavedCards />}
        {view === "receipts" && <ReceiptsPage />}
        {view === "passes" && <PassesPage />}
        {view === "credit" && (
          <div style={{ marginTop: 8 }}>
            <CreditWallet />
          </div>
        )}
      </AccountTabContext.Provider>
    </AccountPage>
  );
}
