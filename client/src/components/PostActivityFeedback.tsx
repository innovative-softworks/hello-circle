import { useEffect, useState } from "react";
import { fetchFeedbackStatus, fetchMyFollows, submitFeedback } from "../api";
import { FollowButton } from "./FollowButton";
import { StarIcon } from "./icons";
import { NextStepsPanel } from "./NextStepsPanel";
import { colors, fonts, radius } from "../theme";
import type { FeedbackStatus, FollowedType } from "../api";
import type { NextStepsKind } from "../types";

// "How was it?" (community participation upgrade, Release 3) — deliberately
// short: an optional star rating, a few optional tags, an optional comment,
// and the one required answer, "Would you do something like this again?",
// which submits. Private to the host/platform (public reviews stay the
// separate Reviews component). Then — not "back to Home" — the next steps:
// the Circle, the next session, or starting a Circle (NextStepsPanel).
// Callers only render this once taking part is known or plausible (see
// participation.ts's feedback gating); the server also refuses a no-show.

const TAGS: { key: string; label: string }[] = [
  { key: "great_host", label: "Great host" },
  { key: "met_new_people", label: "Met new people" },
  { key: "well_organised", label: "Well organised" },
  { key: "beginner_friendly", label: "Beginner friendly" },
  { key: "great_location", label: "Great location" },
];

const ANSWERS = [
  { value: "yes", label: "Yes" },
  { value: "maybe", label: "Maybe" },
  { value: "no", label: "No" },
] as const;

/** Optional "keep up with them?" nudge — only shown once the resident says
 * they'd do this again (the relationship should form after a real
 * interaction, never during onboarding or unconditionally). `id` must
 * already be followable (a vendor account, or a resident with a verified
 * host badge) — callers only pass this when that's already known true. */
export interface FollowTarget {
  type: FollowedType;
  id: string;
}

const chip = (active: boolean) => ({
  border: `1px solid ${active ? colors.green : colors.border}`,
  background: active ? colors.greenBg : colors.surface,
  color: active ? colors.greenText : colors.text,
  borderRadius: radius.pill,
  padding: "5px 11px",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
});

export function PostActivityFeedback({ kind, reference, followTarget }: { kind: NextStepsKind; reference: string; followTarget?: FollowTarget }) {
  const [status, setStatus] = useState<FeedbackStatus | "loading">("loading");
  const [rating, setRating] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [alreadyFollowing, setAlreadyFollowing] = useState<boolean | null>(null);

  useEffect(() => {
    fetchFeedbackStatus(kind, reference)
      .then(setStatus)
      .catch(() => setStatus({ response: null, beginnerFriendly: null, soloFriendly: null, descriptionAccurate: null, welcoming: null }));
  }, [kind, reference]);

  if (status === "loading") return null;

  const answer = async (response: "yes" | "maybe" | "no") => {
    setSubmitting(true);
    setError(null);
    try {
      await submitFeedback(kind, reference, { response, rating: rating ?? undefined, tags, comment: comment.trim() || undefined });
      setStatus({ ...status, response, rating, tags, comment });
      if (response === "yes" && followTarget) {
        fetchMyFollows()
          .then((follows) => setAlreadyFollowing(follows.some((f) => f.followedType === followTarget.type && f.followedId === followTarget.id)))
          .catch(() => setAlreadyFollowing(null));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that");
    } finally {
      setSubmitting(false);
    }
  };

  if (status.response || skipped) {
    return (
      <div>
        {status.response && (
          <>
            <div style={{ fontSize: 13, color: colors.greenText, fontWeight: 700 }}>Thanks — that helps the host and the next person deciding.</div>
            {status.response === "yes" && followTarget && alreadyFollowing === false && (
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, color: colors.muted }}>Want to know when they start something new?</span>
                <FollowButton followedType={followTarget.type} followedId={followTarget.id} initialFollowing={false} />
              </div>
            )}
          </>
        )}
        <NextStepsPanel kind={kind} reference={reference} />
      </div>
    );
  }

  const shown = hover ?? rating ?? 0;

  return (
    <div style={{ fontSize: 13, color: colors.muted }}>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, color: colors.text, margin: "0 0 8px" }}>How was it?</h3>

      <div role="radiogroup" aria-label="Rating" style={{ display: "flex", gap: 4, marginBottom: 12 }} onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onClick={() => setRating(rating === n ? null : n)}
            onMouseEnter={() => setHover(n)}
            style={{ background: "none", border: "none", padding: 2, cursor: "pointer", color: n <= shown ? colors.gold : colors.borderStrong }}
          >
            <StarIcon size={26} filled={n <= shown} />
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {TAGS.map((t) => {
          const on = tags.includes(t.key);
          return (
            <button key={t.key} type="button" aria-pressed={on} onClick={() => setTags(on ? tags.filter((k) => k !== t.key) : [...tags, t.key])} style={chip(on)}>
              {t.label}
            </button>
          );
        })}
      </div>

      {commenting ? (
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="Anything the host should know? (optional, only they see it)"
          style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: "8px 10px", fontSize: 13.5, fontFamily: "inherit", resize: "vertical", marginBottom: 10 }}
        />
      ) : (
        <button type="button" onClick={() => setCommenting(true)} style={{ background: "none", border: "none", padding: 0, marginBottom: 12, fontSize: 12.5, color: colors.muted, textDecoration: "underline", cursor: "pointer" }}>
          Add a comment
        </button>
      )}

      <div style={{ fontWeight: 700, color: colors.text, marginBottom: 8 }}>Would you do something like this again?</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {ANSWERS.map((a) => (
          <button
            key={a.value}
            type="button"
            disabled={submitting}
            onClick={() => answer(a.value)}
            style={{ ...chip(false), padding: "7px 16px", fontSize: 13.5, fontWeight: 700 }}
          >
            {a.label}
          </button>
        ))}
        <button type="button" onClick={() => setSkipped(true)} style={{ background: "none", border: "none", padding: 0, marginLeft: 4, fontSize: 12.5, color: colors.faint, cursor: "pointer" }}>
          Skip
        </button>
      </div>
      {error && <div style={{ fontSize: 12.5, color: colors.danger, marginTop: 8 }}>{error}</div>}
    </div>
  );
}
