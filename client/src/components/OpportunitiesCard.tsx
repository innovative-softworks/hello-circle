import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchHostOpportunities, fetchVendorOpportunities } from "../api";
import { describeWhen, experienceHref, gameHref, programHref } from "../opportunityPrefill";
import { colors, fonts, radius } from "../theme";
import type { HostOpportunity } from "../types";
import { Button, Card } from "./ui";

// Host Opportunities (community participation upgrade, Release 6) — real,
// resident-backed demand ("30+ people want Sunday badminton") shown where
// hosts already work: the vendor dashboard overview and HelloCircle Manage
// for verified resident hosts. The action matches what that host can
// create — a Game for a resident host, a Program or Experience for a
// vendor — prefilled from the cluster. Never shows who asked. Renders
// nothing when there's no demand worth showing.

export function OpportunitiesCard({ audience }: { audience: "vendor" | "host" }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<HostOpportunity[] | null>(null);

  useEffect(() => {
    (audience === "vendor" ? fetchVendorOpportunities() : fetchHostOpportunities())
      .then((r) => setItems(r.opportunities))
      .catch(() => setItems([]));
  }, [audience]);

  if (!items?.length) return null;

  return (
    <Card>
      <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".09em", color: colors.muted, marginBottom: 4 }}>Opportunities</div>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 4px" }}>What people nearby are asking for</h3>
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>From real requests by signed-in residents. Counts are rounded, and we never show who asked.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.slice(0, 5).map((o) => {
          const high = ["10+", "20+", "30+", "50+"].includes(o.interested);
          const when = describeWhen(o);
          const budget =
            o.budget && (o.budget.minCents !== null || o.budget.maxCents !== null)
              ? `€${Math.round((o.budget.minCents ?? 0) / 100)}–€${Math.round((o.budget.maxCents ?? o.budget.minCents ?? 0) / 100)}`
              : null;
          return (
            <div key={`${o.clusterKey}-${o.county}`} style={{ border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "14px 16px" }}>
              {high && <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", color: colors.orangeDark, marginBottom: 4 }}>HIGH DEMAND</div>}
              <div style={{ fontWeight: 700, fontSize: 16 }}>
                {when ? `${when} ` : ""}
                {o.label.toLowerCase()}
              </div>
              <div style={{ fontSize: 13, color: colors.muted, marginTop: 4, lineHeight: 1.5 }}>
                {o.interested} people interested · {o.county}
                {o.radiusKm ? ` · within ${o.radiusKm} km` : ""}
                {budget ? ` · typical budget ${budget}` : ""}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {audience === "host" ? (
                  <Button onClick={() => navigate(gameHref(o))}>Create a game</Button>
                ) : (
                  <>
                    <Button onClick={() => navigate(programHref(o))}>Create a program</Button>
                    <Button variant="ghost" onClick={() => navigate(experienceHref(o))}>Create an experience</Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
