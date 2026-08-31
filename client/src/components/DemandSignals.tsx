import { useState, type CSSProperties } from "react";
import type { DemandRow, IntentCluster } from "../types";
import { colors, fonts, radius } from "../theme";
import { SearchIcon } from "./icons";
import { Button, ManageCard as Card, EmptyState, PageSpinner } from "./ui";

// Shared by VendorDashboard's demand tab (scoped to the vendor's own
// listing type/county, with a toggle to widen it) and AdminDashboard's
// demand tab (always platform-wide, no toggle) — same underlying
// search_misses aggregate (see db/queries.ts getDemandSignals), just a
// different default scope. Was two near-identical copies of this JSX.

function scopeButtonStyle(active: boolean): CSSProperties {
  return {
    fontSize: 11.5,
    fontWeight: 700,
    padding: "4px 10px",
    borderRadius: 100,
    border: "none",
    cursor: "pointer",
    background: active ? colors.dark : colors.panel,
    color: active ? "#fff" : colors.muted,
  };
}

export function DemandSignalsView({
  title,
  subtitle,
  rows,
  scope,
}: {
  title: string;
  subtitle: string;
  rows: DemandRow[] | "forbidden" | null;
  /** Present only for the vendor view — lets them widen past their own county/listing type. */
  scope?: { value: "own" | "all"; onChange: (scope: "own" | "all") => void };
}) {
  if (rows === null) return <PageSpinner />;

  if (rows === "forbidden") {
    return (
      <EmptyState
        icon={<SearchIcon size={22} />}
        title="Restricted"
        subtitle="This tab needs the finance or read-only analyst role — ask the organisation owner for access."
      />
    );
  }

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 4 }}>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: 0 }}>{title}</h4>
        {scope && (
          <div style={{ display: "flex", gap: 4, flex: "none" }}>
            <button onClick={() => scope.onChange("own")} style={scopeButtonStyle(scope.value === "own")}>
              Your county
            </button>
            <button onClick={() => scope.onChange("all")} style={scopeButtonStyle(scope.value === "all")}>
              All Ireland
            </button>
          </div>
        )}
      </div>
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 16px" }}>{subtitle}</p>
      {rows.length === 0 ? (
        <EmptyState icon={<SearchIcon size={22} />} title="No unmet demand logged yet" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((r, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: colors.bg, borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5 }}
            >
              <span>
                "{r.queryText}"{r.county ? ` · ${r.county}` : ""}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {r.recentCount > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: colors.orangeDark, background: colors.orangeBg, borderRadius: 100, padding: "2px 7px" }}>
                    {r.recentCount} this week
                  </span>
                )}
                <span style={{ fontWeight: 700, color: colors.muted }}>{r.count}×</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Explicit unmet-demand clusters (participation-intent plan Phase 1) —
 * unlike DemandSignalsView above (passive query-text logging), each row here
 * is resident-linkable, so an admin can directly notify the people behind
 * it. Same card/row visual language as DemandSignalsView by design. */
export function IntentClusterView({
  clusters,
  onNotify,
}: {
  clusters: IntentCluster[] | "forbidden" | null;
  onNotify: (activityLabel: string, county: string) => Promise<{ notified: number }>;
}) {
  const [notifying, setNotifying] = useState<string | null>(null);
  const [notified, setNotified] = useState<Record<string, number>>({});

  if (clusters === null) return <PageSpinner />;
  if (clusters === "forbidden") return null;

  const clusterKey = (c: IntentCluster) => `${c.activityLabel}::${c.county}`;

  const handleNotify = async (c: IntentCluster) => {
    const key = clusterKey(c);
    setNotifying(key);
    try {
      const res = await onNotify(c.activityLabel, c.county);
      setNotified((n) => ({ ...n, [key]: res.notified }));
    } finally {
      setNotifying(null);
    }
  };

  return (
    <Card>
      <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 4px" }}>People waiting for something to happen</h4>
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 16px" }}>
        Explicit "I'm interested" signals from residents, grouped by activity + county — notify them directly once enough people want the same thing.
      </p>
      {clusters.length === 0 ? (
        <EmptyState icon={<SearchIcon size={22} />} title="No unmatched interest logged yet" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {clusters.map((c) => {
            const key = clusterKey(c);
            return (
              <div
                key={key}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: colors.bg, borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5 }}
              >
                <span>
                  {c.activityLabel}
                  {c.county ? ` · ${c.county}` : ""}
                  <span style={{ fontWeight: 700, color: colors.muted, marginLeft: 8 }}>{c.count}×</span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {key in notified ? (
                    <span style={{ fontSize: 12, fontWeight: 700, color: colors.greenText }}>Notified {notified[key]}</span>
                  ) : c.residentCount === 0 ? (
                    <span style={{ fontSize: 12, color: colors.faint }}>No signed-in residents to notify</span>
                  ) : (
                    <Button variant="ghost" style={{ padding: "6px 12px", fontSize: 12 }} disabled={notifying === key} onClick={() => handleNotify(c)}>
                      {notifying === key ? "Notifying…" : `Notify ${c.residentCount} resident${c.residentCount === 1 ? "" : "s"}`}
                    </Button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
