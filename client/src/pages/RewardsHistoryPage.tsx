import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchRewardHistory, type RewardHistoryEntry } from "../api";
import { AnalyticsEvent, trackTypedEvent } from "../analyticsEvents";
import { colors, fonts } from "../theme";
import { HelpLine, LearnMore } from "../components/LearnMore";
import { HISTORY_LABEL, PlanRewardsPanel } from "../components/PlanRewardsPanel";
import { Button } from "../components/ui";

// Stage 5f — the partner's full reward-points history (vendors /vendor/rewards,
// hosts /manage/rewards). Every entry is a frozen record — points are never
// recalculated here with today's rules.

type Scope = "vendor" | "host";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short", year: "numeric" });

export function RewardsHistoryPage({ scope }: { scope: Scope }) {
  const [items, setItems] = useState<RewardHistoryEntry[] | null>(null);
  const [more, setMore] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const page = 50;
  const load = async (before?: string, beforeId?: string) => {
    setBusy(true);
    try {
      const rows = await fetchRewardHistory(scope, { limit: page, before, beforeId });
      setItems((cur) => (before && cur ? [...cur, ...rows] : rows));
      setMore(rows.length === page);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    trackTypedEvent(AnalyticsEvent.RewardsHistoryViewed, { scope });
    load();
  }, [scope]);

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "24px 16px 64px", background: colors.bg, color: colors.text }}>
      <Link to={scope === "vendor" ? "/vendor" : "/manage"} style={{ fontSize: 13.5, color: colors.text, fontWeight: 700 }}>← Back to your dashboard</Link>
      <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(32px, 3.8vw, 52px)", margin: "6px 0" }}>Reward points</h1>
      <HelpLine helpKey="points_earning" />
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "4px 0 16px" }}>
        <LearnMore helpKey="points_pending" label="Pending vs available" />
        <LearnMore helpKey="points_split" label="Shared bookings" />
        <LearnMore helpKey="points_debt" label="Points debt" />
      </div>
      <PlanRewardsPanel scope={scope} variant="full" />
      <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20, margin: "24px 0 8px" }}>History</h2>
      {error && (
        <p role="alert">
          Couldn't load your history. <Button variant="ghost" onClick={() => load()}>Try again</Button>
        </p>
      )}
      {!items && !error && <p aria-busy="true">Loading…</p>}
      {items && items.length === 0 && <p style={{ color: colors.muted }} data-testid="history-empty">No points yet — they're added when your earnings are settled.</p>}
      {items && items.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }} data-testid="history">
            <caption style={{ textAlign: "left", fontSize: 12.5, color: colors.muted, paddingBottom: 6 }}>Newest first</caption>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: `2px solid ${colors.text}` }}>
                <th scope="col" style={{ padding: "6px 8px 6px 0" }}>Date</th>
                <th scope="col" style={{ padding: "6px 8px" }}>What happened</th>
                <th scope="col" style={{ padding: "6px 8px" }}>Booking</th>
                <th scope="col" style={{ padding: "6px 0 6px 8px", textAlign: "right" }}>Points</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} style={{ borderBottom: `1px solid ${colors.border}` }} data-kind={e.kind}>
                  <td style={{ padding: "8px 8px 8px 0", whiteSpace: "nowrap" }}>{day(e.at)}</td>
                  <td style={{ padding: 8 }}>
                    {HISTORY_LABEL[e.kind]}
                    {e.note && <div style={{ fontSize: 12.5, color: colors.muted }}>{e.note}</div>}
                  </td>
                  <td style={{ padding: 8 }}>{e.sourceRef ?? "—"}</td>
                  <td style={{ padding: "8px 0 8px 8px", textAlign: "right", fontWeight: 700 }}>{e.points > 0 ? `+${e.points.toLocaleString("en-IE")}` : e.points.toLocaleString("en-IE")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {items && more && items.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Button variant="ghost" disabled={busy} onClick={() => load(items[items.length - 1].at, items[items.length - 1].id)}>
            Show older
          </Button>
        </div>
      )}
    </main>
  );
}

export function VendorRewardsPage() {
  return <RewardsHistoryPage scope="vendor" />;
}
export function HostRewardsPage() {
  return <RewardsHistoryPage scope="host" />;
}
