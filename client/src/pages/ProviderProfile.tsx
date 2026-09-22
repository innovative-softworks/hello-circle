import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchProviderProfile } from "../api";
import { AwardIcon, ChevronRightIcon, PinIcon } from "../components/icons";
import { FollowButton } from "../components/FollowButton";
import { ShareButton } from "../components/ShareButton";
import { Photo } from "../components/Photo";
import { PhotoGallery } from "../components/PhotoGallery";
import { ProviderCard } from "../components/ProviderCard";
import { SinglePinMap } from "../components/SinglePinMap";
import { Button, LinkButton, PageSpinner, StarDisplay } from "../components/ui";
import { EntityTypeLabel, ParticipationMeter } from "../components/symbols";
import type { EntityKind } from "../components/symbols";
import { cardImageRatio, colors, fonts, maxWidth, placeholderStripes, radius } from "../theme";
import type { ProviderProfile, ProviderUpcomingItem } from "../types";

// Provider public profile (IA spec §5; redesigned per the "HelloCircle —
// Public Vendor/Provider Profile" master prompt, then again per a second
// reference image — a single-venue page — adapted to this page's
// multi-listing reality; see the approved v3 plan for the full mapping).
// Uses the app's normal Warm Swiss Editorial tokens (colors/fonts from
// theme.ts), the same as Explore/ExperienceDetail/CircleDetail — NOT the
// FV_ACCENT/dark-hero language /for-venues owns for itself.
//
// Never fabricates a stat, badge, or relationship:
//   - "Went ahead %" ships (an honest outcome stat — confirmed vs.
//     cancelled, no fault attribution) but "people attended"/"active
//     hosts" from the reference don't: attendance tracking is a sparse,
//     vendor-opt-in check-in log, and "hosts" aren't a vendor-account
//     concept at all in this app (see getProviderWentAheadPercent's own
//     comment in queries.ts).
//   - Amenities/accessibility/map only render when the underlying listing
//     data actually has them — never a placeholder amenity list or a
//     fabricated pin.

const UPCOMING_KIND_TO_ENTITY: Record<ProviderUpcomingItem["kind"], EntityKind> = {
  experience: "experience",
  program_session: "place",
  club_session: "open-plan",
};

function firstSentence(text: string): string {
  const m = text.match(/^[^.!?]*[.!?]/);
  return m ? m[0].trim() : text;
}

function formatSessionDate(date: string, time: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const dateLabel = d.toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" });
  return `${dateLabel} · ${time}`;
}

/** Vertical card (image on top) — the reference's "Upcoming" card shape,
 * replacing the horizontal-row treatment the previous pass used. */
function UpcomingCard({ item, onOpen }: { item: ProviderUpcomingItem; onOpen: () => void }) {
  return (
    <div
      onClick={onOpen}
      className="card-hover card-surface"
      style={{ cursor: "pointer", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, overflow: "hidden" }}
    >
      <Photo src={item.imageUrl ?? undefined} alt={item.title} ph={placeholderStripes.green} style={{ aspectRatio: cardImageRatio.discovery }} />
      <div style={{ padding: "12px 14px 14px" }}>
        <EntityTypeLabel type={UPCOMING_KIND_TO_ENTITY[item.kind]} size={11} color={colors.mutedLight} />
        <div style={{ fontWeight: 700, fontSize: 14.5, margin: "5px 0 3px" }}>{item.title}</div>
        <div style={{ fontSize: 12, color: colors.mutedLight, marginBottom: item.capacity ? 8 : 2 }}>{formatSessionDate(item.date, item.time)}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          {item.capacity !== null ? (
            <ParticipationMeter capacity={item.capacity} joinedCount={item.spotsLeft !== null ? item.capacity - item.spotsLeft : 0} />
          ) : (
            <span />
          )}
          {item.priceCents !== null && item.priceCents > 0 && <span style={{ fontWeight: 700, fontSize: 13.5, flex: "none" }}>€{(item.priceCents / 100).toFixed(0)}</span>}
        </div>
      </div>
    </div>
  );
}

