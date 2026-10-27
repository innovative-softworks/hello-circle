import { Building2 as Building2Lucide } from "lucide-react";
import { UnavailableListing, isUnavailable, type Unavailable } from "../components/UnavailableListing";
import { usePageTitle } from "../pageTitle";
import { useEffect, useState } from "react";
import { isMinAgeRefusal } from "../gameCta";
import { TraderInfo } from "../components/TraderInfo";
import { useToast } from "../components/Toast";
import { dateLabel } from "../euro";
import { joinGameConfirm } from "../confirmCopy";
import { useConfirm } from "../components/ConfirmProvider";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fetchCentre, fetchGamesPage, fetchPrograms, joinGame } from "../api";
import { openCheckout } from "../native";
import { ClaimListingCTA } from "../components/ClaimListingCTA";
import { FollowButton } from "../components/FollowButton";
import { PhotoGallery } from "../components/PhotoGallery";
import { Reviews } from "../components/Reviews";
import { CalendarIcon, CheckIcon, ClockIcon, PinIcon, RepeatIcon, StarIcon, UsersIcon, WheelchairIcon } from "../components/icons";
import { AvailabilityBadge, availabilityFromSpots, Button, ListingDetailSkeleton } from "../components/ui";
import { useGuest } from "../GuestContext";
import { colors, fonts, maxWidth, radius } from "../theme";
import type { Centre, Game, Program } from "../types";
import { formatPrice } from "../formatters";
import { CtaBand } from "../components/CtaBand";
import { DetailSection, LocationBlock } from "../components/detail/DetailSections";
import { DetailTopBar } from "../components/detail/DetailTopBar";
import { KeyFacts, PAID_PRICE_NOTE } from "../components/detail/KeyFacts";

