import type { CSSProperties } from "react";
import type { DemandRow } from "../types";
import { colors, fonts } from "../theme";
import { SearchIcon } from "./icons";
import { Card, EmptyState, PageSpinner } from "./ui";

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
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: colors.bg, borderRadius: 10, padding: "10px 14px", fontSize: 13.5 }}
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
