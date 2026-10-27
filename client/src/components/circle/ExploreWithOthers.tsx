import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchCirclesPage } from "../../api";
import { getCircleCoverUrl, getMediaUrl } from "../../media";
import type { Circle, ListingTaxonomy } from "../../types";
import "./circleExperience.css";

// Circles 3.0 §10 — "Explore with others" on a listing page: real Circles
// that share the listing's interest (the same category/subcategory the
// listing has), nearest first. Shown only when such Circles exist, and
// worded so it never claims a Circle organised this listing.

export function ExploreWithOthers({ taxonomy, county, noun, excludeCircleId }: { taxonomy?: ListingTaxonomy | null; county?: string | null; noun: string; excludeCircleId?: string | null }) {
  const [circles, setCircles] = useState<Circle[]>([]);
  // Which match was found: the subcategory or only the wider category, and
  // whether it's local — the heading says exactly that, never more.
  const [match, setMatch] = useState<{ sub: boolean; local: boolean }>({ sub: false, local: false });
  useEffect(() => {
    if (!taxonomy?.categorySlug) return;
    let live = true;
    const tries: Parameters<typeof fetchCirclesPage>[0][] = [];
    if (taxonomy.subcategorySlug && county) tries.push({ categorySlug: taxonomy.categorySlug, subcategorySlug: taxonomy.subcategorySlug, county, limit: 4 });
    if (taxonomy.subcategorySlug) tries.push({ categorySlug: taxonomy.categorySlug, subcategorySlug: taxonomy.subcategorySlug, limit: 4 });
    if (county) tries.push({ categorySlug: taxonomy.categorySlug, county, limit: 4 });
    tries.push({ categorySlug: taxonomy.categorySlug, limit: 4 });
    (async () => {
      for (const t of tries) {
        try {
          const page = await fetchCirclesPage(t);
          const found = page.items.filter((c) => c.id !== excludeCircleId).slice(0, 3);
          if (found.length) {
            if (live) {
              setCircles(found);
              setMatch({ sub: !!t?.subcategorySlug, local: !!t?.county });
            }
            return;
          }
        } catch {
          return;
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [taxonomy?.categorySlug, taxonomy?.subcategorySlug, county, excludeCircleId]);

  if (!taxonomy || circles.length === 0) return null;
  const interest = (match.sub && taxonomy.subcategoryName ? taxonomy.subcategoryName : taxonomy.categoryName).toLowerCase();
  return (
    <section className="ewo" aria-labelledby="ewo-title">
      <h2 id="ewo-title">Explore with others</h2>
      <p className="ewo-sub">
        {match.local ? "Local Circles" : "Circles"} into {interest}. They aren't running this {noun}; they're people who enjoy it and plan things together.
      </p>
      <ul className="ewo-list">
        {circles.map((c) => {
          const cover = getCircleCoverUrl(c);
          return (
            <li key={c.id}>
              <Link to={`/circles/${c.slug ?? c.id}`} className="ewo-row">
                <span className={`ewo-photo${cover ? "" : " is-empty"}`} aria-hidden="true">
                  {cover && <img src={getMediaUrl(cover, "card")} alt="" loading="lazy" />}
                </span>
                <span className="ewo-text">
                  <strong>{c.name}</strong>
                  <span>{[c.area || c.county, `${c.members} ${c.members === 1 ? "member" : "members"}`].filter(Boolean).join(" · ")}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
