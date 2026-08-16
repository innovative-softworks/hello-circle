import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { addFavourite, createPassCheckout, fetchClub, fetchFavourites, removeFavourite } from "../api";
import { ClaimListingCTA } from "../components/ClaimListingCTA";
import { PhotoGallery } from "../components/PhotoGallery";
import { Reviews } from "../components/Reviews";
import { priceLabel } from "../priceLabel";
import { CheckIcon, ChevronLeftIcon, ClockIcon, HeartIcon, PinIcon, StarIcon } from "../components/icons";
import { ListingDetailSkeleton } from "../components/ui";
import { isFavorite, toggleFavorite } from "../favorites";
import { useGuest } from "../GuestContext";
import { colors, fonts, maxWidth } from "../theme";
import type { Club } from "../types";

export function ClubDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [club, setClub] = useState<Club | null>(null);
  const [favourited, setFavourited] = useState(false);
  const [passLoading, setPassLoading] = useState(false);

  useEffect(() => {
    if (id) fetchClub(id).then(setClub);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    if (resident) fetchFavourites().then((rows) => setFavourited(rows.some((r) => r.listingType === "club" && r.listingId === id)));
    else setFavourited(isFavorite("club", id));
  }, [id, resident]);

  const handleToggleFavourite = async () => {
    if (!id) return;
    if (resident) {
      if (favourited) await removeFavourite("club", id);
      else await addFavourite("club", id);
      setFavourited((f) => !f);
    } else {
      setFavourited(toggleFavorite("club", id));
    }
  };

  // Credit-pack pass purchase (NEXT) — a simple fixed 10-credit pack;
  // a real product would let the vendor configure pack size/pricing.
  const handleBuyPass = async () => {
    if (!id) return;
    setPassLoading(true);
    try {
      const res = await createPassCheckout({ listingId: id, creditsTotal: 10 });
      if (res.url) window.location.href = res.url;
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't start checkout");
    } finally {
      setPassLoading(false);
    }
  };

  const reloadRating = () => {
    if (id) fetchClub(id).then(setClub);
  };

  if (!club) return <ListingDetailSkeleton />;

  return (
    <div style={{ animation: "fadeUp .35s ease both" }}>
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "26px 24px 0" }}>
        <button
          onClick={() => navigate("/browse/clubs")}
          style={{ display: "inline-flex", alignItems: "center", background: "none", border: "none", color: colors.muted, fontWeight: 600, fontSize: 14, cursor: "pointer", padding: 0, marginBottom: 16 }}
        >
          <ChevronLeftIcon size={14} style={{ marginRight: 4 }} /> All sports clubs
        </button>
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
          <p style={{ fontSize: 16, lineHeight: 1.6, color: "#3B423C", margin: "0 0 28px" }}>{club.blurb}</p>
          <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: "0 0 12px", letterSpacing: "-.01em" }}>
            What's included
          </h3>
          <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", marginBottom: 20 }}>
            {club.includes.map((a) => (
              <div key={a} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: "#3B423C" }}>
                <CheckIcon size={16} style={{ color: colors.orange }} />
                {a}
              </div>
            ))}
          </div>
        </div>
        <div
          className="sticky-aside"
          style={{ position: "sticky", top: 90, background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 18, padding: 22, boxShadow: "0 8px 30px rgba(30,40,32,.05)" }}
        >
          <div style={{ fontSize: 14, color: colors.mutedLight, marginBottom: 4 }}>Membership</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28 }}>{priceLabel(club)}</div>
            {club.paymentMethod === "cash" && (
              <span style={{ fontSize: 11, fontWeight: 700, color: colors.orangeDark, background: colors.orangeBg, borderRadius: 999, padding: "2px 8px" }}>
                Cash on arrival
              </span>
            )}
          </div>
          <button
            onClick={() => navigate(`/register/${club.id}`)}
            style={{ width: "100%", background: colors.orange, color: "#fff", border: "none", borderRadius: 12, padding: 14, fontSize: 15, fontWeight: 700, cursor: "pointer", marginBottom: 10 }}
          >
            Register my child
          </button>
          {resident && club.paymentMethod !== "cash" && (
            <button
              onClick={handleBuyPass}
              disabled={passLoading}
              style={{ width: "100%", background: "#fff", color: colors.orangeDark, border: `1px solid ${colors.orange}`, borderRadius: 12, padding: 12, fontSize: 14, fontWeight: 700, cursor: "pointer", marginBottom: 10 }}
            >
              {passLoading ? "Please wait…" : `Buy a 10-session pass — €${(club.price * 10).toFixed(0)}`}
            </button>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 16, fontSize: 14, color: colors.muted }}>
            <div style={{ display: "flex", gap: 10 }}>
              <ClockIcon size={16} style={{ color: colors.orange }} /> Training year-round
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <CheckIcon size={16} style={{ color: colors.orange }} /> Garda-vetted, qualified coaches
            </div>
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
  );
}
