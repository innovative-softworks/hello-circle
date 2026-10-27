import { CtaBand } from "../components/CtaBand";
import { usePageTitle } from "../pageTitle";
import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { fetchLocalActivity, type LocalActivityFeed } from "../api/public";
import { DiscoverCard } from "../components/DiscoverRow";
import { IntentCaptureForm } from "../components/IntentCaptureForm";
import { SearchIcon } from "../components/icons";
import { PageTitle } from "../components/PageTitle";
import { CardSkeleton, EmptyState } from "../components/ui";
import { IRISH_COUNTY_COORDS } from "../irishCounties";
import { VENUE_PAGES_PUBLIC } from "../venueLaunch";
import { colors, fonts, maxWidth } from "../theme";
import { addDays, irelandToday } from "../irelandDate";
import { Chip } from "../components/Chip";
import { useUrlParam } from "../useUrlTab";

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
  const [when, setWhen] = useUrlParam<string>("when", "any");

  // Only ever render for a real Irish county — anything else is a stray
  // 2-segment URL, not a landing page (mirrors ogMeta.ts's server-side
  // check, kept independent since this guard is cheap/static and doesn't
  // need a DB round trip the way the OG-tag injection does).
  const countyName = Object.keys(IRISH_COUNTY_COORDS).find((c) => c.toLowerCase() === county.toLowerCase());
  usePageTitle(countyName ? `${titleCase(activity.replace(/-/g, " "))} in ${countyName}` : null);

  useEffect(() => {
    if (!countyName) return;
    setLoading(true);
    fetchLocalActivity(county, activity)
      .then(setFeed)
      .finally(() => setLoading(false));
  }, [county, activity, countyName]);

  // PUB-09 — an unknown county falls back to venue browsing only when venue
  // pages are public; otherwise to Explore (never to the coming-soon gate).
  if (!countyName) return <Navigate to={VENUE_PAGES_PUBLIC ? "/browse/centres" : "/explore"} replace />;

  const activityLabel = titleCase(activity.replace(/-/g, " "));
  const shownItems = (feed?.items ?? []).filter((item) => matchesWhen(item.date, when));

  return (
    <div className="fade-panel">
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
          <>
            {/* When filter — shown once there's enough to narrow. */}
            {feed.items.length > 3 && (
              <div className="chips-scroll-mobile" role="group" aria-label="Filter by when" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
                {WHEN_OPTIONS.map((o) => (
                  <Chip key={o.key} label={o.label} active={when === o.key} onClick={() => setWhen(o.key)} />
                ))}
              </div>
            )}
            {shownItems.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 18 }}>
                {shownItems.map((item) => (
                  <DiscoverCard key={`${item.kind}-${item.id}`} item={item} isToday={item.date === irelandToday()} fill />
                ))}
              </div>
            ) : (
              <EmptyState icon={<SearchIcon size={22} />} title="Nothing on then" subtitle="Try another time — or see everything coming up." action={<button className="cta-band-link" style={{ color: colors.text }} onClick={() => setWhen("any")}>Show any time</button>} />
            )}
          </>
        ) : (
          <EmptyState
            icon={<SearchIcon size={22} />}
            title="Nothing scheduled yet"
            subtitle={`No ${activityLabel.toLowerCase()} activities in ${countyName} right now.`}
            action={<IntentCaptureForm activityLabel={activityLabel} county={countyName} />}
          />
        )}
      </section>
      {/* Closing band — the same "Can't make this one?" form as the detail pages,
          for this activity and county (hidden while the empty state already shows it). */}
      {feed && !loading && feed.count > 0 && (
        <CtaBand
          id="local-cta-title"
          label="Not this time?"
          lines={["Can't", "make these", "times?"]}
          text={`No worries — we'll let you know about new ${activityLabel.toLowerCase()} plans in ${countyName}.`}
          panel={{ title: "Another time works better?", text: "Tell us when suits you. We'll let you know when a similar activity is planned." }}
          action={{ label: "Explore similar activities", to: `/games?activity=${encodeURIComponent(activityLabel)}` }}
        >
          <IntentCaptureForm variant="panel" activityLabel={activityLabel} county={countyName} />
        </CtaBand>
      )}
    </div>
  );
}

const WHEN_OPTIONS = [
  { key: "any", label: "Any time" },
  { key: "today", label: "Today" },
  { key: "weekend", label: "This weekend" },
  { key: "week", label: "Next 7 days" },
  { key: "later", label: "Later" },
];

/** Ireland-calendar date match for the When chips (dates are YYYY-MM-DD). */
function matchesWhen(date: string | null | undefined, when: string): boolean {
  if (when === "any") return true;
  if (!date) return false;
  const today = irelandToday();
  if (when === "today") return date === today;
  if (when === "week") return date >= today && date <= addDays(today, 6);
  if (when === "later") return date > addDays(today, 6);
  // This weekend: the coming Saturday + Sunday (today included if it's the weekend).
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const sat = dow === 0 ? addDays(today, -1) : addDays(today, (6 - dow) % 7);
  return date >= (dow === 0 ? today : sat) && date <= addDays(sat, 1);
}
