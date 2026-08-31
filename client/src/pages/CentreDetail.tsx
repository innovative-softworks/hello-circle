import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { addFavourite, fetchCentre, fetchFavourites, fetchGames, fetchPrograms, joinGame, removeFavourite } from "../api";
import { BackLink } from "../components/BackLink";
import { ClaimListingCTA } from "../components/ClaimListingCTA";
import { FollowButton } from "../components/FollowButton";
import { PhotoGallery } from "../components/PhotoGallery";
import { Reviews } from "../components/Reviews";
import { SinglePinMap } from "../components/SinglePinMap";
import { CalendarIcon, CheckIcon, ClockIcon, HeartIcon, PinIcon, RepeatIcon, StarIcon, UsersIcon, WheelchairIcon } from "../components/icons";
import { AvailabilityBadge, availabilityFromSpots, Button, ListingDetailSkeleton } from "../components/ui";
import { isFavorite, toggleFavorite } from "../favorites";
import { useGuest } from "../GuestContext";
import { colors, fonts, maxWidth, radius } from "../theme";
import type { Centre, Game, Program } from "../types";
import { formatPrice } from "../formatters";

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
  const [favourited, setFavourited] = useState(false);
  const [games, setGames] = useState<Game[]>([]);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);

  useEffect(() => {
    if (idOrSlug) fetchCentre(idOrSlug).then(setCentre);
  }, [idOrSlug]);

  // Server-backed favourites when signed in (MVP); localStorage otherwise —
  // see client/src/favorites.ts for the anonymous fallback.
  useEffect(() => {
    if (!centre) return;
    if (resident) fetchFavourites().then((rows) => setFavourited(rows.some((r) => r.listingType === "centre" && r.listingId === centre.id)));
    else setFavourited(isFavorite("centre", centre.id));
  }, [centre, resident]);

  // "Join a Game" CTA (MVP — Book vs Join) — open games hosted at this venue.
  useEffect(() => {
    if (!centre) return;
    fetchGames().then((rows) => setGames(rows.filter((g) => g.centreId === centre.id)));
  }, [centre]);

  // Programs (Phase B) — multi-session activities run at this centre.
  useEffect(() => {
    if (centre) fetchPrograms("centre", centre.id).then(setPrograms).catch(() => {});
  }, [centre]);

  const handleToggleFavourite = async () => {
    if (!centre) return;
    if (resident) {
      if (favourited) await removeFavourite("centre", centre.id);
      else await addFavourite("centre", centre.id);
      setFavourited((f) => !f);
    } else {
      setFavourited(toggleFavorite("centre", centre.id));
    }
  };

  const handleJoinGame = async (gameId: string) => {
    setJoiningId(gameId);
    try {
      const res = await joinGame(gameId);
      if (res.url) {
        window.location.href = res.url;
        return;
      }
      setGames((rows) => rows.map((g) => (g.id === gameId ? { ...g, joined: g.joined + 1, spotsLeft: g.spotsLeft - 1 } : g)));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't join this game");
    } finally {
      setJoiningId(null);
    }
  };

  const reloadRating = () => {
    if (idOrSlug) fetchCentre(idOrSlug).then(setCentre);
  };

  if (!centre) return <ListingDetailSkeleton />;

  return (
    <>
    <div className="centre-detail-mobile-pad" style={{ animation: "fadeUp .35s ease both" }}>
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "26px 24px 0" }}>
        <BackLink onClick={() => navigate("/browse/centres")} marginBottom={16}>All community centres</BackLink>
        <PhotoGallery images={centre.images} alt={centre.name} ph={centre.ph} />
      </section>
      <section
        className="grid-responsive section-pad"
        style={{ maxWidth, margin: "0 auto", padding: "26px 24px 70px", display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 40, alignItems: "start" }}
      >
        <div>
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
          <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: "clamp(26px, 5vw, 36px)", margin: "0 0 4px", letterSpacing: "-.025em", display: "flex", alignItems: "center", gap: 10 }}>
            {centre.name}
            <button
              onClick={handleToggleFavourite}
              aria-label={favourited ? "Remove from favourites" : "Add to favourites"}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "inline-flex", color: favourited ? colors.orange : colors.faint }}
            >
              <HeartIcon size={22} style={favourited ? { fill: colors.orange } : undefined} />
            </button>
          </h1>
          <p style={{ color: colors.mutedLight, fontSize: 16, margin: "0 0 22px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>
              {centre.area} · Managed by{" "}
              {centre.vendorId ? (
                <button onClick={() => navigate(`/provider/${centre.vendorId}`)} style={{ background: "none", border: "none", padding: 0, color: colors.greenText, font: "inherit", fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>
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
          {centre.isFollowing !== undefined && (
            <div style={{ marginBottom: 18 }}>
              <FollowButton
                followedType="centre"
                followedId={centre.id}
                initialFollowing={centre.isFollowing}
                initialLevel={centre.followNotificationLevel}
                followerCount={centre.followerCount}
              />
            </div>
          )}
          <p style={{ fontSize: 16, lineHeight: 1.6, color: colors.textSoft, margin: "0 0 28px" }}>{centre.blurb}</p>

          <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: "0 0 12px", letterSpacing: "-.01em" }}>
            Facilities
          </h3>
          <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", marginBottom: 32 }}>
            {centre.amenities.map((a) => (
              <div key={a} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: colors.textSoft }}>
                <CheckIcon size={16} style={{ color: colors.green }} />
                {a}
              </div>
            ))}
          </div>

          {centre.accessibility.length > 0 && (
            <>
              <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: "0 0 12px", letterSpacing: "-.01em" }}>
                Accessibility
              </h3>
              <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", marginBottom: 32 }}>
                {centre.accessibility.map((a) => (
                  <div key={a} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: colors.textSoft }}>
                    <WheelchairIcon size={16} style={{ color: colors.green }} />
                    {a}
                  </div>
                ))}
              </div>
            </>
          )}

          {centre.lat !== null && centre.lng !== null && (
            <>
              <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: "0 0 12px", letterSpacing: "-.01em" }}>
                Location
              </h3>
              <SinglePinMap lat={centre.lat} lng={centre.lng} label={centre.name} height={220} />
              <div style={{ marginBottom: 32 }} />
            </>
          )}

          {programs.length > 0 && (
            <>
              <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: "0 0 12px", letterSpacing: "-.01em" }}>
                Programs & classes
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 32 }}>
                {programs.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => navigate(`/programs/${p.id}`)}
                    style={{ textAlign: "left", border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 16px", cursor: "pointer", background: colors.surface, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, width: "100%" }}
                  >
                    <div>
                      <div style={{ fontWeight: 700 }}>{p.title}</div>
                      <div style={{ fontSize: 13, color: colors.mutedLight }}>{p.sessions.length} session{p.sessions.length === 1 ? "" : "s"}{p.ageRange ? ` · ${p.ageRange}` : ""}</div>
                    </div>
                    <div style={{ fontWeight: 700 }}>{formatPrice(p.priceCents)}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {games.length > 0 && (
            <>
              <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: "0 0 4px", letterSpacing: "-.01em" }}>
                Open games here
              </h3>
              <p style={{ color: colors.mutedLight, fontSize: 14, margin: "0 0 14px" }}>
                Don't need the whole venue? Join people who are already playing.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 32 }}>
                {games.map((g) => (
                  <div key={g.id} style={{ border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{g.activityLabel}</div>
                      <div style={{ fontSize: 13, color: colors.mutedLight, display: "flex", gap: 12, marginTop: 2 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><CalendarIcon size={13} /> {g.date} · {g.time}</span>
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
        </div>
        <div
          className="sticky-aside"
          style={{ position: "sticky", top: 90, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 18, padding: 22, boxShadow: "0 8px 30px rgba(30,40,32,.05)" }}
        >
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
            {centre.paymentMethod === "cash" ? "No online deposit needed" : "+ €100 refundable deposit"}
          </div>
          {centre.isOpen ? (
            <Button variant="primary" full onClick={() => navigate(`/book/${centre.id}`)} style={{ padding: 14, fontSize: 15, marginBottom: 10 }}>
              Check availability
            </Button>
          ) : (
            <div style={{ width: "100%", background: colors.panel, color: colors.muted, border: "none", borderRadius: 12, padding: 14, fontSize: 14, fontWeight: 600, textAlign: "center", marginBottom: 10 }}>
              Not currently taking bookings
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 16, fontSize: 14, color: colors.muted }}>
            <div style={{ display: "flex", gap: 10 }}>
              <ClockIcon size={16} style={{ color: colors.green }} /> Instant online confirmation
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <RepeatIcon size={16} style={{ color: colors.green }} /> Free cancellation up to 48h before
            </div>
            {centre.accessibility.length > 0 && (
              <div style={{ display: "flex", gap: 10 }}>
                <WheelchairIcon size={16} style={{ color: colors.green }} /> {centre.accessibility[0]}
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
      </section>
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "0 24px 40px" }}>
        <Reviews listingType="centre" listingId={centre.id} accent="green" onReviewPosted={reloadRating} />
      </section>
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "0 24px 80px" }}>
        <ClaimListingCTA listingType="centre" listingId={centre.id} claimed={centre.claimed} />
      </section>
    </div>

    {/* Mobile sticky CTA bar — mirrors the rail card's own state (open/not
        taking bookings) so the two never disagree. */}
    <div className="mobile-join-bar">
      <div>
        <div style={{ fontWeight: 800, fontSize: 15, fontFamily: fonts.display }}>{centre.name}</div>
        <div style={{ fontSize: 12.5, color: colors.mutedLight }}>€{centre.from}/hour</div>
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
