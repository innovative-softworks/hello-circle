import { Users as UsersLucide } from "lucide-react";
import { WhatToExpect, clubExpectFacts } from "../components/trust/WhatToExpect";
import { UnavailableListing, isUnavailable, type Unavailable } from "../components/UnavailableListing";
import { usePageTitle } from "../pageTitle";
import { usePaidCheckoutOpen } from "../paidCheckout";
import { useEffect, useState } from "react";
import { TraderInfo } from "../components/TraderInfo";
import { useToast } from "../components/Toast";
import { OfficialCircleLink } from "../components/OfficialCircleLink";
import { ParticipationBlock } from "../components/ParticipationBlock";
import { Link, useNavigate, useParams } from "react-router-dom";
import { createPassCheckout, fetchClub, fetchPrograms, quotePass } from "../api";
import { formatCents } from "../components/booking/quoteLines";
import { openCheckout } from "../native";
import { ListingChatButton } from "../components/ListingChats";
import { ClaimListingCTA } from "../components/ClaimListingCTA";
import { PhotoGallery } from "../components/PhotoGallery";
import { Reviews } from "../components/Reviews";
import { priceLabel } from "../priceLabel";
import { BallIcon, CheckIcon, PersonIcon, PinIcon, StarIcon, UsersIcon } from "../components/icons";
import { Button, ConfirmDialog, ListingDetailSkeleton } from "../components/ui";
import { useGuest } from "../GuestContext";
import { colors, fonts, maxWidth, radius } from "../theme";
import type { Club, Program } from "../types";
import { formatPrice } from "../formatters";
import { CtaBand } from "../components/CtaBand";
import { DetailSection, LocationBlock } from "../components/detail/DetailSections";
import { DetailTopBar, detailActionStyle } from "../components/detail/DetailTopBar";
import { KeyFacts, PAID_PRICE_NOTE } from "../components/detail/KeyFacts";

