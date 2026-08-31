import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { addFavourite, createPassCheckout, fetchClub, fetchFavourites, fetchPrograms, PLATFORM_FEE_RATE, removeFavourite, VAT_RATE } from "../api";
import { BackLink } from "../components/BackLink";
import { ClaimListingCTA } from "../components/ClaimListingCTA";
import { PhotoGallery } from "../components/PhotoGallery";
import { Reviews } from "../components/Reviews";
import { SinglePinMap } from "../components/SinglePinMap";
import { priceLabel } from "../priceLabel";
import { CheckIcon, ClockIcon, HeartIcon, PinIcon, StarIcon, WheelchairIcon } from "../components/icons";
import { Button, ListingDetailSkeleton } from "../components/ui";
import { isFavorite, toggleFavorite } from "../favorites";
import { useGuest } from "../GuestContext";
import { colors, fonts, maxWidth, radius } from "../theme";
import type { Club, Program } from "../types";
import { formatPrice } from "../formatters";

export function ClubDetail() {
  // Slugs (master-prompt punch list #1) — see CentreDetail.tsx's own
  // comment; every call below uses club.id once loaded, never this raw
  // param.
  const { id: idOrSlug } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [club, setClub] = useState<Club | null>(null);
  const [favourited, setFavourited] = useState(false);
  const [passLoading, setPassLoading] = useState(false);
  const [programs, setPrograms] = useState<Program[]>([]);

  useEffect(() => {
    if (idOrSlug) fetchClub(idOrSlug).then(setClub);
  }, [idOrSlug]);

  useEffect(() => {
    if (club) fetchPrograms("club", club.id).then(setPrograms).catch(() => {});
  }, [club]);

  useEffect(() => {
    if (!club) return;
    if (resident) fetchFavourites().then((rows) => setFavourited(rows.some((r) => r.listingType === "club" && r.listingId === club.id)));
    else setFavourited(isFavorite("club", club.id));
  }, [club, resident]);

  const handleToggleFavourite = async () => {
    if (!club) return;
    if (resident) {
      if (favourited) await removeFavourite("club", club.id);
      else await addFavourite("club", club.id);
      setFavourited((f) => !f);
    } else {
      setFavourited(toggleFavorite("club", club.id));
    }
  };

  // Credit-pack pass purchase (NEXT) — a simple fixed 10-credit pack;
  // a real product would let the vendor configure pack size/pricing.
  const handleBuyPass = async () => {
    if (!club) return;
    setPassLoading(true);
    try {
      const res = await createPassCheckout({ listingId: club.id, creditsTotal: 10 });
      if (res.url) window.location.href = res.url;
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't start checkout");
    } finally {
      setPassLoading(false);
    }
  };

  const reloadRating = () => {
    if (idOrSlug) fetchClub(idOrSlug).then(setClub);
  };

  if (!club) return <ListingDetailSkeleton />;

  return (
    <>
    <div className="club-detail-mobile-pad" style={{ animation: "fadeUp .35s ease both" }}>
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "26px 24px 0" }}>
        <BackLink onClick={() => navigate("/browse/clubs")} marginBottom={16}>All sports clubs</BackLink>
        <div style={{ position: "relative" }}>
          <PhotoGallery images={club.images} alt={club.name} ph={club.ph} />
          <span
            style={{
              position: "absolute",
              left: 20,
              bottom: 20,
              background: "rgba(255,255,255,.92)",
              borderRadius: 8,
              padding: "6px 12px",
              fontFamily: fonts.display,
              fontWeight: 700,
              fontSize: 16,
              color: colors.orangeDark,
              letterSpacing: "-.01em",
              pointerEvents: "none",
            }}
          >
            {club.sport}
          </span>
        </div>
      </section>
      <section
        className="grid-responsive section-pad"
        style={{ maxWidth, margin: "0 auto", padding: "26px 24px 70px", display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 40, alignItems: "start" }}
      >
        <div>
          {club.trial && (
            <span
              style={{ display: "inline-block", background: colors.greenBg, color: colors.greenText, borderRadius: 20, padding: "4px 12px", fontSize: 13, fontWeight: 700, marginBottom: 12 }}
            >
              Free trial session available
            </span>
          )}
          <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: "clamp(26px, 5vw, 36px)", margin: "0 0 4px", letterSpacing: "-.025em", display: "flex", alignItems: "center", gap: 10 }}>
            {club.name}
            <button
              onClick={handleToggleFavourite}
              aria-label={favourited ? "Remove from favourites" : "Add to favourites"}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "inline-flex", color: favourited ? colors.orange : colors.faint }}
            >
              <HeartIcon size={22} style={favourited ? { fill: colors.orange } : undefined} />
            </button>
          </h1>
          {club.capacity !== null && (
            <span style={{ display: "inline-block", background: colors.panel, color: colors.muted, borderRadius: 20, padding: "3px 11px", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
              Limited to {club.capacity} members
            </span>
          )}
          <p style={{ color: colors.mutedLight, fontSize: 16, margin: "0 0 8px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>{club.area} · {club.sport} · ages {club.ages}</span>
            {club.category && (
              <span style={{ fontSize: 12, fontWeight: 700, color: colors.orangeDark, background: colors.orangeBg, borderRadius: radius.pill, padding: "3px 10px" }}>{club.category}</span>
            )}
            {club.mapUrl && (
              <a href={club.mapUrl} target="_blank" rel="noopener noreferrer" className="link-accent" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: colors.orangeDark, fontSize: 14, fontWeight: 600 }}>
                <PinIcon size={14} /> View on map
              </a>
            )}
          </p>
          {club.reviews > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
              <StarIcon size={16} style={{ color: colors.gold }} />
              <span style={{ fontWeight: 700 }}>{club.rating}</span>
              <span style={{ color: colors.faint }}>({club.reviews} reviews)</span>
            </div>
          )}
          {club.wouldRepeatPercent !== null && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: colors.greenBg, color: colors.greenText, borderRadius: radius.pill, padding: "5px 12px", fontSize: 13, fontWeight: 700, marginBottom: 14 }}>
              {club.wouldRepeatPercent}% would do this again
              <span style={{ fontWeight: 500, color: colors.muted }}>({club.wouldRepeatCount})</span>
            </div>
          )}
          <p style={{ fontSize: 16, lineHeight: 1.6, color: colors.textSoft, margin: "0 0 28px" }}>{club.blurb}</p>
          <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: "0 0 12px", letterSpacing: "-.01em" }}>
            What's included
          </h3>
          <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", marginBottom: 20 }}>
            {club.includes.map((a) => (
              <div key={a} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: colors.textSoft }}>
                <CheckIcon size={16} style={{ color: colors.orange }} />
                {a}
              </div>
            ))}
          </div>

          {club.accessibility.length > 0 && (
            <>
              <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: "0 0 12px", letterSpacing: "-.01em" }}>
                Accessibility
              </h3>
              <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", marginBottom: 20 }}>
                {club.accessibility.map((a) => (
                  <div key={a} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: colors.textSoft }}>
                    <WheelchairIcon size={16} style={{ color: colors.orange }} />
                    {a}
                  </div>
                ))}
              </div>
            </>
          )}

          {club.lat !== null && club.lng !== null && (
            <>
              <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: "0 0 12px", letterSpacing: "-.01em" }}>
                Location
              </h3>
              <SinglePinMap lat={club.lat} lng={club.lng} label={club.name} height={220} />
              <div style={{ marginBottom: 20 }} />
            </>
          )}

          {programs.length > 0 && (
            <>
              <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: "24px 0 12px", letterSpacing: "-.01em" }}>
                Programs & classes
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
        </div>
        <div
          className="sticky-aside"
          style={{ position: "sticky", top: 90, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 18, padding: 22, boxShadow: "0 8px 30px rgba(30,40,32,.05)" }}
        >
          <div style={{ fontSize: 14, color: colors.mutedLight, marginBottom: 4 }}>Membership</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28 }}>{priceLabel(club)}</div>
            {club.paymentMethod === "cash" && (
              <span style={{ fontSize: 11, fontWeight: 700, color: colors.orangeDark, background: colors.orangeBg, borderRadius: radius.pill, padding: "2px 8px" }}>
                Cash on arrival
              </span>
            )}
          </div>
          <Button variant="orange" full onClick={() => navigate(`/register/${club.id}`)} style={{ padding: 14, fontSize: 15, marginBottom: 10 }}>
            {club.audience === "kids" ? "Register my child" : "Register"}
          </Button>
          {resident && club.paymentMethod !== "cash" && (
            <Button variant="ghost" full onClick={handleBuyPass} disabled={passLoading} style={{ padding: 12, fontSize: 14, marginBottom: 10 }}>
              {passLoading
                ? "Please wait…"
                : /* Inclusive of VAT + platform fee, matching what checkoutService.ts actually
                   * charges (server/src/pricing.ts's computePricing) — showing the bare subtotal
                   * here understated the real Stripe total by ~28%. */
                  `Buy a 10-session pass — €${Math.round(club.price * 10 * (1 + VAT_RATE + PLATFORM_FEE_RATE))} (incl. VAT & fee)`}
            </Button>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 16, fontSize: 14, color: colors.muted }}>
            <div style={{ display: "flex", gap: 10 }}>
              <ClockIcon size={16} style={{ color: colors.orange }} /> Training year-round
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <CheckIcon size={16} style={{ color: colors.orange }} /> Garda-vetted, qualified coaches
            </div>
            {club.phone && (
              <div style={{ display: "flex", gap: 10 }}>
                <a href={`tel:${club.phone}`} className="link-accent" style={{ color: colors.muted }}>
                  {club.phone}
                </a>
              </div>
            )}
          </div>
        </div>
      </section>
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "0 24px 40px" }}>
        <Reviews listingType="club" listingId={club.id} accent="orange" onReviewPosted={reloadRating} />
      </section>
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "0 24px 80px" }}>
        <ClaimListingCTA listingType="club" listingId={club.id} claimed={club.claimed} />
      </section>
    </div>

    <div className="mobile-join-bar">
      <div>
        <div style={{ fontWeight: 800, fontSize: 15, fontFamily: fonts.display }}>{club.name}</div>
        <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{priceLabel(club)}</div>
      </div>
      <Button variant="orange" style={{ flex: "none" }} onClick={() => navigate(`/register/${club.id}`)}>{club.audience === "kids" ? "Register my child" : "Register"}</Button>
    </div>
    </>
  );
}
