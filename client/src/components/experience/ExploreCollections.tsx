import { useEffect, useState } from "react";
import { fetchCollections, type DiscoveryCollection } from "../../api";
import { useExperienceFeatures } from "../../circleFeatures";
import { DiscoverRow } from "../DiscoverRow";

// Experience 3.0 — Explore collections and occasions (experience.collections).
// Each comes from a fact the listing states (price, host-set attribute,
// kind); the server drops empty ones, so nothing here is padded. "This
// weekend" is skipped because Explore already shows its own weekend row.

export function ExploreCollections({ county, skip = ["this_weekend"] }: { county?: string; skip?: string[] }) {
  const on = useExperienceFeatures()["experience.collections"];
  const [collections, setCollections] = useState<DiscoveryCollection[]>([]);
  useEffect(() => {
    if (!on) return;
    let live = true;
    fetchCollections(county || undefined)
      .then((r) => live && setCollections(r.collections))
      .catch(() => live && setCollections([]));
    return () => {
      live = false;
    };
  }, [on, county]);
  // A row of one or two leaves most of the width empty: only rows with at
  // least three listings show (Explore cleanup, owner 2026-10-27).
  const shown = collections.filter((c) => !skip.includes(c.key) && c.items.length >= 3);
  if (!on || shown.length === 0) return null;
  return (
    <>
      {shown.map((c) => (
        <section key={c.key} aria-label={c.title} className="ex-row">
          <DiscoverRow title={c.title} subtitle={c.description} items={c.items} limit={8} />
        </section>
      ))}
    </>
  );
}
