import { CategoryBreadcrumb } from "../components/categories/CategoryChips";
import { WhatToExpect, gameExpectFacts } from "../components/trust/WhatToExpect";
import { usePageTitle } from "../pageTitle";
import { useEffect, useState } from "react";
import { TraderInfo } from "../components/TraderInfo";
import { ParticipationBlock } from "../components/ParticipationBlock";
import { useNavigate, useParams } from "react-router-dom";
import { checkInGame, confirmGameAttendance, fetchGame, isNotFound } from "../api";
import { AwardIcon, BallIcon, CalendarIcon, CheckIcon, ClockIcon, GridIcon, HomeIcon, PersonIcon, PinIcon, SunIcon, UsersIcon } from "../components/icons";
import { KeyFacts, type KeyFact } from "../components/detail/KeyFacts";
import { DetailTopBar, detailActionStyle } from "../components/detail/DetailTopBar";
import { DetailUnavailable } from "../components/detail/DetailUnavailable";
import { ListingChatButton } from "../components/ListingChats";
import { GameHostCard } from "../components/GameHostCard";
import { GameJoinCard, MobileJoinBar } from "../components/GameJoinCard";
import { GameLocationCard } from "../components/GameLocationCard";
import { GameParticipants } from "../components/GameParticipants";
import { GameRelated } from "../components/GameRelated";
import { ExploreWithOthers } from "../components/circle/ExploreWithOthers";
import { GameUpdates } from "../components/GameUpdates";
import { IntentCaptureForm } from "../components/IntentCaptureForm";
import { PageTitle } from "../components/PageTitle";
import { Photo } from "../components/Photo";
import { PhotoGallery } from "../components/PhotoGallery";
import { PostActivityFeedback } from "../components/PostActivityFeedback";
import { IcebreakerCard } from "../components/IcebreakerCard";
import { Reviews } from "../components/Reviews";
import { Button, Card, PageSpinner } from "../components/ui";
import { useGuest } from "../GuestContext";
import { rehostHref } from "../rehost";
import { dateLabel } from "../euro";
import { formatDuration } from "../formatters";
import { directionsHref } from "../components/BookingFacts";
import { cardImageRatio, colors, fonts, maxWidth, photoOverlay, placeholderStripes, radius } from "../theme";
import type { Game } from "../types";
import { CtaBand } from "../components/CtaBand";

// Self-serve check-in only makes sense in a real window around the game's
// own time — not the moment it's created, not weeks after. Client-only
// gating (see games.ts's own comment: the server intentionally doesn't
// hard-block a late check-in, this is just when the button appears).
const CHECK_IN_OPENS_BEFORE_MS = 60 * 60 * 1000;
const CHECK_IN_CLOSES_AFTER_MS = 6 * 60 * 60 * 1000;

function isHappeningNow(date: string, time: string): boolean {
  const start = new Date(`${date}T${time}:00`).getTime();
  const now = Date.now();
  return now >= start - CHECK_IN_OPENS_BEFORE_MS && now <= start + CHECK_IN_CLOSES_AFTER_MS;
}


const factLabelStyle: React.CSSProperties = { fontSize: 11.5, color: colors.mutedLight, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0 };
const factValueStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 5, fontSize: 14.5, fontWeight: 700, marginTop: 2 };

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Detail-page redesign — the activity's key facts, shown once under the
// title (audit DP-04); only the fields that are actually set.
function activityFacts(game: Game): KeyFact[] {
  const facts: KeyFact[] = [];
  if (game.durationMinutes) facts.push({ icon: <ClockIcon size={17} />, value: `~${game.durationMinutes} min`, label: "Duration" });
  if (game.skillLevel && game.skillLevel !== "All levels") facts.push({ icon: <AwardIcon size={17} />, value: game.skillLevel, label: "Level" });
  facts.push({ icon: <UsersIcon size={17} />, value: `Up to ${game.capacity}`, label: "Group size" });
  if (game.minAge) facts.push({ icon: <PersonIcon size={17} />, value: `${game.minAge}+`, label: "Minimum age" });
  if (game.indoorOutdoor) facts.push({ icon: game.indoorOutdoor === "indoor" ? <HomeIcon size={17} /> : <SunIcon size={17} />, value: capitalize(game.indoorOutdoor), label: "Setting" });
  if (game.surfaceType) facts.push({ icon: <GridIcon size={17} />, value: game.surfaceType, label: "Surface" });
  return facts;
}

