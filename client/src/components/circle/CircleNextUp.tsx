import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bookmark } from "lucide-react";
import { fetchCircleFirstTime } from "../../api";
import { dateLabel } from "../../euro";
import type { CircleFirstTimeGuide, CirclePlanPreview } from "../../types";
import { useSavedState } from "../SaveButton";
import { Button } from "../ui";
import { activityIcon, circlePlanLabel, FeaturedPhoto } from "./CircleHomeParts";
import { CompactRow, CompactRows } from "../CompactRow";

// "Next up" as one card (owner, 2026-10-24, design option 1): the soonest
// activity featured, the "what to expect" guide folded into the same card,
// then "Also coming up" as compact rows. The guide only uses what the host
// wrote (Circle Experience 2.0, First-Time Friendly) and only shows when it
// is about the featured activity.

function duration(min: number | null | undefined): string | null {
  if (!min) return null;
  return min >= 60 ? `about ${Math.round(min / 6) / 10} h` : `about ${min} min`;
}

function SaveIcon({ plan }: { plan: CirclePlanPreview }) {
  const [saved, toggle] = useSavedState("game", plan.id);
  return (
    <button type="button" className="ch-btn-icon" aria-pressed={saved} aria-label={saved ? `Saved: ${plan.activityLabel}` : `Save ${plan.activityLabel}`} onClick={toggle}>
      <Bookmark size={17} aria-hidden="true" fill={saved ? "currentColor" : "none"} />
    </button>
  );
}

export function CircleNextUp({
  plans,
  circleId,
  circleImage,
  guideOn,
  firstCircleActivity,
  emptyState,
}: {
  plans: CirclePlanPreview[];
  circleId: string;
  circleImage: string | null;
  /** circles.first_time_friendly and a member viewing. */
  guideOn: boolean;
  firstCircleActivity: boolean | null;
  emptyState: React.ReactNode;
}) {
  const navigate = useNavigate();
  const [guide, setGuide] = useState<CircleFirstTimeGuide | null>(null);
  const [guideOpen, setGuideOpen] = useState<boolean | null>(null);

  useEffect(() => {
    if (!guideOn) return setGuide(null);
    let live = true;
    fetchCircleFirstTime(circleId)
      .then((g) => live && setGuide(g))
      .catch(() => live && setGuide(null));
    return () => {
      live = false;
    };
  }, [circleId, guideOn]);

  if (plans.length === 0) return <>{emptyState}</>;
  const [first, ...rest] = plans;
  const g = guide?.nextActivity && guide.nextActivity.id === first.id ? guide.nextActivity : null;
  // Open by default for a first-timer with one thing to look at; otherwise one line.
  const open = guideOpen ?? (!!firstCircleActivity && rest.length === 0);
  const full = first.spotsLeft <= 0;
  const img = first.imageUrl || circleImage;
  const when = [dateLabel(first.date), first.time, duration(g?.durationMinutes)].filter(Boolean).join(" · ");
  const where = [first.centreName || first.locationText, g?.organiserName ? `organised by ${g.organiserName}` : null].filter(Boolean).join(" · ");
  const facts = g
    ? [
        { label: "Where to meet", value: g.meetingInstructions || g.where || "" },
        { label: "What to bring", value: g.equipmentNeeded ?? "" },
        { label: "Experience", value: g.experienceRequired ?? "" },
        { label: "Accessibility", value: g.accessibilityInfo ?? "" },
        { label: "Good to know", value: `${g.soloFriendly ? "People often come on their own. " : ""}Meet in the open and tell someone where you're going.` },
      ].filter((f) => f.value.trim())
    : [];
  const guideTitle = firstCircleActivity ? "Your first one with this Circle? Here's what to expect" : "What to expect";

  return (
    <article className="nu-card">
      <div className="nu-featured">
        {/* C · Title on the photo (owner 2026-10-27): "Next up", the title and
            the date on a taller photo; the details and Join beside it. */}
        <FeaturedPhoto
          image={img}
          activityLabel={first.activityLabel}
          kicker={first.joinedByMe ? "Next up · You're going" : "Next up"}
          title={first.activityLabel}
          line={when}
          chips={
            first.soloFriendly || first.experienceRequired ? (
              <>
                {first.soloFriendly && <span className="ce-pill ce-pill--green">Come on your own</span>}
                {first.experienceRequired && <span className="ce-pill">{first.experienceRequired}</span>}
              </>
            ) : null
          }
        />
        <div className="nu-info">
          {where && <p className="nu-meta">{where}</p>}
          <p className="nu-meta nu-meta--strong">
            <strong>{first.joined} going</strong> · {full ? "Full" : `${first.spotsLeft} ${first.spotsLeft === 1 ? "place" : "places"} left`}
          </p>
        </div>
        <div className="nu-actions">
          {full || first.joinedByMe ? (
            <button type="button" className="ch-btn-accent" style={{ minWidth: 120 }} onClick={() => navigate(`/games/${first.id}`)}>
              View
            </button>
          ) : (
            <Button onClick={() => navigate(`/games/${first.id}`)} style={{ minWidth: 120 }}>
              Join
            </Button>
          )}
          <SaveIcon plan={first} />
        </div>
      </div>

      {g && facts.length > 0 && (
        <div className="nu-guide">
          {open ? (
            <>
              <div className="nu-guide-head">
                <h3 id="nu-guide-title">{guideTitle}</h3>
                <button type="button" className="cp-link" aria-expanded="true" aria-controls="nu-guide-body" onClick={() => setGuideOpen(false)}>
                  Hide
                </button>
              </div>
              <dl id="nu-guide-body" className="nu-facts">
                {facts.map((f) => (
                  <div key={f.label}>
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
              <button type="button" className="cp-link cp-link--strong" onClick={() => navigate(`/games/${first.id}`)}>
                View activity details →
              </button>
            </>
          ) : (
            <div className="nu-guide-line">
              <p>
                <strong>{firstCircleActivity ? "Your first one with this Circle?" : "Going along?"}</strong> <span>Where to meet, what to bring and what to expect.</span>
              </p>
              <button type="button" className="cp-btn cp-btn--outline" aria-expanded="false" aria-controls="nu-guide-body" onClick={() => setGuideOpen(true)}>
                Show what to expect
              </button>
            </div>
          )}
        </div>
      )}

      {rest.length > 0 && (
        <div className="nu-more">
          <p className="nu-more-title">Also coming up</p>
          <CompactRows>
            {rest.slice(0, 4).map((p) => {
              const pFull = p.spotsLeft <= 0;
              const href = `/games/${p.id}`;
              return (
                <CompactRow
                  key={p.id}
                  href={href}
                  onOpen={() => navigate(href)}
                  image={p.imageUrl || circleImage}
                  fallbackIcon={activityIcon(p.activityLabel, 26)}
                  date={p.date}
                  time={p.time}
                  label={circlePlanLabel(p)}
                  title={p.activityLabel}
                  meta={[p.centreName || p.locationText, `${p.joined} going`, pFull ? "Full" : `${p.spotsLeft} ${p.spotsLeft === 1 ? "place" : "places"} left`].filter(Boolean).join(" · ")}
                  action={
                    <button type="button" className={pFull ? "cp-btn cp-btn--outline" : "ch-btn-accent"} style={{ minWidth: 96 }} onClick={() => navigate(href)}>
                      {pFull ? "View" : "Join"}
                    </button>
                  }
                />
              );
            })}
          </CompactRows>
        </div>
      )}
    </article>
  );
}
