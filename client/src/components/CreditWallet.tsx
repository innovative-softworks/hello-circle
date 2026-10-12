import { useEffect, useState } from "react";
import { fetchMyCreditHistory, fetchMyCredits, type CreditHistoryEntry, type MyCredits } from "../api";
import { colors, fonts } from "../theme";
import { HelpLine, LearnMore } from "./LearnMore";
import { Button } from "./ui";

// Stage 5f — the resident's HelloCircle credit ("wallet"). Customer credit
// only: never called "points" and never mixed with partner reward points.

const euro = (m: number) => `€${(Math.abs(m) / 100).toFixed(2)}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short", year: "numeric" }) : "");
const KIND: Record<CreditHistoryEntry["kind"], string> = {
  granted: "Credit added",
  used: "Used for a booking",
  reserved: "Held for a booking in progress",
  restored: "Returned after a refund",
  released: "Returned — booking not completed",
  expired: "Expired",
};
const SOURCE: Record<string, string> = { goodwill: "a goodwill gesture", promotional: "a promotion", refund: "a refund" };

export function CreditWallet() {
  const [data, setData] = useState<MyCredits | null>(null);
  const [history, setHistory] = useState<CreditHistoryEntry[] | null>(null);
  const [error, setError] = useState(false);
  const load = () => {
    setError(false);
    Promise.all([fetchMyCredits(), fetchMyCreditHistory()])
      .then(([d, h]) => {
        setData(d);
        setHistory(h);
      })
      .catch(() => setError(true));
  };
  useEffect(load, []);

  if (error)
    return (
      <p role="alert">
        Couldn't load your credit. <Button variant="ghost" onClick={load}>Try again</Button>
      </p>
    );
  if (!data) return <p aria-busy="true">Loading…</p>;
  if (!data.enabled) return <p style={{ color: colors.muted }}>HelloCircle credit isn't available right now.</p>;

  return (
    <section aria-labelledby="credit-h" data-testid="credit-wallet">
      <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0, textTransform: "uppercase", color: colors.muted, margin: 0 }}>Available credit</p>
      <h2 id="credit-h" style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 34, margin: "2px 0" }} data-testid="credit-balance">
        {euro(data.balanceMinor)}
      </h2>
      <p style={{ fontSize: 13.5, color: colors.muted, margin: "0 0 4px" }}>
        {data.nextExpiry ? `Some of it expires on ${day(data.nextExpiry)}.` : data.balanceMinor > 0 ? "" : "You don't have any credit at the moment."}
        {data.reservedMinor ? ` ${euro(data.reservedMinor)} is held for a booking you haven't finished paying for.` : ""}
      </p>
      <HelpLine helpKey="credit_customer" />
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
        <LearnMore helpKey="credit_coupons" label="Coupons and credit" />
        <LearnMore helpKey="credit_refund_restoration" label="Credit after a refund" />
      </div>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18, margin: "10px 0 6px" }}>History</h3>
      {history && history.length === 0 && <p style={{ color: colors.muted }}>No credit activity yet.</p>}
      {history && history.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }} data-testid="credit-history">
          {history.map((e, i) => (
            <li key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: `1px solid ${colors.border}`, fontSize: 14 }} data-kind={e.kind}>
              <span>
                <strong>{KIND[e.kind]}</strong>
                {e.kind === "granted" && e.creditType ? ` — from ${SOURCE[e.creditType]}` : ""}
                {e.sourceRef ? ` · booking ${e.sourceRef}` : ""}
                <span style={{ display: "block", fontSize: 12.5, color: colors.muted }}>
                  {day(e.at)}
                  {e.kind === "granted" && e.expiresAt ? ` · expires ${day(e.expiresAt)}` : ""}
                </span>
              </span>
              <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{e.amountMinor >= 0 ? `+ ${euro(e.amountMinor)}` : `− ${euro(e.amountMinor)}`}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