export function ClubDetail() {
  // The pass is card-only: hidden while paid checkout is closed (the server refuses it too).
  const paidOpen = usePaidCheckoutOpen();
  const toast = useToast();
  // Slugs (master-prompt punch list #1) — see CentreDetail.tsx's own
  // comment; every call below uses club.id once loaded, never this raw
  // param.
  const { id: idOrSlug } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [club, setClub] = useState<Club | null>(null);
  // D-01: a listing whose organisation is suspended.
  const [unavailable, setUnavailable] = useState<Unavailable | null>(null);
  usePageTitle(club?.name);
  const [passLoading, setPassLoading] = useState(false);
  const [passConfirmOpen, setPassConfirmOpen] = useState(false);
  const [programs, setPrograms] = useState<Program[]>([]);

  useEffect(() => {
    if (idOrSlug) fetchClub(idOrSlug).then((x) => (isUnavailable(x) ? setUnavailable(x) : setClub(x)));
  }, [idOrSlug]);

  useEffect(() => {
    if (club) fetchPrograms("club", club.id).then(setPrograms).catch(() => {});
  }, [club]);

  // R3A — the pass price is the server's quote (the same pricing function the
  // checkout charges with), never a client estimate. Null = still loading or
  // unavailable, in which case the button doesn't show a price.
  const [passTotalCents, setPassTotalCents] = useState<number | null>(null);
  const passOffered = !!club && !!resident && club.paymentMethod !== "cash" && club.price > 0;
  useEffect(() => {
    if (!passOffered || !club) return setPassTotalCents(null);
    let live = true;
    quotePass(club.id, 10)
      .then((q) => live && setPassTotalCents(q.totalCents))
      .catch(() => live && setPassTotalCents(null));
    return () => {
      live = false;
    };
  }, [passOffered, club?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Credit-pack pass purchase (NEXT) — a simple fixed 10-credit pack;
  // a real product would let the vendor configure pack size/pricing.
  const handleBuyPass = async () => {
    if (!club) return;
    setPassLoading(true);
    try {
      const res = await createPassCheckout({ listingId: club.id, creditsTotal: 10 });
      if (res.url) openCheckout(res.url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start checkout");
    } finally {
      setPassLoading(false);
    }
  };

  const reloadRating = () => {
    if (idOrSlug) fetchClub(idOrSlug).then((x) => (isUnavailable(x) ? setUnavailable(x) : setClub(x)));
  };

  if (unavailable) return <UnavailableListing item={unavailable} />;
  if (!club) return <ListingDetailSkeleton />;

  return (
    <>
    <div className="club-detail-mobile-pad fade-panel">
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "26px 24px 70px" }}>
        <DetailTopBar
          backTo="/browse/clubs"
          backLabel="All sports clubs"
          extra={<ListingChatButton scopeType="club" listingId={club.id} style={detailActionStyle} />}
          share={{ entityType: "club", entityId: club.id }}
          save={{ kind: "club", id: club.id }}
          report={{ type: "club", id: club.id, what: "this listing" }}
        />
        {/* Detail-page redesign: the shared 70/30 layout (still behind the club launch gate). */}
        <div className="detail-grid">
        <div className="detail-head">
        <div style={{ position: "relative", marginBottom: 24 }}>
          <PhotoGallery images={club.images} alt={club.name} ph={club.ph} />
          <span
            style={{
              position: "absolute",
              left: 20,
              bottom: 20,
              background: "rgba(255,255,255,.92)",
              borderRadius: radius.control,
              padding: "6px 12px",
              fontFamily: fonts.display,
              fontWeight: 700,
              fontSize: 16,
              color: colors.orangeDark,
              letterSpacing: 0,
              pointerEvents: "none",
            }}
          >
            {club.sport}
          </span>
        </div>
          <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", color: colors.mutedLight, marginBottom: 6 }}>Club{club.category ? ` · ${club.category}` : ""}</div>
          <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: "clamp(32px, 3.8vw, 52px)", margin: "0 0 4px", letterSpacing: 0 }}>{club.name}</h1>
          <p style={{ color: colors.mutedLight, fontSize: 16, margin: "0 0 8px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>
              {club.area} · {club.sport} · ages {club.ages}
              {/* DP-13 — the club's provider profile, same link the venue page has. */}
              {club.vendorId && (
                <>
                  {" · "}
                  <button className="tap-target" onClick={() => navigate(`/provider/${club.vendorId}`)} style={{ background: "none", border: "none", padding: 0, color: colors.greenText, font: "inherit", fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>
                    View provider
                  </button>
                </>
              )}
            </span>
            {club.mapUrl && (
              <a href={club.mapUrl} target="_blank" rel="noopener noreferrer" className="link-accent" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: colors.orangeDark, fontSize: 14, fontWeight: 600 }}>
                <PinIcon size={14} /> View on map
              </a>
            )}
          </p>
          {club.wouldRepeatPercent !== null && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: colors.greenBg, color: colors.greenText, borderRadius: radius.pill, padding: "5px 12px", fontSize: 13, fontWeight: 700, marginBottom: 14 }}>
              {club.wouldRepeatPercent}% would do this again
              <span style={{ fontWeight: 500, color: colors.muted }}>({club.wouldRepeatCount})</span>
            </div>
          )}
          <div style={{ marginBottom: 18 }}>
            <ParticipationBlock attributes={club.participationAttributes} />
            <OfficialCircleLink circleId={club.circleId} circleName={club.circleName} circleSlug={club.circleSlug} />
          </div>
          <KeyFacts
            facts={[
              { icon: <BallIcon size={17} />, value: club.sport, label: "Sport" },
              { icon: <PersonIcon size={17} />, value: club.ages, label: "Ages" },
              club.capacity !== null && { icon: <UsersIcon size={17} />, value: `Up to ${club.capacity}`, label: "Members" },
              club.reviews > 0 && { icon: <StarIcon size={17} />, value: `${club.rating} (${club.reviews})`, label: "Rating" },
              club.trial && { icon: <CheckIcon size={17} />, value: "Free trial", label: "First session" },
            ]}
          />
        </div>

        <div className="detail-body">
          <div style={{ height: 1, background: colors.border, margin: "24px 0" }} />
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: "0 0 12px", letterSpacing: 0 }}>About this club</h2>
          <p style={{ fontSize: 16, lineHeight: 1.6, color: colors.textSoft, margin: "0 0 28px" }}>{club.blurb}</p>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: "0 0 12px", letterSpacing: 0 }}>
            What's included
          </h2>
          <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", marginBottom: 20 }}>
            {club.includes.map((a) => (
              <div key={a} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: colors.textSoft }}>
                <CheckIcon size={16} style={{ color: colors.orangeDark }} />
                {a}
              </div>
            ))}
          </div>

          {/* Trust & Retention — one "What to expect" list for the club. */}
          <div style={{ marginTop: 8 }}>
            <WhatToExpect facts={clubExpectFacts(club)} contact="Ask the club, or" />
          </div>


          {programs.length > 0 && (
            <>
              <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: "24px 0 12px", letterSpacing: 0 }}>
                Programs & classes
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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

          <div style={{ marginTop: 28 }}>
            <Reviews listingType="club" listingId={club.id} accent="orange" onReviewPosted={reloadRating} />
          </div>
          <div style={{ marginTop: 20 }}>
            <TraderInfo type="club" id={club.id} />
          </div>
        </div>
        <div className="detail-aside">
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: 22 }}>
          <div style={{ fontSize: 14, color: colors.mutedLight, marginBottom: 4 }}>Membership</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: club.price > 0 && club.paymentMethod !== "cash" ? 2 : 16 }}>
            <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28 }}>{priceLabel(club)}</div>
            {club.paymentMethod === "cash" && (
              <span style={{ fontSize: 11, fontWeight: 700, color: colors.orangeDark, background: colors.orangeBg, borderRadius: radius.pill, padding: "2px 8px" }}>
                Cash on arrival
              </span>
            )}
          </div>
          {club.price > 0 && club.paymentMethod !== "cash" && <div style={{ fontSize: 13, color: colors.faint, marginBottom: 16 }}>{PAID_PRICE_NOTE}</div>}
          <Button variant="orange" full onClick={() => navigate(`/register/${club.id}`)} style={{ padding: 14, fontSize: 15, marginBottom: 10 }}>
            {club.audience === "kids" ? "Register my child" : "Register"}
          </Button>
          {resident && club.paymentMethod !== "cash" && paidOpen !== false && (
            <Button variant="ghost" full onClick={() => setPassConfirmOpen(true)} disabled={passLoading} style={{ padding: 12, fontSize: 14, marginBottom: 10 }}>
              {passLoading
                ? "Please wait…"
                : passTotalCents !== null
                  ? `Buy a 10-session pass — ${formatCents(passTotalCents)} (incl. VAT & fee)`
                  : "Buy a 10-session pass"}
            </Button>
          )}
          {/* Resident Experience Polish — this used to also claim "Training
              year-round" and "Garda-vetted, qualified coaches" unconditionally
              for every club, regardless of whether either was actually true —
              a specific safety/trust credential with no backing data field.
              Removed rather than replaced: every other real fact this club
              has (ages, trial availability, capacity, would-repeat rating)
              is already shown higher on this page — trust claims here must
              stay data-backed, not filled with a repeat of the same facts. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 16, fontSize: 14, color: colors.muted }}>
            {club.phone && (
              <div style={{ display: "flex", gap: 10 }}>
                <a href={`tel:${club.phone}`} className="link-accent" style={{ color: colors.muted }}>
                  {club.phone}
                </a>
              </div>
            )}
          </div>
        </div>
        {/* Where sits in the booking column (owner, 2026-10-22). */}
        <div style={{ marginTop: 24 }}>
          {club.lat !== null && club.lng !== null && (
            <DetailSection title="Location">
              <LocationBlock
                name={club.name}
                area={[club.area, club.county].filter(Boolean).join(", ") || null}
                note={club.locationSource !== "confirmed" ? "Approximate area — not an exact address" : null}
                // A fabricated area pin is never handed to a navigation app as an address.
                directionsUrl={club.locationSource === "confirmed" ? `https://www.google.com/maps/search/?api=1&query=${club.lat},${club.lng}` : null}
                map={{ lat: club.lat, lng: club.lng, label: club.name }}
              />
            </DetailSection>
          )}
        </div>
        </div>
        </div>
      </section>
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "0 24px 80px" }}>
        <ClaimListingCTA listingType="club" listingId={club.id} claimed={club.claimed} />
      </section>
      <CtaBand
        id="club-cta-title"
        panel={{ title: "Looking for another club?", text: "Browse clubs and groups near you.", icon: <UsersLucide size={20} strokeWidth={2} /> }}
        label="Join a club."
        lines={["Find", "your", "club."]}
        text="Sports clubs and groups for kids and adults across Ireland, all in one place."
        action={{ label: "Browse clubs", to: "/browse/clubs" }}
      />
    </div>

    <div className="mobile-join-bar">
      <div>
        <div style={{ fontWeight: 800, fontSize: 15, fontFamily: fonts.display }}>{club.name}</div>
        <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{priceLabel(club)}</div>
      </div>
      <Button variant="orange" style={{ flex: "none" }} onClick={() => navigate(`/register/${club.id}`)}>{club.audience === "kids" ? "Register my child" : "Register"}</Button>
    </div>

    <ConfirmDialog
      open={passConfirmOpen}
      title="Buy this pass?"
      message={`10 sessions at ${club.name}${passTotalCents !== null ? ` for ${formatCents(passTotalCents)} (incl. VAT & fee)` : ""} — you'll be taken to secure checkout.`}
      confirmLabel="Continue to payment"
      cancelLabel="Not now"
      tone="neutral"
      busy={passLoading}
      onConfirm={() => {
        setPassConfirmOpen(false);
        handleBuyPass();
      }}
      onCancel={() => setPassConfirmOpen(false)}
    />
    </>
  );
}
