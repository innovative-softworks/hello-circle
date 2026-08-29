import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { checkInGame, confirmGameAttendance, fetchGame } from "../api";
import { BallIcon, CalendarIcon, CheckIcon, HeartIcon } from "../components/icons";
import { BackLink } from "../components/BackLink";
import { ChatPanel } from "../components/ChatPanel";
import { GameHostCard } from "../components/GameHostCard";
import { GameJoinCard, MobileJoinBar } from "../components/GameJoinCard";
import { GameLocationCard } from "../components/GameLocationCard";
import { GameParticipants } from "../components/GameParticipants";
import { GameRelated } from "../components/GameRelated";
import { GameUpdates } from "../components/GameUpdates";
import { IntentCaptureForm } from "../components/IntentCaptureForm";
import { PageTitle } from "../components/PageTitle";
import { Photo } from "../components/Photo";
import { PostActivityFeedback } from "../components/PostActivityFeedback";
import { Reviews } from "../components/Reviews";
import { Button, Card, PageSpinner } from "../components/ui";
import { isFavorite, toggleFavorite } from "../favorites";
import { useGuest } from "../GuestContext";
import { dateLabel } from "../euro";
import { colors, fonts, maxWidth, photoOverlay, placeholderStripes, radius } from "../theme";
import type { Game } from "../types";

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

const outlineButtonStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, background: colors.surface, border: `1px solid ${colors.borderStrong}`,
  borderRadius: radius.control, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, color: colors.text, cursor: "pointer",
};

const factLabelStyle: React.CSSProperties = { fontSize: 11.5, color: colors.mutedLight, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" };
const factValueStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 5, fontSize: 14.5, fontWeight: 700, marginTop: 2 };

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Compact "~60 min · Intermediate · 4 people · 18+" row right under the
// title (§9) — only ever the fields that are actually set; never a
// placeholder for a missing one.
function QuickAttributes({ game }: { game: Game }) {
  const items: string[] = [];
  if (game.durationMinutes) items.push(`~${game.durationMinutes} min`);
  if (game.skillLevel && game.skillLevel !== "All levels") items.push(game.skillLevel);
  items.push(`${game.capacity} people`);
  if (game.minAge) items.push(`${game.minAge}+`);
  if (game.indoorOutdoor) items.push(capitalize(game.indoorOutdoor));
  if (items.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 13.5, color: colors.muted, marginTop: 10 }}>
      {items.map((item, i) => (
        <span key={item}>
          {i > 0 && <span style={{ margin: "0 8px 0 0", color: colors.faint }}>·</span>}
          {item}
        </span>
      ))}
    </div>
  );
}

// Systematic label/value "Good to know" grid (§23) — the Swiss treatment:
// labels + values, not decorative widgets. Same fields as QuickAttributes
// plus surface — only rendered fields that exist.
function GoodToKnow({ game }: { game: Game }) {
  const fields: { label: string; value: string }[] = [];
  if (game.skillLevel && game.skillLevel !== "All levels") fields.push({ label: "Pace", value: game.skillLevel });
  if (game.durationMinutes) fields.push({ label: "Duration", value: `~${game.durationMinutes} min` });
  fields.push({ label: "Group size", value: `${game.capacity} people` });
  if (game.surfaceType) fields.push({ label: "Surface", value: game.surfaceType });
  if (game.indoorOutdoor) fields.push({ label: "Setting", value: capitalize(game.indoorOutdoor) });
  if (game.minAge) fields.push({ label: "Age", value: `${game.minAge}+` });
  if (game.equipmentNeeded) fields.push({ label: "Equipment", value: game.equipmentNeeded });

  return (
    <Card style={{ marginTop: 16 }}>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 12px" }}>Good to know</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {fields.map((f) => (
          <div key={f.label}>
            <div style={factLabelStyle}>{f.label}</div>
            <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 3, lineHeight: 1.4 }}>{f.value}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Subtle supporting card (§24) — real cancellation policy when the host set
// one, otherwise a generic "plans can change" note with no dead-end "Learn
// more" link (there's no cancellation-policy page to send anyone to).
function CancellationCard({ game }: { game: Game }) {
  return (
    <Card style={{ marginTop: 16, background: colors.panel, border: "none" }}>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 14, margin: "0 0 6px" }}>Cancellation & updates</h3>
      <p style={{ margin: 0, fontSize: 13, color: colors.mutedLight, lineHeight: 1.5 }}>
        {game.cancellationPolicy || "Plans can change. Check back here for updates before heading out."}
      </p>
    </Card>
  );
}

