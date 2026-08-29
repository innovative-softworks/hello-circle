import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { fetchLocalActivity, type LocalActivityFeed } from "../api/public";
import { DiscoverCard } from "../components/DiscoverRow";
import { IntentCaptureForm } from "../components/IntentCaptureForm";
import { SearchIcon } from "../components/icons";
import { PageTitle } from "../components/PageTitle";
import { CardSkeleton, EmptyState } from "../components/ui";
import { IRISH_COUNTY_COORDS } from "../irishCounties";
import { colors, fonts, maxWidth } from "../theme";

// Local SEO landing pages (participation-intent plan Phase 3) — a thin,
// county+activity-pinned front door onto the same discover pool every other
// feed reads (see server's GET /discover/local/:county/:activity). Route is
// mounted last in App.tsx; react-router v6 ranks static path segments over
// dynamic ones regardless of declaration order, so this never shadows an
// existing 2-segment route like /games/:id.

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function LocalActivity() {
  const { county = "", activity = "" } = useParams<{ county: string; activity: string }>();
  const [feed, setFeed] = useState<LocalActivityFeed | null>(null);
  const [loading, setLoading] = useState(true);

  // Only ever render for a real Irish county — anything else is a stray
  // 2-segment URL, not a landing page (mirrors ogMeta.ts's server-side
  // check, kept independent since this guard is cheap/static and doesn't
  // need a DB round trip the way the OG-tag injection does).
  const countyName = Object.keys(IRISH_COUNTY_COORDS).find((c) => c.toLowerCase() === county.toLowerCase());

  useEffect(() => {
    if (!countyName) return;
    setLoading(true);
    fetchLocalActivity(county, activity)
      .then(setFeed)
      .finally(() => setLoading(false));
  }, [county, activity, countyName]);

  if (!countyName) return <Navigate to="/browse/centres" replace />;

  const activityLabel = titleCase(activity.replace(/-/g, " "));

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "26px 24px 80px" }}>
        <PageTitle>
          {activityLabel} in {countyName}
        </PageTitle>
        <p style={{ color: colors.mutedLight, fontSize: 15, margin: "0 0 28px" }}>
          {feed && !loading ? `${feed.count} ${feed.count === 1 ? "activity" : "activities"} found` : "Real, upcoming activities near you."}
        </p>

        {loading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 18 }}>
            {Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : feed && feed.items.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 18 }}>
            {feed.items.map((item) => (
              <DiscoverCard key={`${item.kind}-${item.id}`} item={item} isToday={item.date === new Date().toISOString().slice(0, 10)} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<SearchIcon size={22} />}
            title="Nothing scheduled yet"
            subtitle={`No ${activityLabel.toLowerCase()} activities in ${countyName} right now.`}
            action={<IntentCaptureForm activityLabel={activityLabel} county={countyName} />}
          />
        )}
      </section>
    </div>
  );
}
