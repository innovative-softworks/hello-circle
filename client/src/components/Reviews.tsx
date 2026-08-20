import { useEffect, useState } from "react";
import { checkReviewEligibility, fetchReviews, submitReview } from "../api";
import { colors, fonts } from "../theme";
import type { Review } from "../types";
import { CheckCircleIcon, StarIcon } from "./icons";
import { Avatar, Button, Card, EmptyState, StarDisplay, StarPicker, inputStyle } from "./ui";

interface Props {
  listingType: "centre" | "club";
  listingId: string;
  accent: "green" | "orange";
  onReviewPosted?: () => void;
}

// `iso` is already a full ISO 8601 UTC timestamp (e.g. "2026-08-11T05:09:35.000Z")
// as returned by the server — no further timezone massaging needed to get an
// absolute instant out of it; only display formatting needs a timezone.
function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IE", { month: "short", year: "numeric", timeZone: "Europe/Dublin" });
}

export function Reviews({ listingType, listingId, accent, onReviewPosted }: Props) {
  const accentVariant = accent === "green" ? "primary" : "orange";

  const [reviews, setReviews] = useState<Review[]>([]);
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [reviewName, setReviewName] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSent, setReviewSent] = useState(false);

  useEffect(() => {
    fetchReviews(listingType, listingId).then(setReviews);
    checkReviewEligibility(listingType, listingId)
      .then((r) => setEligible(r.eligible))
      .catch(() => setEligible(false));
  }, [listingType, listingId]);

  const submitTheReview = async () => {
    if (!reviewName || !rating) return;
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      const review = await submitReview({ listingType, listingId, name: reviewName, rating, comment });
      setReviews((r) => [review, ...r]);
      setReviewName("");
      setComment("");
      setRating(5);
      setReviewSent(true);
      onReviewPosted?.();
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : "Couldn't submit your review");
    } finally {
      setReviewSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 36, marginTop: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 25, margin: 0, letterSpacing: "-.015em" }}>Reviews</h2>
          {reviews.length > 0 && <span style={{ color: colors.faint, fontSize: 14 }}>{reviews.length}</span>}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
        {reviews.length === 0 && <EmptyState icon={<StarIcon size={26} />} title="No reviews yet" subtitle="Be the first to share how it went." />}
        {reviews.map((r) => (
          <Card key={r.id} hover style={{ padding: "14px 16px", display: "flex", gap: 12 }}>
            <Avatar name={r.name} size={34} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{r.name}</span>
                <span style={{ color: colors.faint, fontSize: 12, whiteSpace: "nowrap" }}>{timeAgo(r.createdAt)}</span>
              </div>
              <StarDisplay rating={r.rating} />
              {r.comment && <p style={{ fontSize: 14, color: "#3B423C", margin: "6px 0 0", lineHeight: 1.5 }}>{r.comment}</p>}
            </div>
          </Card>
        ))}
      </div>

      {eligible === false && !reviewSent && (
        <Card style={{ padding: 18, background: colors.bg }}>
          <p style={{ fontSize: 13, color: colors.mutedLight, margin: 0 }}>
            Only guests who've booked or registered here can leave a review — {listingType === "centre" ? "book a room" : "register your child"} first, then come back to share how it went.
          </p>
        </Card>
      )}

      {eligible && !reviewSent && (
        <Card style={{ padding: 20, background: colors.bg }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Leave a review</div>
          <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
            <input placeholder="Your name" value={reviewName} onChange={(e) => setReviewName(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
            <StarPicker value={rating} onChange={setRating} />
          </div>
          <textarea
            placeholder="What was it like?"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "vertical", marginBottom: 12 }}
          />
          {reviewError && <p className="pop-in" style={{ color: colors.danger, fontSize: 13, margin: "0 0 12px", background: colors.dangerBg, padding: "8px 11px", borderRadius: 9 }}>{reviewError}</p>}
          <Button variant={accentVariant} disabled={reviewSubmitting || !reviewName} onClick={submitTheReview}>
            {reviewSubmitting ? "Posting…" : "Post review"}
          </Button>
        </Card>
      )}

      {reviewSent && (
        <p className="pop-in" style={{ display: "flex", alignItems: "center", gap: 6, color: colors.greenText, fontSize: 13, fontWeight: 600 }}>
          <CheckCircleIcon size={15} /> Thanks — your review is live.
        </p>
      )}
    </div>
  );
}