/** The header's inline stat row — Listings / People joined / Rating / Went
 * ahead % — every value already real; rating and went-ahead are omitted
 * individually (not zero-filled) when there isn't enough data behind them. */
function StatPill({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20 }}>{value}</span>
      <span style={{ fontSize: 11.5, color: colors.mutedLight, fontWeight: 600 }}>{label}</span>
    </div>
  );
}

/** Section heading with the "/" eyebrow motif already established elsewhere
 * in the app (NavRail's brand lockup, VendorHero's "/ For venues & hosts",
 * the login page) — pulled from the skate-brand reference's own repeated
 * "/" prefix, but staying inside this page's existing light Warm Swiss
 * Editorial palette rather than that reference's dark poster treatment. */
function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18, margin: "0 0 14px", display: "flex", alignItems: "baseline", gap: 7 }}>
      <span aria-hidden="true" style={{ color: colors.orangeDark }}>
        /
      </span>
      {children}
    </h2>
  );
}

/** Hairline top-border rhythm between major sections — echoes the
 * reference's own horizontal-rule pattern between blocks, translated to a
 * quiet single hairline rather than a heavy divider. */
const sectionDividerStyle = { borderTop: `1px solid ${colors.border}`, paddingTop: 36 } as const;

export function ProviderProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchProviderProfile(id)
      .then(setProfile)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PageSpinner />;
  if (notFound || !profile) {
    return (
      <section className="section-pad" style={{ maxWidth: 640, margin: "0 auto", padding: "60px 24px", textAlign: "center" }}>
        <p style={{ color: colors.mutedLight }}>This provider doesn't exist, or isn't approved yet.</p>
      </section>
    );
  }

  const typeLabels = [
    profile.centres.length > 0 && "Community Venue",
    profile.clubs.length > 0 && "Sports Club",
    profile.experiences.length > 0 && "Experience Provider",
  ].filter((v): v is string => !!v);

  const primaryCta = profile.experiences.length
    ? { label: "View Experiences", action: () => document.getElementById("upcoming")?.scrollIntoView({ behavior: "smooth" }) }
    : profile.clubs.length
      ? { label: "See What's Happening", action: () => document.getElementById("upcoming")?.scrollIntoView({ behavior: "smooth" }) }
      : profile.centres.length
        ? { label: "Check Availability", action: () => navigate(`/centres/${profile.centres[0].slug ?? profile.centres[0].id}`) }
        : null;

  const galleryImages = [...profile.centres, ...profile.clubs, ...profile.experiences].map((l) => l.image).filter((img): img is string => !!img);

  const areas = Array.from(new Set([...profile.centres, ...profile.clubs, ...profile.experiences].map((l) => l.area).filter(Boolean)));

  const isNew = profile.trust.totalListings <= 1 && profile.trust.participantCount < 5 && profile.reviewsSummary.count === 0;

  const offerings: { name: string; kind: EntityKind }[] = [
    ...profile.centres.map((c) => ({ name: c.name, kind: "place" as const })),
    ...profile.clubs.map((c) => ({ name: c.name, kind: "open-plan" as const })),
    ...profile.experiences.map((e) => ({ name: e.title, kind: "experience" as const })),
  ];

  return (
    <div className="fade-panel" style={{ animation: "fadeUp .3s ease both" }}>
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "24px 24px 0" }}>
        {/* Utility row — breadcrumb + Share, echoing the reference's own
            top utility strip (see VendorHero.tsx's identical pattern on
            /for-venues), pulled out of the identity block so the hero split
            below reads as one clean text/photo pairing. */}
        <div className="stack-mobile" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: colors.mutedLight }}>
            <a href="/explore" style={{ color: colors.mutedLight, textDecoration: "none" }}>
              Explore
            </a>
            <ChevronRightIcon size={12} />
            <a href="/explore" style={{ color: colors.mutedLight, textDecoration: "none" }}>
              Providers
            </a>
            <ChevronRightIcon size={12} />
            <span style={{ color: colors.text, fontWeight: 600 }}>{profile.name}</span>
          </div>
          <button
            onClick={() => (navigator.share ? navigator.share({ title: profile.name, url: window.location.href }) : navigator.clipboard.writeText(window.location.href))}
            style={{ background: "none", border: "none", color: colors.mutedLight, fontSize: 12.5, cursor: "pointer", padding: 0, flex: "none" }}
          >
            Share
          </button>
        </div>

        {/* 1. Hero — an asymmetric text/photo split (the reference's own
            "big headline beside a big photo" composition) rather than
            text stacked flat above a boxed gallery. Falls back to a
            single text column when there's no real photo. */}
        <div
          className="grid-responsive"
          style={{ display: "grid", gridTemplateColumns: galleryImages.length > 0 ? "0.95fr 1.15fr" : "1fr", gap: 48, alignItems: "center", marginBottom: 32 }}
        >
          <div>
            {typeLabels.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
                {typeLabels.map((t) => (
                  <span key={t} style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: colors.mutedLight }}>
                    {t}
                  </span>
                ))}
              </div>
            )}
            {profile.verified && (
              <div style={{ marginBottom: 10 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "4px 11px" }}>
                  <AwardIcon size={12} /> Verified provider
                </span>
              </div>
            )}
            <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(34px, 6vw, 68px)", letterSpacing: "-.03em", lineHeight: 0.96, margin: "0 0 10px" }}>{profile.name}</h1>
            <div style={{ fontSize: 13.5, color: colors.mutedLight, marginBottom: 12 }}>
              {typeLabels[0] ?? "Provider"} · {profile.county}
            </div>
            {profile.description && <p style={{ margin: "0 0 24px", fontSize: 15.5, color: colors.textSoft, lineHeight: 1.55, maxWidth: 440 }}>{firstSentence(profile.description)}</p>}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {primaryCta && <Button onClick={primaryCta.action} style={{ padding: "12px 20px", fontSize: 14.5 }}>{primaryCta.label}</Button>}
              <FollowButton followedType="vendor" followedId={profile.id} initialFollowing={profile.isFollowing} initialLevel={profile.followNotificationLevel} followerCount={profile.followerCount} />
              <ShareButton entityType="provider" entityId={profile.id} />
            </div>
          </div>

          {galleryImages.length > 0 && <PhotoGallery images={galleryImages} alt={profile.name} ph={placeholderStripes.green} height={460} />}
        </div>

        {/* Stat row — now a full-width band under the hero split (rather
            than squeezed into the ~45% text column), so it reads as its
            own beat instead of trailing off the headline. Skipped entirely
            for a new/low-activity provider (isNew) — a literal "0 Listings
            · 0 People joined" headline would read as exactly the kind of
            undesirable-looking new-provider state the redesign brief warns
            against; the dedicated "New to HelloCircle" section further
            down already covers this case. */}
        {!isNew && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 40, borderTop: `1px solid ${colors.border}`, paddingTop: 24, marginBottom: 32 }}>
            <StatPill value={String(profile.trust.totalListings)} label={profile.trust.totalListings === 1 ? "Listing" : "Listings"} />
            <StatPill value={String(profile.trust.participantCount)} label="People joined" />
            {profile.reviewsSummary.count > 0 && (
              <StatPill value={profile.reviewsSummary.average?.toFixed(1) ?? "—"} label={`From ${profile.reviewsSummary.count} review${profile.reviewsSummary.count === 1 ? "" : "s"}`} />
            )}
            {profile.trust.wentAheadPercent !== null && <StatPill value={`${profile.trust.wentAheadPercent}%`} label="Bookings went ahead" />}
          </div>
        )}
      </section>

      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "0 24px 80px" }}>
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 40, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 48, minWidth: 0 }}>
            {/* 3. Upcoming — the centrepiece. */}
            <div id="upcoming" style={{ scrollMarginTop: 24 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
                <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, letterSpacing: "-.01em", margin: 0, display: "flex", alignItems: "baseline", gap: 7 }}>
                  <span aria-hidden="true" style={{ color: colors.orangeDark }}>
                    /
                  </span>
                  Upcoming
                </h2>
              </div>
              <p style={{ fontSize: 13.5, color: colors.mutedLight, margin: "0 0 16px" }}>Things you can join.</p>
              {profile.upcoming.length === 0 && profile.centres.length === 0 ? (
                <div style={{ border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "28px 24px", textAlign: "center" }}>
                  <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 15 }}>Nothing scheduled just yet</p>
                  <p style={{ margin: 0, fontSize: 13.5, color: colors.mutedLight }}>Check back soon, or explore their listings below.</p>
                </div>
              ) : (
                <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
                  {profile.upcoming.map((item) => (
                    <UpcomingCard key={`${item.kind}-${item.id}`} item={item} onOpen={() => navigate(item.href)} />
                  ))}
                  {profile.centres.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => navigate(`/centres/${c.slug ?? c.id}`)}
                      className="card-hover card-surface"
                      style={{ cursor: "pointer", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, overflow: "hidden" }}
                    >
                      <Photo src={c.image || undefined} alt={c.name} ph={placeholderStripes.green} style={{ aspectRatio: cardImageRatio.discovery }} />
                      <div style={{ padding: "12px 14px 14px" }}>
                        <EntityTypeLabel type="place" size={11} color={colors.mutedLight} />
                        <div style={{ fontWeight: 700, fontSize: 14.5, margin: "5px 0 8px" }}>{c.name}</div>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: colors.greenText }}>Check availability →</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* "Looking to book?" banner */}
            {primaryCta && (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, background: colors.greenBg, borderRadius: radius.card, padding: "18px 22px" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Looking to book?</div>
                  <div style={{ fontSize: 13, color: colors.textSoft }}>Check live availability and make a booking.</div>
                </div>
                <button onClick={primaryCta.action} style={{ background: "none", border: "none", color: colors.greenText, fontWeight: 700, fontSize: 13.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                  {primaryCta.label} <ChevronRightIcon size={13} />
                </button>
              </div>
            )}

            {/* 4. About + Amenities */}
            {(profile.description || profile.amenities.items.length > 0) && (
              <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 32, ...sectionDividerStyle }}>
                {profile.description && (
                  <div>
                    <SectionHeading>About {profile.name}</SectionHeading>
                    <p style={{ margin: 0, fontSize: 14.5, color: colors.textSoft, lineHeight: 1.6 }}>{profile.description}</p>
                    {(profile.website || profile.socials?.instagram || profile.socials?.facebook || profile.socials?.x) && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 12 }}>
                        {profile.website && (
                          <a href={profile.website} target="_blank" rel="noreferrer" style={{ fontSize: 13.5, fontWeight: 700, color: colors.greenText }}>
                            Website ↗
                          </a>
                        )}
                        {profile.socials?.instagram && (
                          <a href={profile.socials.instagram} target="_blank" rel="noreferrer" style={{ fontSize: 13.5, fontWeight: 700, color: colors.greenText }}>
                            Instagram ↗
                          </a>
                        )}
                        {profile.socials?.facebook && (
                          <a href={profile.socials.facebook} target="_blank" rel="noreferrer" style={{ fontSize: 13.5, fontWeight: 700, color: colors.greenText }}>
                            Facebook ↗
                          </a>
                        )}
                        {profile.socials?.x && (
                          <a href={profile.socials.x} target="_blank" rel="noreferrer" style={{ fontSize: 13.5, fontWeight: 700, color: colors.greenText }}>
                            X ↗
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {profile.amenities.items.length > 0 && (
                  <div>
                    <SectionHeading>What's available</SectionHeading>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {profile.amenities.items.map((a) => (
                        <div key={a} style={{ fontSize: 14, color: colors.text, paddingBottom: 8, borderBottom: `1px solid ${colors.border}` }}>
                          {a}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 5. What they offer */}
            {offerings.length > 0 && (
              <div style={sectionDividerStyle}>
                <SectionHeading>What they offer</SectionHeading>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {offerings.map((o) => (
                    <div key={o.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${colors.border}` }}>
                      <EntityTypeLabel type={o.kind} size={13} showLabel={false} />
                      <span style={{ fontSize: 14.5, fontWeight: 600 }}>{o.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 6. Trust */}
            <div style={sectionDividerStyle}>
              <SectionHeading>{isNew ? "New to HelloCircle" : "People actually show up"}</SectionHeading>
              {!isNew && <p style={{ fontSize: 13, color: colors.mutedLight, margin: "-8px 0 14px" }}>Real participation with this provider.</p>}
              {isNew ? (
                <p style={{ margin: 0, fontSize: 14, color: colors.mutedLight }}>
                  {profile.name} recently joined HelloCircle
                  {profile.trust.totalListings > 0 ? ` — ${profile.trust.totalListings} listing${profile.trust.totalListings === 1 ? "" : "s"} live now.` : "."}
                </p>
              ) : (
                <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 30 }}>{profile.trust.participantCount}</div>
                    <div style={{ fontSize: 12.5, color: colors.mutedLight, fontWeight: 600 }}>People joined activities</div>
                  </div>
                  {profile.trust.wentAheadPercent !== null && (
                    <div>
                      <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 30 }}>{profile.trust.wentAheadPercent}%</div>
                      <div style={{ fontSize: 12.5, color: colors.mutedLight, fontWeight: 600 }}>Bookings went ahead</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 7. Reviews */}
            {profile.reviewsSummary.count > 0 && (
              <div style={sectionDividerStyle}>
                <SectionHeading>Reviews</SectionHeading>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
                  <span style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 26 }}>{profile.reviewsSummary.average?.toFixed(1)}</span>
                  <StarDisplay rating={profile.reviewsSummary.average ?? 0} size={14} />
                  <span style={{ fontSize: 12.5, color: colors.mutedLight, fontWeight: 600 }}>from {profile.reviewsSummary.count} participant{profile.reviewsSummary.count === 1 ? "" : "s"}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {profile.reviewsSummary.recent.map((r, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 16, borderTop: `1px solid ${colors.border}`, paddingTop: 14 }}>
                      <div>
                        <p style={{ margin: "0 0 6px", fontSize: 14.5, color: colors.text }}>&ldquo;{r.comment}&rdquo;</p>
                        <span style={{ fontSize: 12.5, color: colors.mutedLight, fontWeight: 600 }}>
                          {r.name}
                          {r.listingName && <> · {r.listingName}</>}
                        </span>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: colors.mutedLight, flex: "none" }}>{r.rating}/5</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 10. Similar providers */}
            {profile.similar.length > 0 && (
              <div style={sectionDividerStyle}>
                <SectionHeading>More like this</SectionHeading>
                <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
                  {profile.similar.map((p) => (
                    <ProviderCard key={p.id} provider={p} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar — Good to know + map */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20, position: "sticky", top: 24 }}>
            <div style={{ border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: 20 }}>
              <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 15, margin: "0 0 14px" }}>Good to know</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  ["Area", areas.length ? `${areas.join(" · ")}, ${profile.county}` : profile.county],
                  ["Cancellations", `Up to ${profile.policies.cancellationHours}h before`],
                  ["Bookings taken up to", `${profile.policies.bookingWindowDays} days ahead`],
                  ...(profile.amenities.accessibility ? [["Accessibility", profile.amenities.accessibility]] : []),
                ].map(([label, value]) => (
                  <div key={label} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 13, borderBottom: `1px solid ${colors.border}`, paddingBottom: 10 }}>
                    <span style={{ color: colors.mutedLight }}>{label}</span>
                    <span style={{ fontWeight: 600 }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {profile.mapLocation && (
              <div style={{ border: `1px solid ${colors.border}`, borderRadius: radius.card, overflow: "hidden" }}>
                <SinglePinMap lat={profile.mapLocation.lat} lng={profile.mapLocation.lng} label={profile.mapLocation.label} height={180} />
                <div style={{ padding: "14px 16px" }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>{profile.mapLocation.label}</div>
                  <div style={{ fontSize: 12.5, color: colors.mutedLight, marginBottom: 10 }}>{profile.county}</div>
                  <LinkButton
                    variant="ghost"
                    href={`https://www.google.com/maps/search/?api=1&query=${profile.mapLocation.lat},${profile.mapLocation.lng}`}
                    target="_blank"
                    style={{ padding: "8px 14px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 5 }}
                  >
                    <PinIcon size={12} /> Get directions
                  </LinkButton>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
