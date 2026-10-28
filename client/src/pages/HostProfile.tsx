import { usePageTitle } from "../pageTitle";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { fetchHostProfile, isNotFound } from "../api";
import { FollowButton } from "../components/FollowButton";
import { Reviews } from "../components/Reviews";
import { ShareButton } from "../components/ShareButton";
import { ReportContentButton } from "../components/ReportContentButton";
import { VerificationLabels } from "../components/trust/VerificationLabels";
import { Avatar, LoadErrorState, Skeleton } from "../components/ui";
import type { HostProfile } from "../types";
import "../components/trust/trust.css";

// Host public profile (Trust & Retention batch 1, docs/trust-retention/).
// Available for anyone who hosts in public, not only approved hosts — the
// server decides (residents.ts GET /:id/host-profile) and only returns what
// the public can already see: discoverable Sessions, open Circles, the
// general area (never a meeting address), specific completed checks with what
// each means, and reviews. With no reviews yet the page says "New to
// HelloCircle" rather than implying a track record. Follow stays a quiet
// secondary action (see FollowButton.tsx).

const DATE = new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });
const MONTH = new Intl.DateTimeFormat("en-IE", { month: "long", year: "numeric", timeZone: "Europe/Dublin" });
const day = (iso: string) => DATE.format(new Date(`${iso}T12:00:00Z`));

export function HostProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<HostProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  usePageTitle(notFound ? "Host not found" : profile?.name);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setLoadError(false);
    setNotFound(false);
    fetchHostProfile(id)
      .then(setProfile)
      .catch((e) => (isNotFound(e) ? setNotFound(true) : setLoadError(true)))
      .finally(() => setLoading(false));
  }, [id, reloadKey]);

  if (loading) {
    return (
      <div className="tr-profile" aria-busy="true">
        <Skeleton height={84} />
        <div style={{ height: 24 }} />
        <Skeleton height={240} />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="tr-profile">
        <LoadErrorState title="We couldn't load this host profile." detail="Check your connection and try again." onRetry={() => setReloadKey((k) => k + 1)} />
      </div>
    );
  }
  if (notFound || !profile) {
    return (
      <div className="tr-profile" style={{ maxWidth: 640 }}>
        <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Host profile not available</h1>
        <p className="tr-muted">This person doesn't host anything in public on HelloCircle right now.</p>
        <Link to="/explore">Explore activities</Link>
      </div>
    );
  }

  const summary = profile.reviewSummary;
  const isNew = !summary || summary.count === 0;
  const checks = profile.checks ?? [];
  const first = profile.name.split(" ")[0];

  return (
    <div className="tr-profile">
      <header className="tr-profile-head">
        <Avatar name={profile.name} size={72} src={profile.avatarUrl} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="tr-review-meta" style={{ margin: "0 0 6px", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>
            Host
          </p>
          <h1>{profile.name}</h1>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 12 }}>
            {isNew ? (
              <span className="tr-chip is-new">New to HelloCircle</span>
            ) : (
              <span className="tr-chip">
                {summary!.average?.toFixed(1)} from {summary!.count} review{summary!.count === 1 ? "" : "s"}
              </span>
            )}
            {checks.map((c) => (
              <span key={c.key} className="tr-chip">
                {c.label}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <ShareButton entityType="host" entityId={profile.id} />
          <FollowButton followedType="host" followedId={profile.id} initialFollowing={profile.isFollowing} initialLevel={profile.followNotificationLevel} followerCount={profile.followerCount} />
        </div>
      </header>

      <div className="tr-profile-grid">
        <main>
          <section className="tr-section" style={{ borderTop: "none", paddingTop: 0, marginTop: 0 }} aria-labelledby="host-intro">
            <h2 id="host-intro">About {first}</h2>
            {profile.bio ? (
              <p style={{ margin: 0, fontSize: 16, lineHeight: 1.65, color: "var(--color-text-soft)", whiteSpace: "pre-line" }}>{profile.bio}</p>
            ) : (
              <p className="tr-note">{first} hasn't written an introduction yet.</p>
            )}
            {isNew && (
              <p className="tr-note" style={{ marginTop: 14 }}>
                {first} is new to HelloCircle: there are no reviews from people who've been to their activities yet. Look at the Session details and ask the host any questions before you go.
              </p>
            )}
          </section>

          {!!profile.activitiesOffered?.length && (
            <section className="tr-section" aria-labelledby="host-activities">
              <h2 id="host-activities">Activities</h2>
              <div className="tr-tags" style={{ marginTop: 0 }}>
                {profile.activitiesOffered.map((a) => (
                  <span key={a} className="tr-tag" style={{ fontSize: 13.5, padding: "4px 10px" }}>
                    {a}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="tr-section" aria-labelledby="host-upcoming">
            <h2 id="host-upcoming">Upcoming Sessions</h2>
            {profile.upcomingGames.length === 0 ? (
              <p className="tr-note">Nothing public is scheduled right now. Follow {first} to hear when they host next.</p>
            ) : (
              <ul className="tr-rows">
                {profile.upcomingGames.map((g) => (
                  <li key={g.id}>
                    <Link to={`/games/${g.id}`}>
                      <span>
                        <strong>{g.activityLabel}</strong>
                        <span className="tr-review-meta" style={{ display: "block" }}>
                          {day(g.date)} · {g.time}
                        </span>
                      </span>
                      <ChevronRight size={18} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {profile.circles.length > 0 && (
            <section className="tr-section" aria-labelledby="host-circles">
              <h2 id="host-circles">Circles {first} organises</h2>
              <ul className="tr-rows">
                {profile.circles.map((c) => (
                  <li key={c.id}>
                    <Link to={`/circles/${c.slug ?? c.id}`}>
                      <span>
                        <strong>{c.name}</strong>
                        {c.activityLabel && (
                          <span className="tr-review-meta" style={{ display: "block" }}>
                            {c.activityLabel}
                          </span>
                        )}
                      </span>
                      <ChevronRight size={18} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Reviews listingType="host" listingId={profile.id} title={`Reviews of ${first} as a host`} />
        </main>

        <aside className="tr-aside" aria-label="About this host">
          <div>
            <h2>What HelloCircle has checked</h2>
            <VerificationLabels checks={checks} subject="host" />
          </div>
          <div>
            <h2>Hosting on HelloCircle</h2>
            <dl className="tr-facts is-stacked">
              <dt>Sessions hosted</dt>
              <dd>{profile.gamesHostedTotal === 0 ? "None yet" : `${profile.gamesHostedTotal} public Session${profile.gamesHostedTotal === 1 ? "" : "s"}`}</dd>
              <dt>Hosting since</dt>
              <dd className={profile.hostingSince ? "" : "is-missing"}>{profile.hostingSince ? MONTH.format(new Date(`${profile.hostingSince}T12:00:00Z`)) : "Not yet"}</dd>
              <dt>General area</dt>
              <dd className={profile.areas?.length ? "" : "is-missing"}>{profile.areas?.length ? profile.areas.join(" · ") : "Not provided"}</dd>
            </dl>
          </div>
          <div>
            <h2>Questions or concerns</h2>
            <p className="tr-note" style={{ marginBottom: 12 }}>
              Ask {first} about a Session from its page once you've joined. For anything else, HelloCircle support can help.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
              <Link to="/contact">Contact HelloCircle support</Link>
              <ReportContentButton targetType="host" targetId={profile.id} what="this host" />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