export function GameDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [game, setGame] = useState<Game | null>(null);
  usePageTitle(game?.activityLabel);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Bumped when the host shares an icebreaker, so GameUpdates refetches.
  const [updatesKey, setUpdatesKey] = useState(0);

  // Deliberately doesn't flip `loading` back to true on every call — this
  // also runs as the onRefresh() callback after joining/leaving/cancelling
  // (see GameJoinCard), and re-showing the full-page <PageSpinner /> there
  // would unmount the whole tree, silently wiping out GameJoinCard's own
  // "You're in! 🎉" celebration state before anyone could see it. `loading`
  // now only ever gates the very first fetch.
  const load = () => {
    if (!id) return;
    setLoadError(false);
    fetchGame(id)
      .then(setGame)
      // PUB-14: a removed/missing activity shows "no longer available", not a retry.
      .catch((e) => (isNotFound(e) ? setGame(null) : setLoadError(true)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  if (loading) return <PageSpinner />;

  if (loadError) {
    return (
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(24px, 2.4vw, 30px)", margin: "0 0 10px" }}>We couldn't load this activity.</h1>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
          <Button onClick={load}>Try again</Button>
          <Button variant="ghost" onClick={() => navigate("/games")}>Browse activities</Button>
        </div>
      </section>
    );
  }

  if (!game) return <DetailUnavailable noun="activity" listPath="/games" listLabel="Browse activities" />;

  const isHost = resident?.id === game.hostResidentId;
  const cancelled = game.status === "cancelled";
  const pending = game.status === "pending_participants";
  const full = game.spotsLeft === 0;
  const happeningNow = !cancelled && isHappeningNow(game.date, game.time);
  const ended = !cancelled && game.effectiveLifecycle === "completed";
  const isPast = !cancelled && new Date(`${game.date}T${game.time}:00`).getTime() < Date.now() - CHECK_IN_CLOSES_AFTER_MS;

  return (
    <div className="game-detail-mobile-pad fade-panel">
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "26px 24px 90px" }}>
        <DetailTopBar
          backTo="/games"
          backLabel="All activities"
          extra={<ListingChatButton scopeType="game" listingId={game.id} style={detailActionStyle} refreshKey={game.joinedByMe} />}
          share={{ entityType: "game", entityId: game.id }}
          save={{ kind: "game", id: game.id }}
          report={isHost ? undefined : { type: "game", id: game.id, what: "this activity" }}
        />

        {cancelled && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: colors.dangerBg, borderRadius: radius.control, padding: "12px 16px", marginBottom: 20 }}>
            <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0, textTransform: "uppercase", color: colors.danger }}>Cancelled</span>
            <span style={{ fontSize: 13.5, color: colors.danger }}>This activity is no longer happening.</span>
          </div>
        )}

        {/* Detail-page redesign: 70/30 — head and body on the left, the
            booking column on the right; on phones the booking column follows
            the head (price, date, action and cancellation before the rest). */}
        <div className="detail-grid">
          <div className="detail-head">
            {/* Batch 2 — the shared cover (same frame and slides on every detail page). */}
            <PhotoGallery
              images={[game.imageUrl]}
              alt={game.activityLabel}
              ph={placeholderStripes.green}
              icon={<BallIcon size={40} />}
              iconColor={colors.green}
              style={{ marginBottom: 24 }}
              overlay={<>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.92)", color: colors.text, borderRadius: radius.pill, padding: "6px 12px", fontSize: 13, fontWeight: 700 }}>
                <CalendarIcon size={13} /> {dateLabel(game.date)} · {game.time}
              </span>
              {!cancelled && !ended && (pending || full) && (
                <span
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6, borderRadius: radius.pill, padding: "6px 12px", fontSize: 13, fontWeight: 700,
                    background: full ? photoOverlay.whiteBg : photoOverlay.goldBg,
                    color: full ? colors.muted : photoOverlay.goldText,
                  }}
                >
                  {pending ? "Needs players" : "Full"}
                </span>
              )}
              </>}
            />

            <div style={{ marginBottom: 8 }}>
              <CategoryBreadcrumb taxonomy={game.taxonomy} tags={game.tags} basePath="/games" typeLabel="Activities" />
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0, textTransform: "uppercase", color: colors.mutedLight, marginBottom: 6 }}>
              {ended ? "Ended" : pending ? "Needs players" : "Activity"}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
              <PageTitle level="section" style={{ margin: 0 }}>{game.activityLabel}</PageTitle>
            </div>

            {/* Circle Experience Polish — Changeset 2B. toGameJson already
                returns circleId/circleName/circleSlug for every real
                games.circle_id-owned game; this is the client's first use
                of any of the three — closes the Activity→Circle discovery
                gap the audit found (a resident joining a circle's own
                activity previously had no way back to the Circle itself). */}
            {game.circleId && (
              <button
                onClick={() => navigate(`/circles/${game.circleSlug ?? game.circleId}`)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10, background: colors.panel, border: "none",
                  borderRadius: radius.pill, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, color: colors.text, cursor: "pointer",
                }}
              >
                <UsersIcon size={13} /> Hosted with {game.circleName || "a Circle"} →
              </button>
            )}
            {game.partnerCircle && (
              <button
                onClick={() => navigate(`/circles/${game.partnerCircle!.slug ?? game.partnerCircle!.id}`)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10, marginLeft: 8, background: colors.panel, border: "none",
                  borderRadius: radius.pill, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, color: colors.text, cursor: "pointer",
                }}
              >
                <UsersIcon size={13} /> Together with {game.partnerCircle.name} →
              </button>
            )}

            {/* When and where, once, under the title (owner 2026-10-27, booking
                box option 2): the booking box no longer repeats them. */}
            <div className="detail-when-where">
              <span>
                <CalendarIcon size={15} />
                <b>{dateLabel(game.date)} · {game.time}</b>
                {game.durationMinutes ? <> · {formatDuration(game.durationMinutes)}</> : null}
              </span>
              <span>
                <PinIcon size={15} />
                <b>{game.centreName ?? game.locationText}</b>
                {[game.area, game.county].filter(Boolean).length ? <>, {[game.area, game.county].filter(Boolean).join(", ")}</> : null}
                {" · "}
                <a href={directionsHref([game.centreName ?? game.locationText, game.area, game.county].filter(Boolean).join(", "))} target="_blank" rel="noreferrer">
                  Directions
                </a>
              </span>
            </div>
            {game.hostName && <div style={{ color: colors.mutedLight, fontSize: 14, marginTop: 4 }}>Hosted by {game.hostName}</div>}

            <KeyFacts facts={activityFacts(game)} />
            <ParticipationBlock attributes={game.participationAttributes} going={cancelled ? 0 : game.joined} firstTimers={game.firstTimerCount} />

            {game.bookingRef && (
              <div style={{ background: colors.panel, color: colors.muted, borderRadius: radius.control, padding: "10px 14px", fontSize: 13, margin: "16px 0" }}>
                This session is happening as part of the host's existing room booking — you'll pay your own share to join.
              </div>
            )}
            {pending && !cancelled && (
              <div style={{ background: colors.orangeBg, color: colors.orangeDark, borderRadius: radius.control, padding: "10px 14px", fontWeight: 700, fontSize: 13.5, margin: "16px 0" }}>
                Needs {Math.max(0, (game.minParticipants ?? 0) - game.joined)} more player{Math.max(0, (game.minParticipants ?? 0) - game.joined) === 1 ? "" : "s"} to confirm — still joinable while waiting.
                {game.confirmationDeadline && (
                  <div style={{ fontWeight: 500, marginTop: 4 }}>
                    Target: confirmed by {new Date(game.confirmationDeadline).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                  </div>
                )}
              </div>
            )}
            {!cancelled && !!game.familiarCount && (
              <div style={{ background: colors.greenBg, color: colors.greenText, borderRadius: radius.control, padding: "10px 14px", fontWeight: 700, fontSize: 13.5, margin: "16px 0" }}>
                {game.familiarCount} {game.familiarCount === 1 ? "person" : "people"} you've played with before {game.familiarCount === 1 ? "is" : "are"} joining.
              </div>
            )}
            {game.meetingInstructions && (
              <div style={{ background: colors.greenBg, color: colors.greenText, borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5, margin: "16px 0" }}>
                <strong>Meeting point:</strong> {game.meetingInstructions}
              </div>
            )}

          </div>

          <div className="detail-body">
            <div style={{ height: 1, background: colors.border, margin: "24px 0" }} />

            {game.description && (
              <div style={{ marginBottom: 28 }}>
                <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18, margin: "0 0 10px" }}>About this activity</h2>
                <p style={{ margin: 0, fontSize: 15, color: colors.textSoft, lineHeight: 1.6 }}>{game.description}</p>
              </div>
            )}

            {/* Trust & Retention batch 1 — one "What to expect" list, every field
                shown, empty ones as "Not provided" rather than left out. */}
            <WhatToExpect facts={gameExpectFacts(game)} />

            <GameParticipants game={game} />
            {isHost && !cancelled && !isPast && <IcebreakerCard game={game} onShared={() => setUpdatesKey((k) => k + 1)} />}
            <GameUpdates key={updatesKey} game={game} isHost={isHost} />
            {!game.circleId && <ExploreWithOthers taxonomy={game.taxonomy} county={game.county} noun="activity" />}
            <GameRelated game={game} />
          </div>

          {/* Booking column — sticky on desktop; on phones it follows the head. */}
          <div className="detail-aside">
            <GameJoinCard game={game} resident={resident} isHost={isHost} onRefresh={load} />
            {/* Hosted by and Where sit in the booking column (owner, 2026-10-22). */}
            <div style={{ marginTop: 24 }}>
              <GameHostCard game={game} />
              <GameLocationCard game={game} />
            </div>
          </div>
        </div>

        {/* Participant-only sections — narrower reading-width column, since
            this is chat/review text rather than listing facts. */}
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          {resident && game.joinedByMe && happeningNow && (
            <Card style={{ marginTop: 32, background: colors.greenBg, border: "none" }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 6 }}>Happening now</div>
              <div style={{ fontSize: 13.5, color: colors.muted, marginBottom: 12 }}>Meeting point: {game.centreName ?? game.locationText}</div>
              {game.checkedInAt ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: colors.greenText }}>
                  <CheckIcon size={14} /> Checked in
                </span>
              ) : (
                <Button onClick={() => checkInGame(game.id).then(load)}>I'm here</Button>
              )}
            </Card>
          )}

          {resident && game.joinedByMe && isPast && (
            <Card style={{ marginTop: 32 }}>
              {game.attended === null || game.attended === undefined ? (
                <>
                  <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 10 }}>Did you attend?</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button onClick={() => confirmGameAttendance(game.id, true).then(load)}>Yes, I went</Button>
                    <Button variant="ghost" onClick={() => confirmGameAttendance(game.id, false).then(load)}>No, I missed it</Button>
                  </div>
                </>
              ) : game.attended ? (
                <>
                  <PostActivityFeedback
                    kind="game"
                    reference={game.id}
                    followTarget={!isHost && game.visibility === "public" ? { type: "host", id: game.hostResidentId } : undefined}
                  />
                  {/* "Do it again" (post-audit hardening pass, extended in
                      HelloCircle Manage Phase 23, Host Experience Polish) —
                      reuses the existing create-game flow via query params
                      rather than a new endpoint. Param-building itself now
                      lives in rehost.ts, shared with HostActivitiesTab.tsx's
                      Duplicate/Host-again actions — this call site is
                      unchanged behavior, just no longer duplicating the
                      field list inline. */}
                  <div style={{ marginTop: 20 }}>
                    <Button variant="ghost" onClick={() => navigate(rehostHref(game))}>
                      Do it again — start a new {game.activityLabel}
                    </Button>
                  </div>
                  <div style={{ marginTop: 20 }}>
                    <Reviews listingType="game" listingId={game.id} accent="green" followAfter={!isHost ? { type: "host", id: game.hostResidentId, name: game.hostName } : undefined} />
                  </div>
                  {!isHost && (
                    <div style={{ marginTop: 20 }}>
                      <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 10px" }}>Review {game.hostName}</h3>
                      <Reviews listingType="host" listingId={game.hostResidentId} accent="green" />
                    </div>
                  )}
                </>
              ) : (
                <span style={{ fontSize: 13, color: colors.mutedLight }}>Thanks for letting us know.</span>
              )}
            </Card>
          )}

        </div>
      </section>

      {/* "Can't make this one?" (§29) — the shared CtaBand, with this
          activity's own copy and the interest form (hidden once cancelled). */}
      <CtaBand
        id="game-cta-title"
        label="Not this time?"
        lines={["Can't", "make this", "one?"]}
        text="No worries — we'll let you know about similar activities and new events near you."
        panel={{ title: "Another time works better?", text: "Tell us when suits you. We'll let you know when a similar activity is planned." }}
        action={{
          label: "Explore similar activities",
          to: game.taxonomy
            ? `/games?category=${game.taxonomy.categorySlug}${game.taxonomy.subcategorySlug ? `&sub=${game.taxonomy.subcategorySlug}` : ""}`
            : `/games?activity=${encodeURIComponent(game.activityLabel)}`,
        }}
      >
        {!cancelled && <IntentCaptureForm variant="panel" activityLabel={game.activityLabel} county={game.county ?? ""} />}
      </CtaBand>

      {(game.priceCents ?? 0) > 0 && (
        <section className="section-pad" style={{ maxWidth: 960, margin: "0 auto", padding: "0 24px 32px" }}>
          <TraderInfo type="game" id={game.id} />
        </section>
      )}

      <MobileJoinBar game={game} resident={resident} isHost={isHost} onRefresh={load} />
    </div>
  );
}
