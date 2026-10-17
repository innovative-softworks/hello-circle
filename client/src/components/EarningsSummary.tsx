import { VendorStatementCard } from "./VendorStatementCard";
import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchMyPlan, fetchPayouts, type PartnerEarnings } from "../api";
import { colors, fonts, radius } from "../theme";
import { ArrowRightLeft, CircleCheck, Hourglass, Landmark, Wallet, type LucideIcon } from "lucide-react";
import { Box } from "./admin/adminUi";
import { useInWorkspace } from "./workspace/inWorkspace";
import { FieldHelp } from "./FieldHelp";
import { PayoutAccountCard } from "./PayoutAccountCard";
import { VenueSplitsCard } from "./VenueSplitsCard";
import { PlanRewardsPanel } from "./PlanRewardsPanel";
import { PricingCalculator } from "./PricingCalculator";
import { PARTNER_FEE_MODEL_CONFIRMED } from "../partnerPricing";
import { ManageCard as Card, SectionTabs, TabPanel, tableStyle, tdStyle, thStyle, StackTable } from "./ui";
import { EARNINGS_VIEW_LABELS, availableViews, initialView, type EarningsAvailability, type EarningsView } from "./earningsViews";

// Revenue & Connect Stage 3 — a partner's money as the ledger sees it
// (brief §26 partner reports): pending (activity not finished), available
// (completed + review period passed), settled and due, recent settlements.
// Shared by the vendor Earnings tab and the host Earnings tab.
//
// Commercial UX R1 (§3.3) — the tab is split into Balance · Payouts · Plan &
// billing instead of one long stack. Same components and data as before;
// Payouts and Plan & billing only appear when the server says they're on.

const euro = (minor: number) => `${minor < 0 ? "−" : ""}€${(Math.abs(minor) / 100).toFixed(2)}`;

function Tile({ label, value, help }: { label: string; value: number; help: string }) {
  return (
    <div style={{ background: colors.panel, borderRadius: radius.control, padding: "12px 14px", flex: "1 1 160px" }}>
      <div style={{ fontSize: 12, color: colors.mutedLight }}>
        {label}
        <FieldHelp helpKey={help} label={label} />
      </div>
      <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, marginTop: 4, color: value < 0 ? colors.danger : colors.text }}>{euro(value)}</div>
    </div>
  );
}

/** The balance card on its own (pending / available / due / transferred + settlements). */
export function EarningsSummary({ load, payoutsLive = true }: { load: () => Promise<PartnerEarnings>; /** Connect transfers switched on (server `payout-account.enabled`). */ payoutsLive?: boolean }) {
  const [data, setData] = useState<PartnerEarnings | null>(null);
  const [error, setError] = useState(false);
  const inWorkspace = useInWorkspace();
  useEffect(() => {
    load().then(setData).catch(() => setError(true));
  }, [load]);
  if (error) return null; // the transaction list below still shows; balances need finance access
  if (!data) return null;
  const note = payoutsLive
    ? "Transfer eligibility begins after the activity is completed and the review period has passed. Settled earnings are transferred weekly to your Stripe account; Stripe then pays out to your bank."
    : "Your balance is recorded here. Transfers to partners aren't switched on yet — we'll confirm how and when you're paid before you take paid bookings.";
  if (inWorkspace) {
    const tiles: { label: string; value: number; help: string; icon: LucideIcon }[] = [
      { label: "Pending", value: data.pendingMinor, help: "pending_balance", icon: Hourglass },
      { label: "Available", value: data.availableMinor, help: "available_balance", icon: CircleCheck },
      { label: "Settled — transfer due", value: data.transferDueMinor, help: "settled_due", icon: Landmark },
      { label: "Transferred to your Stripe account", value: data.transferredMinor, help: "settled_due", icon: ArrowRightLeft },
    ];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
        <Box title="Your balance" icon={Wallet} subtitle={note}>
        <div className="ws-stats">
          {tiles.map((t) => {
            const Icon = t.icon;
            return (
              <div key={t.label} className="ws-stat" data-zero={t.value === 0 || undefined}>
                <span className="ws-stat-icon" aria-hidden="true">
                  <Icon size={17} strokeWidth={1.9} />
                </span>
                <span className="ws-stat-value" style={t.value < 0 ? { color: "var(--color-danger, #b42318)" } : undefined}>
                  {euro(t.value)}
                </span>
                <span className="ws-stat-label">
                  {t.label}
                  <FieldHelp helpKey={t.help} label={t.label} />
                </span>
              </div>
            );
          })}
        </div>
        </Box>
        {data.settlements.length > 0 && (
          <Box flush title="Settlements">
            <div className="adm-table-wrap">
              <table className="adm-table adm-table--stack">
                <caption className="adm-visually-hidden">Settlements</caption>
                <thead>
                  <tr>
                    <th scope="col">Settlement</th>
                    <th scope="col" className="adm-num">
                      Amount
                    </th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.settlements.map((st) => (
                    <tr key={st.id}>
                      <td data-label="Settlement">{st.runKey}</td>
                      <td data-label="Amount" className="adm-num" style={{ fontWeight: 700 }}>
                        {euro(Number(st.netMinor))}
                      </td>
                      <td data-label="Status">
                        <span className="adm-chip" data-tone={st.status === "transferred" ? "good" : undefined}>
                          {st.status === "due" ? "Transfer due" : st.status === "transferred" ? "Transferred" : st.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Box>
        )}
      </div>
    );
  }
  return (
    <Card style={{ padding: 20, marginBottom: 16 }}>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 4px" }}>Your balance</h2>
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>
        {note}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <Tile label="Pending" value={data.pendingMinor} help="pending_balance" />
        <Tile label="Available" value={data.availableMinor} help="available_balance" />
        <Tile label="Settled — transfer due" value={data.transferDueMinor} help="settled_due" />
        <Tile label="Transferred to your Stripe account" value={data.transferredMinor} help="settled_due" />
      </div>
      {data.settlements.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 16 }}>
          <StackTable>
            <thead>
              <tr>
                <th style={thStyle}>Settlement</th>
                <th style={thStyle}>Amount</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.settlements.map((s) => (
                <tr key={s.id}>
                  <td style={tdStyle}>{s.runKey}</td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{euro(Number(s.netMinor))}</td>
                  <td style={tdStyle}>{s.status === "due" ? "Transfer due" : s.status === "transferred" ? "Transferred" : s.status}</td>
                </tr>
              ))}
            </tbody>
          </StackTable>
        </div>
      )}
    </Card>
  );
}