export function GameDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saved, setSaved] = useState(false);

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
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);
  useEffect(() => {
    if (game) setSaved(isFavorite("game", game.id));
  }, [game?.id]);

  const handleShare = async () => {
    if (!game) return;
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: game.activityLabel, url });
        return;
      } catch {
        // user cancelled the native share sheet — fall through to clipboard
      }
    }
    await navigator.clipboard.writeText(url);
    alert("Link copied to clipboard");
  };

  if (loading) return <PageSpinner />;

  if (loadError) {
    return (
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: "0 0 10px" }}>We couldn't load this plan.</h1>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
          <Button onClick={load}>Try again</Button>
          <Button variant="ghost" onClick={() => navigate("/games")}>Browse activities</Button>
        </div>
      </section>
    );
  }

  if (!game) {
    return (
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: "0 0 10px" }}>This plan is no longer available.</h1>
        <p style={{ color: colors.mutedLight, marginBottom: 20 }}>It may have been cancelled or removed by its host.</p>
        <Button onClick={() => navigate("/games")}>Find something similar</Button>
      </section>
    );
  }

  const isHost = resident?.id === game.hostResidentId;
  const cancelled = game.status === "cancelled";
  const pending = game.status === "pending_participants";
  const full = game.spotsLeft === 0;
  const happeningNow = !cancelled && isHappeningNow(game.date, game.time);
  const isPast = !cancelled && new Date(`${game.date}T${game.time}:00`).getTime() < Date.now() - CHECK_IN_CLOSES_AFTER_MS;

  return (
    <div className="game-detail-mobile-pad" style={{ animation: "fadeUp .3s ease both" }}>
      <section className="section-pad" style={{ maxWidth: 1440, margin: "0 auto", padding: "26px 24px 90px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
          <BackLink onClick={() => navigate("/games")} marginBottom={0}>All games</BackLink>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={handleShare} style={outlineButtonStyle}>Share</button>
            <button onClick={() => setSaved(toggleFavorite("game", game.id))} style={{ ...outlineButtonStyle, color: saved ? colors.orange : colors.text }}>
              <HeartIcon size={14} filled={saved} /> {saved ? "Saved" : "Save"}
            </button>
          </div>
        </div>

        {cancelled && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: colors.dangerBg, borderRadius: 12, padding: "12px 16px", marginBottom: 20 }}>
            <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: colors.danger }}>Plan cancelled</span>
            <span style={{ fontSize: 13.5, color: colors.danger }}>This plan is no longer happening.</span>
          </div>
        )}

        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 32, alignItems: "start" }}>
          {/* LEFT COLUMN */}
          <div>
            <Photo
              src={game.imageUrl ?? undefined}
              alt={game.activityLabel}
              ph={placeholderStripes.green}
              icon={<BallIcon size={40} />}
              iconColor={colors.green}
              style={{ height: 340, borderRadius: 20, marginBottom: 24 }}
              contentStyle={{ padding: 16, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.92)", color: colors.text, borderRadius: radius.pill, padding: "6px 12px", fontSize: 13, fontWeight: 700 }}>
                <CalendarIcon size={13} /> {dateLabel(game.date)} · {game.time}
              </span>
              {!cancelled && (
                <span
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6, borderRadius: radius.pill, padding: "6px 12px", fontSize: 13, fontWeight: 700,
                    background: full ? photoOverlay.whiteBg : photoOverlay.goldBg,
                    color: full ? colors.muted : photoOverlay.goldText,
                  }}
                >
                  {pending ? "Needs players" : full ? "Full" : `${game.spotsLeft} spot${game.spotsLeft === 1 ? "" : "s"} left`}
                </span>
              )}
            </Photo>

            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 6 }}>
              {pending ? "Needs players" : "Open plan"}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
              <PageTitle level="section" style={{ margin: 0 }}>{game.activityLabel}</PageTitle>
              <div style={{ flex: "none" }}>
                {game.priceCents ? (
                  <div style={{ fontWeight: 800, fontSize: 22, color: colors.text }}>€{(game.priceCents / 100).toFixed(2)}</div>
                ) : (
                  <div style={{ fontWeight: 700, fontSize: 14, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "4px 12px" }}>Free</div>
                )}
              </div>
            </div>
            {game.description && <p style={{ margin: "6px 0 0", fontSize: 15, color: colors.mutedLight, lineHeight: 1.5 }}>{game.description}</p>}
            <QuickAttributes game={game} />

            {game.bookingRef && (
              <div style={{ background: colors.panel, color: colors.muted, borderRadius: 12, padding: "10px 14px", fontSize: 13, margin: "16px 0" }}>
                This game is happening as part of the host's existing room booking — you'll pay your own share to join.
              </div>
            )}
            {pending && !cancelled && (
              <div style={{ background: colors.orangeBg, color: colors.orangeDark, borderRadius: 12, padding: "10px 14px", fontWeight: 700, fontSize: 13.5, margin: "16px 0" }}>
                Needs {Math.max(0, (game.minParticipants ?? 0) - game.joined)} more player{Math.max(0, (game.minParticipants ?? 0) - game.joined) === 1 ? "" : "s"} to confirm — still joinable while waiting.
                {game.confirmationDeadline && (
                  <div style={{ fontWeight: 500, marginTop: 4 }}>
                    Target: confirmed by {new Date(game.confirmationDeadline).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                  </div>
                )}
              </div>
            )}
            {!cancelled && !!game.familiarCount && (
              <div style={{ background: colors.greenBg, color: colors.greenText, borderRadius: 12, padding: "10px 14px", fontWeight: 700, fontSize: 13.5, margin: "16px 0" }}>
                {game.familiarCount} {game.familiarCount === 1 ? "person" : "people"} you've played with before {game.familiarCount === 1 ? "is" : "are"} joining.
              </div>
            )}
            {game.meetingInstructions && (
              <div style={{ background: colors.greenBg, color: colors.greenText, borderRadius: 12, padding: "10px 14px", fontSize: 13.5, margin: "16px 0" }}>
                <strong>Meeting point:</strong> {game.meetingInstructions}
              </div>
            )}

            <div style={{ height: 1, background: colors.border, margin: "24px 0" }} />

            {game.description && (
              <div style={{ marginBottom: 28 }}>
                <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18, margin: "0 0 10px" }}>About this plan</h2>
                <p style={{ margin: 0, fontSize: 15, color: "#3B423C", lineHeight: 1.6 }}>{game.description}</p>
              </div>
            )}

            {game.equipmentNeeded && (
              <div style={{ marginBottom: 28 }}>
                <h3 style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 8px" }}>
                  <CheckIcon size={14} style={{ color: colors.greenText }} /> What to bring
                </h3>
                <p style={{ margin: 0, fontSize: 14, color: colors.muted, lineHeight: 1.5 }}>{game.equipmentNeeded}</p>
              </div>
            )}

            <GameParticipants game={game} />
            <GameHostCard game={game} />
            <GameLocationCard game={game} />
            <GameUpdates game={game} isHost={isHost} />
            <GameRelated game={game} />
          </div>

          {/* RIGHT COLUMN — sticky join rail */}
          <div className="sticky-aside" style={{ position: "sticky", top: 90 }}>
            <GameJoinCard game={game} resident={resident} isHost={isHost} onRefresh={load} />
            <GoodToKnow game={game} />
            <CancellationCard game={game} />
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
                  <PostActivityFeedback kind="game" reference={game.id} />
                  {/* "Do it again" (post-audit hardening pass) — reuses the
                      existing create-game flow via query params rather than a
                      new endpoint; date/time/capacity are left for the host
                      to re-enter, only activity + venue carry over. */}
                  <div style={{ marginTop: 20 }}>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const params = new URLSearchParams({ activity: game.activityLabel });
                        if (game.centreId) params.set("centreId", game.centreId);
                        else if (game.locationText) params.set("locationText", game.locationText);
                        navigate(`/games?${params.toString()}`);
                      }}
                    >
                      Do it again — start a new {game.activityLabel}
                    </Button>
                  </div>
                  <div style={{ marginTop: 20 }}>
                    <Reviews listingType="game" listingId={game.id} accent="green" />
                  </div>
                  {!isHost && game.hostVerified && (
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

          {resident && (isHost || game.joinedByMe) && (
            <div style={{ marginTop: 32 }}>
              <ChatPanel scopeType="game" scopeId={game.id} residentId={resident.id} />
            </div>
          )}
        </div>
      </section>

      {/* "Can't make this one?" (§29) — full-width, breaks out of the
          1440px content column the same way Games.tsx's own closing CTA
          band does, so it reads as a page-level moment rather than another
          card in the content column. */}
      {!cancelled && (
        <section style={{ background: colors.greenBg }}>
          <div className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "48px 24px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 32 }}>
            <div style={{ maxWidth: 460 }}>
              <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(22px, 2.8vw, 28px)", margin: "0 0 8px", letterSpacing: "-.01em", color: colors.greenText }}>
                Can't make this one?
              </h2>
              <p style={{ margin: 0, color: colors.muted, fontSize: 15 }}>
                Tell HelloCircle when you'd like to {game.activityLabel.toLowerCase()}. We'll let you know when a plan matches your interest.
              </p>
            </div>
            <IntentCaptureForm activityLabel={game.activityLabel} county={game.county ?? ""} />
          </div>
        </section>
      )}

      <MobileJoinBar game={game} resident={resident} isHost={isHost} onRefresh={load} />
    </div>
  );
}