export function CentreDetail() {
  // Slugs (master-prompt punch list #1) — the URL param may be a slug or a
  // raw UUID; fetchCentre() resolves either. Every OTHER call in this
  // component uses centre.id (the resolved canonical id) once loaded, never
  // this raw param directly, so a slug-based sub-resource lookup can never
  // silently 404.
  const { id: idOrSlug } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [centre, setCentre] = useState<Centre | null>(null);
  // D-01: a listing whose organisation is suspended.
  const [unavailable, setUnavailable] = useState<Unavailable | null>(null);
  usePageTitle(centre?.name);
  const [games, setGames] = useState<Game[]>([]);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const [programs, setPrograms] = useState<Program[]>([]);

  useEffect(() => {
    if (idOrSlug) fetchCentre(idOrSlug).then((x) => (isUnavailable(x) ? setUnavailable(x) : setCentre(x)));
  }, [idOrSlug]);

  // "Join a Game" CTA (MVP — Book vs Join) — open games hosted at this venue.
  useEffect(() => {
    if (!centre) return;
    // HC-QA-101 — filtered by the server; the public list is paginated, so
    // filtering its first page here would miss most of a venue's activities.
    fetchGamesPage({ centreId: centre.id, limit: 100 }).then((p) => setGames(p.items)).catch(() => setGames([]));
  }, [centre]);

  // Programs (Phase B) — multi-session activities run at this centre.
  useEffect(() => {
    if (centre) fetchPrograms("centre", centre.id).then(setPrograms).catch(() => {});
  }, [centre]);

  const handleJoinGame = async (gameId: string) => {
    const g = games.find((x) => x.id === gameId);
    if (g && !(await confirm(joinGameConfirm({ title: g.activityLabel, when: `${dateLabel(g.date)} · ${g.time}`, priceCents: g.priceCents })))) return;
    setJoiningId(gameId);
    try {
      const res = await joinGame(gameId);
      if (res.url) {
        openCheckout(res.url);
        return;
      }
      setGames((rows) => rows.map((g) => (g.id === gameId ? { ...g, joined: g.joined + 1, spotsLeft: g.spotsLeft - 1 } : g)));
    } catch (e) {
      if (isMinAgeRefusal(e)) return void navigate(`/games/${gameId}`);
      toast.error(e instanceof Error ? e.message : "Couldn't join this session");
    } finally {
      setJoiningId(null);
    }
  };

  const reloadRating = () => {
    if (idOrSlug) fetchCentre(idOrSlug).then((x) => (isUnavailable(x) ? setUnavailable(x) : setCentre(x)));
  };

  if (unavailable) return <UnavailableListing item={unavailable} />;
  if (!centre) return <ListingDetailSkeleton />;

  return (
    <>
    <div className="centre-detail-mobile-pad fade-panel">
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "26px 24px 70px" }}>
        <DetailTopBar
          backTo="/browse/centres"
          backLabel="All community centres"
          extra={
            centre.isFollowing !== undefined ? (
              <FollowButton followedType="centre" followedId={centre.id} initialFollowing={centre.isFollowing} initialLevel={centre.followNotificationLevel} followerCount={centre.followerCount} />
            ) : undefined
          }
          share={{ entityType: "centre", entityId: centre.id }}
          save={{ kind: "centre", id: centre.id }}
          report={{ type: "centre", id: centre.id, what: "this listing" }}
        />
        {/* Detail-page redesign: the shared 70/30 layout (still behind the venue launch gate). */}
        <div className="detail-grid">
        <div className="detail-head">
          <PhotoGallery images={centre.images} alt={centre.name} ph={centre.ph} style={{ marginBottom: 24 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            {centre.reviews > 0 && (
              <>
                <StarIcon size={16} style={{ color: colors.gold }} />
                <span style={{ fontWeight: 700 }}>{centre.rating}</span>
                <span style={{ color: colors.faint }}>({centre.reviews} reviews)</span>
                <span style={{ color: colors.faint }}>·</span>
              </>
            )}
            <span style={{ color: colors.faint }}>up to {centre.capacity} guests</span>
          </div>
          {centre.wouldRepeatPercent !== null && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: colors.greenBg, color: colors.greenText, borderRadius: radius.pill, padding: "5px 12px", fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
              {centre.wouldRepeatPercent}% would do this again
              <span style={{ fontWeight: 500, color: colors.muted }}>({centre.wouldRepeatCount})</span>
            </div>
          )}
          <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", color: colors.mutedLight, marginBottom: 6 }}>Venue</div>
          <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: "clamp(32px, 3.8vw, 52px)", margin: "0 0 4px", letterSpacing: 0 }}>{centre.name}</h1>
          <p style={{ color: colors.mutedLight, fontSize: 16, margin: "0 0 22px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>
              {centre.area} · Managed by{" "}
              {centre.vendorId ? (
                <button className="tap-target" onClick={() => navigate(`/provider/${centre.vendorId}`)} style={{ background: "none", border: "none", padding: 0, color: colors.greenText, font: "inherit", fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>
                  {centre.managedBy}
                </button>
              ) : (
                centre.managedBy
              )}
            </span>
            {centre.mapUrl && (
              <a href={centre.mapUrl} target="_blank" rel="noopener noreferrer" className="link-accent" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: colors.greenText, fontSize: 14, fontWeight: 600 }}>
                <PinIcon size={14} /> View on map
              </a>
            )}
          </p>
          <KeyFacts
            facts={[
              { icon: <UsersIcon size={17} />, value: `Up to ${centre.capacity}`, label: "Guests" },
              centre.reviews > 0 && { icon: <StarIcon size={17} />, value: `${centre.rating} (${centre.reviews})`, label: "Rating" },
              { icon: <ClockIcon size={17} />, value: centre.paymentMethod === "cash" ? "Pay on arrival" : "Pay online", label: "Payment" },
              { icon: <RepeatIcon size={17} />, value: `${centre.cancellationHours ?? 48}h`, label: "Free cancellation before" },
            ]}
          />
        </div>

        <div className="detail-body">
          <div style={{ height: 1, background: colors.border, margin: "24px 0" }} />
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: "0 0 12px", letterSpacing: 0 }}>About this venue</h2>
          <p style={{ fontSize: 16, lineHeight: 1.6, color: colors.textSoft, margin: "0 0 28px" }}>{centre.blurb}</p>

          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: "0 0 12px", letterSpacing: 0 }}>
            Facilities
          </h2>
          <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", marginBottom: 32 }}>
            {centre.amenities.map((a) => (
              <div key={a} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: colors.textSoft }}>
                <CheckIcon size={16} style={{ color: colors.greenText }} />
                {a}
              </div>
            ))}
          </div>

          {centre.accessibility.length > 0 && (
            <>
              <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: "0 0 12px", letterSpacing: 0 }}>
                Accessibility
              </h2>
              <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", marginBottom: 32 }}>
                {centre.accessibility.map((a) => (
                  <div key={a} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: colors.textSoft }}>
                    <WheelchairIcon size={16} style={{ color: colors.greenText }} />
                    {a}
                  </div>
                ))}
              </div>
            </>
          )}


          {programs.length > 0 && (
            <>
              <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: "0 0 12px", letterSpacing: 0 }}>
                Programs & classes
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 32 }}>
                {programs.map((p) => (
                  <Link
                    key={p.id}
                    to={`/programs/${p.id}`}
                    style={{ textAlign: "left", textDecoration: "none", color: "inherit", border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "14px 16px", cursor: "pointer", background: colors.surface, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, width: "100%" }}
                  >
                    <div>
                      <div style={{ fontWeight: 700 }}>{p.title}</div>
                      <div style={{ fontSize: 13, color: colors.mutedLight }}>{p.sessions.length} session{p.sessions.length === 1 ? "" : "s"}{p.ageRange ? ` · ${p.ageRange}` : ""}</div>
                    </div>
                    <div style={{ fontWeight: 700 }}>{formatPrice(p.priceCents)}</div>
                  </Link>
                ))}
              </div>
            </>
          )}

          {games.length > 0 && (
            <>
              <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: "0 0 4px", letterSpacing: 0 }}>
                Open sessions here
              </h2>
              <p style={{ color: colors.mutedLight, fontSize: 14, margin: "0 0 14px" }}>
                Don't need the whole venue? Join people who are already playing.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 32 }}>
                {games.map((g) => (
                  <div key={g.id} style={{ border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{g.activityLabel}</div>
                      <div style={{ fontSize: 13, color: colors.mutedLight, display: "flex", gap: 12, marginTop: 2 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><CalendarIcon size={13} /> {dateLabel(g.date)} · {g.time}</span>
                      </div>
                      <AvailabilityBadge state={availabilityFromSpots(g.spotsLeft)} style={{ marginTop: 6 }}>
                        <UsersIcon size={12} /> {g.spotsLeft === 0 ? "Full" : `${g.spotsLeft} spot${g.spotsLeft === 1 ? "" : "s"} left`}
                      </AvailabilityBadge>
                    </div>
                    <Button onClick={() => handleJoinGame(g.id)} disabled={joiningId === g.id || g.spotsLeft === 0}>
                      {g.spotsLeft === 0 ? "Full" : joiningId === g.id ? "Joining…" : "I'm in"}
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}

          <Reviews listingType="centre" listingId={centre.id} accent="green" onReviewPosted={reloadRating} />
          <div style={{ marginTop: 20 }}>
            <TraderInfo type="centre" id={centre.id} />
          </div>
        </div>
        <div className="detail-aside">
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <div style={{ fontSize: 14, color: colors.mutedLight }}>Hire from</div>
            {centre.paymentMethod === "cash" && (
              <span style={{ fontSize: 11, fontWeight: 700, color: colors.orangeDark, background: colors.orangeBg, borderRadius: radius.pill, padding: "2px 8px" }}>
                Cash on arrival
              </span>
            )}
          </div>
          <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 30, marginBottom: 2 }}>
            €{centre.from}
            <span style={{ fontSize: 16, color: colors.faint, fontWeight: 400 }}> /hour</span>
          </div>
          <div style={{ fontSize: 13, color: colors.faint, marginBottom: 18 }}>
            {centre.paymentMethod === "cash" ? "No online deposit needed" : `+ €100 refundable deposit · ${PAID_PRICE_NOTE}`}
          </div>
          {centre.isOpen ? (
            <Button variant="primary" full onClick={() => navigate(`/book/${centre.id}`)} style={{ padding: 14, fontSize: 15, marginBottom: 10 }}>
              Check availability
            </Button>
          ) : (
            <div style={{ width: "100%", background: colors.panel, color: colors.muted, border: "none", borderRadius: radius.control, padding: 14, fontSize: 14, fontWeight: 600, textAlign: "center", marginBottom: 10 }}>
              Not currently taking bookings
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 16, fontSize: 14, color: colors.muted }}>
            <div style={{ display: "flex", gap: 10 }}>
              <ClockIcon size={16} style={{ color: colors.greenText }} /> {centre.paymentMethod === "cash" ? "Confirmed straight away, pay on arrival" : "Confirmed as soon as you've paid"}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <RepeatIcon size={16} style={{ color: colors.greenText }} /> Free cancellation up to {centre.cancellationHours ?? 48}h before
            </div>
            {centre.accessibility.length > 0 && (
              <div style={{ display: "flex", gap: 10 }}>
                <WheelchairIcon size={16} style={{ color: colors.greenText }} /> {centre.accessibility[0]}
                {centre.accessibility.length > 1 ? ` +${centre.accessibility.length - 1} more` : ""}
              </div>
            )}
            {centre.phone && (
              <div style={{ display: "flex", gap: 10 }}>
                <a href={`tel:${centre.phone}`} className="link-accent" style={{ color: colors.muted }}>
                  {centre.phone}
                </a>
              </div>
            )}
          </div>
        </div>
        {/* Where sits in the booking column (owner, 2026-10-22). */}
        <div style={{ marginTop: 24 }}>
          {centre.lat !== null && centre.lng !== null && (
            <DetailSection title="Location">
              <LocationBlock
                name={centre.name}
                area={[centre.area, centre.county].filter(Boolean).join(", ") || null}
                note={centre.locationSource !== "confirmed" ? "Approximate area — not an exact address" : null}
                // A fabricated area pin is never handed to a navigation app as an address.
                directionsUrl={centre.locationSource === "confirmed" ? `https://www.google.com/maps/search/?api=1&query=${centre.lat},${centre.lng}` : null}
                map={{ lat: centre.lat, lng: centre.lng, label: centre.name }}
              />
            </DetailSection>
          )}
        </div>
        </div>
        </div>
      </section>
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "0 24px 80px" }}>
        <ClaimListingCTA listingType="centre" listingId={centre.id} claimed={centre.claimed} />
      </section>
      <CtaBand
        id="centre-cta-title"
        panel={{ title: "Need a different space?", text: "Halls and rooms you can book by the hour.", icon: <Building2Lucide size={20} strokeWidth={2} /> }}
        label="Book a space."
        lines={["Need", "a space", "to meet?"]}
        text="Halls and rooms in community centres across Ireland, bookable by the hour."
        action={{ label: "Browse venues", to: "/browse/centres" }}
      />
    </div>

    {/* Mobile sticky CTA bar — mirrors the rail card's own state (open/not
        taking bookings) so the two never disagree. */}
    <div className="mobile-join-bar">
      <div>
        <div style={{ fontWeight: 800, fontSize: 15, fontFamily: fonts.display }}>{centre.name}</div>
        <div style={{ fontSize: 12.5, color: colors.mutedLight }}>From €{centre.from}/hour</div>
      </div>
      {centre.isOpen ? (
        <Button style={{ flex: "none" }} onClick={() => navigate(`/book/${centre.id}`)}>Check availability</Button>
      ) : (
        <Button variant="ghost" disabled style={{ flex: "none" }}>Not taking bookings</Button>
      )}
    </div>
    </>
  );
}
