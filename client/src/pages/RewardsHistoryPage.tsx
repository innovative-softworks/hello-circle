import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchRewardHistory, type RewardHistoryEntry } from "../api";
import { AnalyticsEvent, trackTypedEvent } from "../analyticsEvents";
import { colors, fonts } from "../theme";
import { HelpLine, LearnMore } from "../components/LearnMore";
import { HISTORY_LABEL, PlanRewardsPanel } from "../components/PlanRewardsPanel";
import { Button } from "../components/ui";
import { ScopedWorkspace } from "../components/workspace/ScopedWorkspace";

// Stage 5f — the partner's full reward-points history (vendors /vendor/rewards,
// hosts /manage/rewards). Every entry is a frozen record — points are never
// recalculated here with today's rules.

type Scope = "vendor" | "host";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short", year: "numeric" });

export function RewardsHistoryPage({ scope }: { scope: Scope }) {
  const [items, setItems] = useState<RewardHistoryEntry[] | null>(null);
  const [more, setMore] = useState(true);
  const [error, setError] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const page = 50;
  const load = async (before?: string, beforeId?: string) => {
    setBusy(true);
    try {
      const rows = await fetchRewardHistory(scope, { limit: page, before, beforeId });
      setItems((cur) => (before && cur ? [...cur, ...rows] : rows));
      setMore(rows.length === page);
      setError(false);
      setSignedOut(false);
    } catch (e) {
      if ((e as { status?: number })?.status === 401) setSignedOut(true);
      else setError(true);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    trackTypedEvent(AnalyticsEvent.RewardsHistoryViewed, { scope });
    load();
  }, [scope]);

  return (
    <ScopedWorkspace scope={scope} title="Reward points">
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
      {signedOut && (
        <p role="alert">
          Sign in to see your reward history.{" "}
          <Link to={scope === "vendor" ? "/login?returnTo=%2Fvendor%2Frewards" : "/signin?returnTo=%2Fmanage%2Frewards"}>{scope === "vendor" ? "Partner log in" : "Sign in"}</Link>
        </p>
      )}
      {!items && !error && !signedOut && <p aria-busy="true">Loading…</p>}
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
    </ScopedWorkspace>
  );
}

export function VendorRewardsPage() {
  return <RewardsHistoryPage scope="vendor" />;
}
export function HostRewardsPage() {
  return <RewardsHistoryPage scope="host" />;
}
