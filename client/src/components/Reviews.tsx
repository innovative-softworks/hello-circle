import { useEffect, useId, useState } from "react";
import { FollowButton } from "./FollowButton";
import { Link } from "react-router-dom";
import { Star } from "lucide-react";
import {
  checkReviewEligibility,
  deleteMyReview,
  fetchReviewSummary,
  fetchReviews,
  submitReport,
  submitReview,
  updateMyReview,
  type ReviewEligibility,
  type ReviewListingType,
  type ReviewTag,
} from "../api";
import type { Review, ReviewSummary as Summary } from "../types";
import { Button, ConfirmDialog, LoadErrorState, Modal, Skeleton, StarDisplay } from "./ui";
import "./trust/trust.css";

// Public reviews (Trust & Retention batch 1, docs/trust-retention/).
//
// Shows the live average, count and rating distribution (no stored or
// composite score), each review's date and — only while an authorised
// organiser's record confirms this reviewer attended — "Verified attendance".
// Older reviews show no label. Negative reviews stay visible.
// Eligibility is decided by the server per visit; the form only offers visits
// the server says are open. Authors can edit or delete their own review.

const TAGS: { key: ReviewTag; label: string }[] = [
  { key: "welcoming_host", label: "Welcoming host" },
  { key: "good_organisation", label: "Good organisation" },
  { key: "accurate_description", label: "Accurate description" },
  { key: "good_value", label: "Good value" },
];
const TAG_LABEL = Object.fromEntries(TAGS.map((t) => [t.key, t.label])) as Record<string, string>;
const REPORT_REASONS = ["Spam or fake", "Inappropriate content", "Harassment or abuse", "Personal information", "Other"];

const DATE = new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });
const fmt = (iso: string | null | undefined) => (iso ? DATE.format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso)) : "");

const REPLY_LABEL: Record<ReviewListingType, string> = {
  host: "Reply from the host",
  game: "Reply from the host",
  centre: "Reply from the venue",
  club: "Reply from the club",
  experience: "Reply from the organiser",
  program: "Reply from the organiser",
};

const BASIS: Record<string, { label: string; detail: string }> = {
  person: { label: "Verified attendance", detail: "The organiser confirmed this reviewer attended." },
};

interface Props {
  listingType: ReviewListingType;
  listingId: string;
  /** Kept for existing call sites; the editorial style no longer varies by accent. */
  accent?: "green" | "orange";
  onReviewPosted?: () => void;
  /** Heading level text; defaults to "Reviews". */
  title?: string;
  /** After a review is posted, offer to follow the host/organiser (never yourself — the server refuses that too). */
  followAfter?: { type: "host" | "vendor" | "centre"; id: string; name: string | null };
}

