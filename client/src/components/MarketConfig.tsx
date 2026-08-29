import { useEffect, useState } from "react";
import { fetchAdminMarketCategories, setMarketCategory } from "../api/admin";
import { colors, fonts } from "../theme";
import { INTEREST_OPTIONS, type MarketCategoryFlags } from "../types";
import { IRISH_COUNTY_COORDS } from "../irishCounties";
import { Card, inputStyle } from "./ui";

// Market/category launch config (participation-intent plan Phase 4) — same
// enabled-by-default/opt-out toggle-row visual language as OrgFlagsRow
// (AdminDashboard.tsx), scoped by a county picker instead of an org.

const COUNTIES = Object.keys(IRISH_COUNTY_COORDS);

export function MarketConfig() {
  const [county, setCounty] = useState("Dublin");
  const [flags, setFlags] = useState<MarketCategoryFlags | null>(null);

  const load = (c: string) => {
    setFlags(null);
    fetchAdminMarketCategories(c).then(setFlags);
  };
  useEffect(() => load(county), [county]);

  const toggle = async (category: string) => {
    if (!flags) return;
    const next = { ...flags, [category]: !flags[category] };
    setFlags(next);
    await setMarketCategory(county, category, next[category]);
  };

  return (
    <Card>
      <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 4px" }}>Market config</h4>
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 16px" }}>
        Which activity categories are live in which county — turning one off doesn't remove existing listings, it just
        stops it being offered as a fresh onboarding interest there.
      </p>
      <select value={county} onChange={(e) => setCounty(e.target.value)} style={{ ...inputStyle, maxWidth: 220, marginBottom: 16 }}>
        {COUNTIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      {!flags ? (
        <span style={{ fontSize: 12, color: colors.faint }}>Loading…</span>
      ) : (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {INTEREST_OPTIONS.map((category) => (
            <label key={category} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
              <input type="checkbox" checked={flags[category] ?? true} onChange={() => toggle(category)} style={{ accentColor: colors.green }} />
              {category}
            </label>
          ))}
        </div>
      )}
    </Card>
  );
}