/**
 * The whole Earnings tab for a vendor or host. `children` is the surface's own
 * transaction list (and, for hosts, trader details) — it stays in Balance.
 * Availability is probed from the same endpoints the cards themselves read, so
 * permissions are exactly the server's: a 403 or an off switch hides the
 * section and its tab.
 */
export function EarningsSections({
  scope,
  loadBalance,
  children,
  trader,
}: {
  scope: "vendor" | "host";
  loadBalance: () => Promise<PartnerEarnings>;
  children?: ReactNode;
  /** Host only: trader details as its own section (the vendor has them under Organisation). */
  trader?: ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const [avail, setAvail] = useState<EarningsAvailability | null>(null);
  const [view, setView] = useState<EarningsView | "trader">(trader && params.get("view") === "trader" ? "trader" : "balance");

  useEffect(() => {
    let live = true;
    Promise.all([
      fetchPayouts(scope).then((p) => !!p.enabled).catch(() => false),
      fetchMyPlan(scope).then((p) => p.state !== "unavailable").catch(() => false),
    ]).then(([payouts, plan]) => {
      if (!live) return;
      const a = { payouts, plan };
      setAvail(a);
      setView(trader && params.get("view") === "trader" ? "trader" : initialView(params, availableViews(a)));
    });
    return () => {
      live = false;
    };
    // Probe once per scope; later URL changes are this component's own.
  }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const views: (EarningsView | "trader")[] = [...(avail ? availableViews(avail) : (["balance"] as EarningsView[])), ...(trader ? (["trader"] as const) : [])];
  const choose = (v: EarningsView | "trader") => {
    setView(v);
    const next = new URLSearchParams(params);
    if (v === "balance") next.delete("view");
    else next.set("view", v);
    // A Stripe return marker must not replay when the section mounts again
    // (?payouts=refresh would send the partner straight back to Stripe).
    next.delete("payouts");
    if (v !== "plan") next.delete("pro");
    setParams(next, { replace: true });
  };

  const idBase = `earnings-${scope}`;
  const balance = (
    <>
      <EarningsSummary load={loadBalance} payoutsLive={avail?.payouts ?? false} />
      <VenueSplitsCard scope={scope} />
      {scope === "vendor" && <VendorStatementCard />}
      {children}
      {/* R3B F1 — the estimator uses the unconfirmed plan fee model; hidden until it's in force. */}
      {PARTNER_FEE_MODEL_CONFIRMED && (
        <div style={{ marginTop: 16 }}>
          <PricingCalculator variant="partner" />
        </div>
      )}
    </>
  );

  return (
    <div data-testid="earnings-sections" data-view={view}>
      {views.length > 1 && (
        <div style={{ marginBottom: 16 }}>
          <SectionTabs idBase={idBase} label="Earnings sections" value={view} onChange={choose} options={views.map((key) => ({ key, label: key === "trader" ? "Trader details" : EARNINGS_VIEW_LABELS[key] }))} />
        </div>
      )}
      {/* Always the same wrapper, so Balance doesn't remount (and refetch)
          when the tabs appear after the availability probe. */}
      <TabPanel idBase={idBase} tab={view} bare={views.length < 2}>
        {view === "balance" && balance}
        {view === "payouts" && <PayoutAccountCard scope={scope} />}
        {view === "plan" && <PlanRewardsPanel scope={scope} variant="full" />}
        {view === "trader" && trader}
      </TabPanel>
    </div>
  );
}