export function Reviews({ listingType, listingId, onReviewPosted, title = "Reviews", followAfter }: Props) {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  const [eligibility, setEligibility] = useState<ReviewEligibility | "unknown" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<Review | null>(null);
  const [deleting, setDeleting] = useState<Review | null>(null);
  const [reporting, setReporting] = useState<Review | null>(null);
  const [reported, setReported] = useState<Record<number, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);

  useEffect(() => {
    setFailed(false);
    Promise.all([fetchReviews(listingType, listingId), fetchReviewSummary(listingType, listingId)])
      .then(([r, s]) => {
        setReviews(r);
        setSummary(s);
      })
      .catch(() => setFailed(true));
    setEligibility(null);
    checkReviewEligibility(listingType, listingId)
      .then(setEligibility)
      .catch(() => setEligibility("unknown"));
  }, [listingType, listingId, attempt]);
  const reload = () => setAttempt((n) => n + 1);

  const remove = async () => {
    if (!deleting) return;
    await deleteMyReview(deleting.id);
    setDeleting(null);
    setNotice("Your review has been deleted.");
    reload();
  };

  return (
    <section id="reviews" className="tr-section" aria-labelledby={`reviews-${listingType}`} style={{ scrollMarginTop: 24 }}>
      <h2 id={`reviews-${listingType}`}>{title}</h2>
      <div aria-live="polite">{notice && <p className="tr-ok" style={{ marginBottom: 12 }}>{notice}</p>}</div>
      {posted && followAfter && (
        <div className="tr-actions" style={{ marginBottom: 16, alignItems: "center" }}>
          <span className="tr-note">Want to hear when {followAfter.name ?? "they"} {followAfter.type === "host" ? "hosts" : "runs"} something next?</span>
          <FollowButton followedType={followAfter.type} followedId={followAfter.id} initialFollowing={false} />
        </div>
      )}

      {failed ? (
        <LoadErrorState title="Couldn't load reviews." onRetry={reload} />
      ) : !reviews || !summary ? (
        <Skeleton height={96} />
      ) : summary.count === 0 ? (
        <p className="tr-note" style={{ marginBottom: 8 }}>
          No reviews yet. Reviews come only from people the organiser has confirmed attended.
        </p>
      ) : (
        <>
          <RatingSummary summary={summary} />
          <ul className="tr-reviews">
            {reviews.map((r) => (
              <li key={r.id} className="tr-review">
                <div className="tr-review-head">
                  <span className="tr-review-name">{r.name}</span>
                  <StarDisplay rating={r.rating} />
                  <span className="sr-only">{r.rating} out of 5</span>
                  {r.attendanceBasis && BASIS[r.attendanceBasis] && (
                    <span className="tr-review-basis" title={BASIS[r.attendanceBasis].detail}>
                      {BASIS[r.attendanceBasis].label}
                    </span>
                  )}
                </div>
                <div className="tr-review-meta">
                  Reviewed {fmt(r.createdAt)}
                  {r.updatedAt ? ` · edited ${fmt(r.updatedAt)}` : ""}
                  {r.occurrenceDate ? ` · visited ${fmt(r.occurrenceDate)}` : ""}
                </div>
                {r.attendanceBasis && BASIS[r.attendanceBasis] && <span className="sr-only">{BASIS[r.attendanceBasis].detail}</span>}
                {r.comment && <p>{r.comment}</p>}
                {!!r.tags?.length && (
                  <div className="tr-tags">
                    {r.tags.map((t) => (
                      <span key={t} className="tr-tag">
                        {TAG_LABEL[t] ?? t}
                      </span>
                    ))}
                  </div>
                )}
                {r.vendorReply && (
                  <div className="tr-reply">
                    <div className="tr-reply-label">{REPLY_LABEL[listingType]}</div>
                    <p style={{ marginTop: 4 }}>{r.vendorReply}</p>
                  </div>
                )}
                <div className="tr-actions">
                  {r.mine ? (
                    <>
                      {/* Only a review whose visit is still confirmed can be edited (server rule). */}
                      {r.attendanceBasis === "person" && (
                        <button type="button" className="tr-link" onClick={() => setEditing(r)}>
                          Edit your review
                        </button>
                      )}
                      <button type="button" className="tr-link" onClick={() => setDeleting(r)}>
                        Delete
                      </button>
                    </>
                  ) : reported[r.id] ? (
                    <span className="tr-review-meta">Reported · case {reported[r.id]}</span>
                  ) : (
                    <button type="button" className="tr-link" onClick={() => setReporting(r)}>
                      Report review
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <WriteReview
        listingType={listingType}
        listingId={listingId}
        eligibility={eligibility}
        onRetry={reload}
        onPosted={() => {
          setNotice("Thanks — your review is live.");
          setPosted(true);
          reload();
          onReviewPosted?.();
        }}
      />

      {editing && (
        <EditReview
          review={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNotice("Your review has been updated.");
            reload();
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete your review?"
        message="It disappears from this page straight away. You can write a new one for this visit afterwards."
        confirmLabel="Delete review"
        tone="danger"
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
      {reporting && (
        <ReportReview
          review={reporting}
          onClose={() => setReporting(null)}
          onDone={(ref) => {
            setReported((m) => ({ ...m, [reporting.id]: ref }));
            setReporting(null);
          }}
        />
      )}
    </section>
  );
}

export function RatingSummary({ summary }: { summary: Summary }) {
  const max = Math.max(1, ...summary.distribution);
  return (
    <div className="tr-summary">
      <div>
        <div className="tr-summary-score">{summary.average?.toFixed(1)}</div>
        <div style={{ margin: "8px 0 4px" }}>
          <StarDisplay rating={summary.average ?? 0} size={15} />
        </div>
        <div className="tr-review-meta">
          {summary.count} review{summary.count === 1 ? "" : "s"}
        </div>
      </div>
      <ul className="tr-dist" aria-label="How people rated it">
        {[5, 4, 3, 2, 1].map((stars) => {
          const n = summary.distribution[stars - 1];
          return (
            <li key={stars}>
              <span>
                {stars} star{stars === 1 ? "" : "s"}
              </span>
              <span className="tr-dist-bar" aria-hidden="true">
                <span style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <span>{n}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StarRadios({ value, onChange, name }: { value: number; onChange: (n: number) => void; name: string }) {
  return (
    <div className="tr-stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className="tr-star">
          <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} aria-label={`${n} star${n === 1 ? "" : "s"}`} />
          <span className={n <= value ? "is-on" : ""} aria-hidden="true">
            <Star size={24} fill={n <= value ? "currentColor" : "none"} strokeWidth={1.8} />
          </span>
        </label>
      ))}
    </div>
  );
}

function TagPicker({ value, onChange }: { value: ReviewTag[]; onChange: (t: ReviewTag[]) => void }) {
  return (
    <div className="tr-tags" style={{ marginTop: 0 }}>
      {TAGS.map((t) => (
        <label key={t.key} className="tr-tag-pick">
          <input type="checkbox" checked={value.includes(t.key)} onChange={(e) => onChange(e.target.checked ? [...value, t.key] : value.filter((x) => x !== t.key))} />
          <span>{t.label}</span>
        </label>
      ))}
    </div>
  );
}

function WriteReview({
  listingType,
  listingId,
  eligibility,
  onRetry,
  onPosted,
}: {
  listingType: ReviewListingType;
  listingId: string;
  eligibility: ReviewEligibility | "unknown" | null;
  onRetry: () => void;
  onPosted: () => void;
}) {
  const uid = useId();
  const open = eligibility && eligibility !== "unknown" ? (eligibility.occurrences ?? []).filter((o) => !o.reviewed) : [];
  const [occurrence, setOccurrence] = useState<string>("");
  const [name, setName] = useState("");
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<ReviewTag[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (eligibility === null) return null;
  if (eligibility === "unknown") {
    return (
      <p className="tr-note" role="status" style={{ marginTop: 12 }}>
        We couldn't check whether you can review this.{" "}
        <button type="button" className="tr-link" onClick={onRetry}>
          Try again
        </button>
      </p>
    );
  }
  if (!eligibility.eligible) {
    if (eligibility.reason === "own" || eligibility.reason === "already_reviewed") return null;
    return (
      <p className="tr-note" style={{ marginTop: 12 }}>
        {eligibility.message}{" "}
        {(eligibility.reason === "not_confirmed" || eligibility.reason === "no_attendance") && (
          <>
            {eligibility.reason === "not_confirmed" ? "" : "Went, but it isn't recorded? "}Open the booking in <Link to="/bookings">My bookings</Link> and ask the organiser to confirm you attended.
          </>
        )}
      </p>
    );
  }

  const chosen = open.find((o) => o.ref === occurrence) ?? open[0];
  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError("Add the name to show with your review.");
    if (!rating) return setError("Choose a star rating.");
    setBusy(true);
    try {
      await submitReview({ listingType, listingId, name: name.trim(), rating, comment: comment.trim(), tags, occurrenceRef: chosen?.ref });
      setName("");
      setRating(0);
      setTags([]);
      setComment("");
      onPosted();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Couldn't post your review. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="tr-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      aria-labelledby={`${uid}-title`}
    >
      <div>
        <h3 id={`${uid}-title`} style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
          Leave a review
        </h3>
        {chosen && (
          <p className="tr-note" style={{ marginTop: 4 }}>
            The organiser confirmed you attended, so your review shows “Verified attendance”.
          </p>
        )}
      </div>
      {open.length > 1 && (
        <div>
          <label className="tr-label" htmlFor={`${uid}-visit`}>
            Which visit?
          </label>
          <select id={`${uid}-visit`} className="tr-input" value={chosen?.ref ?? ""} onChange={(e) => setOccurrence(e.target.value)}>
            {open.map((o) => (
              <option key={o.ref} value={o.ref}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <fieldset>
        <legend>
          Your rating <span aria-hidden="true">*</span>
        </legend>
        <StarRadios value={rating} onChange={setRating} name={`${uid}-stars`} />
      </fieldset>
      <div>
        <label className="tr-label" htmlFor={`${uid}-name`}>
          Name to show <span aria-hidden="true">*</span>
        </label>
        <input id={`${uid}-name`} className="tr-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="given-name" required aria-required="true" />
      </div>
      <fieldset>
        <legend>
          What stood out? <span className="tr-muted" style={{ fontWeight: 400 }}>(optional)</span>
        </legend>
        <TagPicker value={tags} onChange={setTags} />
      </fieldset>
      <div>
        <label className="tr-label" htmlFor={`${uid}-comment`}>
          Your review <span className="tr-muted" style={{ fontWeight: 400 }}>(optional)</span>
        </label>
        <textarea id={`${uid}-comment`} className="tr-input" rows={4} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
        <p className="tr-note" style={{ marginTop: 6 }}>
          Please don't include anyone's contact details or private information.
        </p>
      </div>
      <div aria-live="assertive">{error && <p className="tr-alert">{error}</p>}</div>
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? "Posting…" : "Post review"}
        </Button>
      </div>
    </form>
  );
}

function EditReview({ review, onClose, onSaved }: { review: Review; onClose: () => void; onSaved: () => void }) {
  const uid = useId();
  const [rating, setRating] = useState(review.rating);
  const [tags, setTags] = useState<ReviewTag[]>((review.tags ?? []) as ReviewTag[]);
  const [comment, setComment] = useState(review.comment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateMyReview(review.id, { rating, tags, comment: comment.trim() });
      onSaved();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit your review"
      footer={
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      }
    >
      <div className="tr-form" style={{ borderTop: "none", paddingTop: 0, marginTop: 0 }}>
        <fieldset>
          <legend>Your rating</legend>
          <StarRadios value={rating} onChange={setRating} name={`${uid}-stars`} />
        </fieldset>
        <fieldset>
          <legend>What stood out?</legend>
          <TagPicker value={tags} onChange={setTags} />
        </fieldset>
        <div>
          <label className="tr-label" htmlFor={`${uid}-comment`}>
            Your review
          </label>
          <textarea id={`${uid}-comment`} className="tr-input" rows={5} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        <div aria-live="assertive">{error && <p className="tr-alert">{error}</p>}</div>
      </div>
    </Modal>
  );
}

function ReportReview({ review, onClose, onDone }: { review: Review; onClose: () => void; onDone: (caseRef: string) => void }) {
  const uid = useId();
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await submitReport("review", String(review.id), detail.trim() ? `${reason}: ${detail.trim()}` : reason);
      onDone(r.caseRef ?? "sent");
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Couldn't send the report. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Report this review"
      subtitle="A moderator reads every report. The reviewer and the organiser aren't told who reported it."
      footer={
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={send} disabled={busy}>
            {busy ? "Sending…" : "Send report"}
          </Button>
        </div>
      }
    >
      <div className="tr-form" style={{ borderTop: "none", paddingTop: 0, marginTop: 0 }}>
        <fieldset>
          <legend>What's wrong with it?</legend>
          {REPORT_REASONS.map((r) => (
            <label key={r} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", cursor: "pointer" }}>
              <input type="radio" name={`${uid}-reason`} checked={reason === r} onChange={() => setReason(r)} /> {r}
            </label>
          ))}
        </fieldset>
        <p className="tr-note">Disagreeing with an honest review isn't a reason to remove it — reply to it instead if it's about you.</p>
        <div>
          <label className="tr-label" htmlFor={`${uid}-detail`}>
            More detail <span className="tr-muted" style={{ fontWeight: 400 }}>(optional)</span>
          </label>
          <textarea id={`${uid}-detail`} className="tr-input" rows={3} maxLength={1500} value={detail} onChange={(e) => setDetail(e.target.value)} />
        </div>
        <div aria-live="assertive">{error && <p className="tr-alert">{error}</p>}</div>
      </div>
    </Modal>
  );
}
