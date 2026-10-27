import { useEffect, useState } from "react";
import { checkReviewEligibility, fetchReviews, submitReport, submitReview, type ReviewListingType } from "../api";
import { colors, fonts } from "../theme";
import type { Review } from "../types";
import { CheckCircleIcon } from "./icons";
import { Avatar, Button, Card, ConfirmDialog, LoadErrorState, StarDisplay, StarPicker, inputStyle } from "./ui";

const REPORT_REASONS = ["Spam or fake", "Inappropriate content", "Harassment or abuse", "Other"];

interface Props {
  listingType: ReviewListingType;
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
  const [reviewsFailed, setReviewsFailed] = useState(false);
  // null = still checking; "unknown" = the check itself failed — not the same
  // as "not eligible", so it gets its own message and a retry. The server
  // still enforces eligibility when a review is posted.
  const [eligible, setEligible] = useState<boolean | "unknown" | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [reviewName, setReviewName] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSent, setReviewSent] = useState(false);

  const [reportTarget, setReportTarget] = useState<Review | null>(null);
  const [reportReason, setReportReason] = useState(REPORT_REASONS[0]);
  const [reportDetail, setReportDetail] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportedIds, setReportedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    setReviewsFailed(false);
    fetchReviews(listingType, listingId)
      .then(setReviews)
      .catch(() => setReviewsFailed(true));
    setEligible(null);
    checkReviewEligibility(listingType, listingId)
      .then((r) => setEligible(r.eligible))
      .catch(() => setEligible("unknown"));
  }, [listingType, listingId, loadAttempt]);
  const retry = () => setLoadAttempt((n) => n + 1);

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

  const openReport = (r: Review) => {
    setReportTarget(r);
    setReportReason(REPORT_REASONS[0]);
    setReportDetail("");
  };

  const submitTheReport = async () => {
    if (!reportTarget) return;
    setReportSubmitting(true);
    try {
      const reason = reportDetail.trim() ? `${reportReason}: ${reportDetail.trim()}` : reportReason;
      await submitReport("review", String(reportTarget.id), reason);
      setReportedIds((s) => new Set(s).add(reportTarget.id));
      setReportTarget(null);
    } catch {
      // Best-effort — leave the dialog open so the guest can retry.
    } finally {
      setReportSubmitting(false);
    }
  };

  return (
    // Detail-page redesign — same section style as the other detail sections
    // (heading over a full-width rule), using the full main column.
    <div>
      <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 24 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18, margin: 0, letterSpacing: 0 }}>Reviews</h2>
          {reviews.length > 0 && <span style={{ color: colors.mutedLight, fontSize: 14 }}>{reviews.length}</span>}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        {reviewsFailed ? (
          <LoadErrorState title="Couldn't load reviews." onRetry={retry} />
        ) : (
          // Detail-page redesign — an empty list is one line, not a full empty-state card.
          reviews.length === 0 && <p style={{ margin: 0, fontSize: 14, color: colors.mutedLight }}>No reviews yet.</p>
        )}
        {reviews.map((r) => (
          <Card key={r.id} hover style={{ padding: "14px 16px", display: "flex", gap: 12 }}>
            <Avatar name={r.name} size={34} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{r.name}</span>
                <span style={{ color: colors.faint, fontSize: 12, whiteSpace: "nowrap" }}>{timeAgo(r.createdAt)}</span>
              </div>
              <StarDisplay rating={r.rating} />
              {r.comment && <p style={{ fontSize: 14, color: colors.textSoft, margin: "6px 0 0", lineHeight: 1.5 }}>{r.comment}</p>}
              {r.vendorReply && (
                <div style={{ marginTop: 10, background: colors.bg, borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: colors.mutedLight, marginBottom: 3 }}>
                    {listingType === "host"
                      ? "RESPONSE FROM THE HOST"
                      : listingType === "centre"
                        ? "RESPONSE FROM THE VENUE"
                        : listingType === "club"
                          ? "RESPONSE FROM THE CLUB"
                          : "RESPONSE FROM THE ORGANISER"}
                  </div>
                  <div style={{ fontSize: 13.5, color: colors.textSoft }}>{r.vendorReply}</div>
                </div>
              )}
              <div style={{ marginTop: 8, textAlign: "right" }}>
                {reportedIds.has(r.id) ? (
                  <span style={{ fontSize: 11.5, color: colors.faint }}>Reported</span>
                ) : (
                  <button
                    className="tap-target"
                    onClick={() => openReport(r)}
                    style={{ background: "none", border: "none", padding: 0, fontSize: 11.5, color: colors.faint, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    Report
                  </button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {eligible === false && !reviewSent && (
        <div>
          <p style={{ fontSize: 13, color: colors.mutedLight, margin: 0, lineHeight: 1.5 }}>
            {listingType === "centre" && "Only guests who've booked here can leave a review — book a room first, then come back to share how it went."}
            {listingType === "club" && "Only guests who've registered here can leave a review — register your child first, then come back to share how it went."}
            {listingType === "game" && "Only people who went to this activity can review it."}
            {listingType === "host" && "Only people who've been to one of this host's activities can review them."}
            {listingType === "experience" && "Only guests with a past booking can leave a review — book a session first, then come back once it's happened."}
            {listingType === "program" && "Only participants who've attended at least one past session can leave a review — enrol first, then come back once a session has happened."}
          </p>
        </div>
      )}

      {eligible === "unknown" && !reviewSent && (
        <Card style={{ padding: 18, background: colors.bg }}>
          <p role="status" style={{ fontSize: 13, color: colors.mutedLight, margin: 0, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            We couldn't check whether you can review this right now.
            <button type="button" onClick={retry} style={{ background: "none", border: "none", padding: 0, color: colors.greenText, fontWeight: 700, textDecoration: "underline", cursor: "pointer", font: "inherit", fontSize: 13 }}>
              Try again
            </button>
          </p>
        </Card>
      )}

      {eligible === true && !reviewSent && (
        <Card style={{ padding: 20, background: colors.bg }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Leave a review</div>
          <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
            <input aria-label="Your name" required placeholder="Your name" value={reviewName} onChange={(e) => setReviewName(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
            <StarPicker value={rating} onChange={setRating} />
          </div>
          <textarea
            aria-label="Your review (optional)"
            placeholder="What was it like?"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "vertical", marginBottom: 12 }}
          />
          {reviewError && <p role="alert" className="pop-in" style={{ color: colors.danger, fontSize: 13, margin: "0 0 12px", background: colors.dangerBg, padding: "8px 11px", borderRadius: 9 }}>{reviewError}</p>}
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

      <ConfirmDialog
        open={!!reportTarget}
        title="Report this review"
        message="Let us know what's wrong with it — a moderator will take a look."
        confirmLabel="Submit report"
        tone="neutral"
        busy={reportSubmitting}
        onConfirm={submitTheReport}
        onCancel={() => setReportTarget(null)}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {REPORT_REASONS.map((reason) => (
            <button
              key={reason}
              onClick={() => setReportReason(reason)}
              style={{
                border: `1px solid ${reason === reportReason ? colors.text : colors.border}`,
                background: reason === reportReason ? colors.text : "transparent",
                color: reason === reportReason ? colors.surface : colors.muted,
                borderRadius: 999,
                padding: "6px 12px",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {reason}
            </button>
          ))}
        </div>
        <textarea
          placeholder="Anything else the moderator should know? (optional)"
          value={reportDetail}
          onChange={(e) => setReportDetail(e.target.value)}
          rows={2}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </ConfirmDialog>
    </div>
  );
}
