import type { AnalyticsFunnelRow, LiquidityLabel, LiquidityScore, MarketplaceHealth as MarketplaceHealthData, ReferralAttributionRow } from "../types";
import { colors, fonts, radius } from "../theme";
import { SearchIcon } from "./icons";
import { Card, EmptyState } from "./ui";

// Marketplace health / liquidity (participation-intent plan Phase 2) — an
// admin-only view combining Supply, Participation and per-activity+county
// Liquidity into one dashboard load (see admin.ts's GET /marketplace-health).
// LOW/DEVELOPING/HEALTHY/HIGH is internal terminology only — never shown to
// a resident, matching the source doc's explicit instruction.

const LABEL_STYLE: Record<LiquidityLabel, { bg: string; color: string }> = {
  LOW: { bg: colors.dangerBg, color: colors.danger },
  DEVELOPING: { bg: colors.orangeBg, color: colors.orangeDark },
  HEALTHY: { bg: colors.greenBg, color: colors.greenText },
  HIGH: { bg: colors.dark, color: "#fff" },
};

export function LiquidityBadge({ label }: { label: LiquidityLabel }) {
  const s = LABEL_STYLE[label];
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: s.color, background: s.bg, borderRadius: 100, padding: "3px 10px", flex: "none" }}>{label}</span>
  );
}

function statBlock(value: number | string, label: string) {
  return (
    <div style={{ flex: 1, minWidth: 130, padding: "14px 16px" }}>
      <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 12, color: colors.mutedLight, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

// Funnel event labels (post-audit hardening pass) — see server/src/analytics.ts's
// AnalyticsEventType for the underlying vocabulary this maps.
const FUNNEL_LABELS: Record<string, string> = {
  search_performed: "Searched",
  intent_created: "Intent created",
  match_notified: "Matched (notified)",
  match_viewed: "Match viewed",
  game_joined: "Joined a game",
  circle_joined: "Joined a Circle",
  attended: "Attended",
  repeat_joined: "Repeat join",
};

export function MarketplaceHealthView({
  data,
  referrals,
  funnel,
}: {
  data: MarketplaceHealthData | null;
  referrals?: ReferralAttributionRow[] | null;
  funnel?: AnalyticsFunnelRow[] | null;
}) {
  if (!data) return null;
  const { supply, participation, liquidity } = data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 4px" }}>Supply</h4>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 8px" }}>Upcoming games/circles and who's hosting them, platform-wide.</p>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {statBlock(supply.upcomingGames, "Upcoming games")}
          {statBlock(supply.openSpots, "Open spots")}
          {statBlock(supply.activeCircles, "Active Circles")}
          {statBlock(supply.activeHosts, "Hosts (last 30 days)")}
        </div>
      </Card>

      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 4px" }}>Participation (last 90 days)</h4>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 8px" }}>Joined vs. actually attended, and how many residents came back.</p>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {statBlock(participation.joined, "Joined")}
          {statBlock(participation.attended, "Attended")}
          {statBlock(participation.noShow, "No-show / unconfirmed")}
          {statBlock(`${Math.round(participation.repeatRate * 100)}%`, "Repeat participants")}
        </div>
      </Card>

      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 4px" }}>Liquidity by activity + county</h4>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 16px" }}>
          Demand (active interest) vs. supply (open spots + upcoming plans), ranked by combined signal.
        </p>
        {liquidity.length === 0 ? (
          <EmptyState icon={<SearchIcon size={22} />} title="Nothing to score yet" subtitle="Once intents or games start landing for an activity+county pair, it'll show up here." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {liquidity.map((row: LiquidityScore) => (
              <div
                key={`${row.activityLabel}::${row.county}`}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: colors.bg, borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5 }}
              >
                <span>
                  {row.activityLabel}
                  {row.county ? ` · ${row.county}` : ""}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: colors.muted }}>
                  <span>{row.demandCount} interested</span>
                  <span>{row.upcomingPlans} plans</span>
                  <span>{row.openSpots} open spots</span>
                  <LiquidityBadge label={row.label} />
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {referrals !== undefined && (
        <Card>
          <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 4px" }}>Referrals — estimated attribution</h4>
          <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 16px" }}>
            A visitor landed with a share link, then made a real booking, registration, or game join within 7 days — a best-effort estimate, not a hard
            link (an anonymous visitor's game join still can't be traced, since that only works once they're signed in).
          </p>
          {!referrals ? (
            <EmptyState icon={<SearchIcon size={22} />} title="Loading…" />
          ) : referrals.length === 0 ? (
            <EmptyState icon={<SearchIcon size={22} />} title="No share activity logged yet" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {referrals.map((r, i) => (
                <div
                  key={i}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: colors.bg, borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5 }}
                >
                  <span>
                    {r.source || "unknown source"} · landed {new Date(r.landedAt).toLocaleDateString("en-IE")}
                  </span>
                  {r.converted ? (
                    <span style={{ fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: 100, padding: "3px 10px" }}>
                      Converted ({r.convertedKind})
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, color: colors.faint }}>No conversion yet</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {funnel !== undefined && (
        <Card>
          <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 4px" }}>Funnel (last 30 days)</h4>
          <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 16px" }}>
            Raw event counts — search, intent, match, join, attend, repeat. A minimal first-party log, not a full analytics product.
          </p>
          {!funnel ? (
            <EmptyState icon={<SearchIcon size={22} />} title="Loading…" />
          ) : funnel.length === 0 ? (
            <EmptyState icon={<SearchIcon size={22} />} title="No events logged yet" />
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap" }}>
              {funnel.map((row) => statBlock(row.count, FUNNEL_LABELS[row.eventType] ?? row.eventType))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
