import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cancelGame, checkInGame, confirmGameAttendance, downloadGameIcs, fetchGame, joinGame, joinGameWaitlist, leaveGame, leaveGameWaitlist } from "../api";
import { AwardIcon, CalendarIcon, CheckIcon, ClockIcon, PinIcon, UsersIcon } from "../components/icons";
import { Button, Card, PageSpinner } from "../components/ui";
import { BackLink } from "../components/BackLink";
import { ChatPanel } from "../components/ChatPanel";
import { PageTitle } from "../components/PageTitle";
import { InviteButton } from "../components/InviteButton";
import { PostActivityFeedback } from "../components/PostActivityFeedback";
import { Reviews } from "../components/Reviews";
import { useGuest } from "../GuestContext";
import { colors, fonts } from "../theme";
import { fallbackCopy } from "../copy";
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

// Game detail (Tier 1) — Games.tsx was list-only; this gives a game a
// shareable URL, room to show host-only controls, and a clearer "who's
// coming" summary than the list card had space for.

export function GameDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!id) return;
    setLoading(true);
    fetchGame(id)
      .then(setGame)
      .catch(() => setGame(null))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  if (loading) return <PageSpinner />;
  if (!game) {
    return (
      <section style={{ maxWidth: 640, margin: "0 auto", padding: "60px 24px", textAlign: "center" }}>
        <p style={{ color: colors.mutedLight }}>This game doesn't exist, or has been cancelled.</p>
        <Button onClick={() => navigate("/games")}>Back to games</Button>
      </section>
    );
  }

  const isHost = resident?.id === game.hostResidentId;
  const cancelled = game.status === "cancelled";
  const pending = game.status === "pending_participants";
  const full = game.spotsLeft === 0;
  const happeningNow = !cancelled && isHappeningNow(game.date, game.time);
  const isPast = !cancelled && new Date(`${game.date}T${game.time}:00`).getTime() < Date.now() - CHECK_IN_CLOSES_AFTER_MS;

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      const res = (await fn()) as { url?: string } | undefined;
      if (res?.url) {
        window.location.href = res.url;
        return;
      }
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallbackCopy.generic);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section style={{ maxWidth: 640, margin: "0 auto", padding: "26px 24px 80px" }}>
        <BackLink onClick={() => navigate("/games")}>All games</BackLink>

        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <PageTitle level="section" style={{ margin: "0 0 4px" }}>{game.activityLabel}</PageTitle>
                {game.soloFriendly && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: 999, padding: "3px 10px", marginBottom: 4 }}>
                    Solo friendly
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: colors.mutedLight, fontSize: 14.5 }}>
                <PinIcon size={14} /> {game.centreName ?? game.locationText}
              </div>
              {game.hostName && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: colors.mutedLight, fontSize: 13.5, marginTop: 4 }}>
                  Hosted by{" "}
                  {game.hostVerified ? (
                    <button onClick={() => navigate(`/host/${game.hostResidentId}`)} style={{ background: "none", border: "none", padding: 0, color: colors.text, font: "inherit", cursor: "pointer", textDecoration: "underline" }}>
                      {game.hostName}
                    </button>
                  ) : (
                    game.hostName
                  )}
                  {game.hostVerified && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: 999, padding: "2px 8px" }}>
                      <AwardIcon size={11} /> Verified Host
                    </span>
                  )}
                </div>
              )}
            </div>
            {game.priceCents ? (
              <div style={{ fontWeight: 700, fontSize: 20, color: colors.greenText }}>€{(game.priceCents / 100).toFixed(2)}</div>
            ) : (
              <div style={{ fontWeight: 700, fontSize: 14, color: colors.greenText, background: colors.greenBg, borderRadius: 999, padding: "4px 12px" }}>Free</div>
            )}
          </div>

          {cancelled && (
            <div style={{ background: colors.dangerBg, color: colors.danger, borderRadius: 12, padding: "10px 14px", fontWeight: 700, fontSize: 13.5, marginBottom: 16 }}>
              This game was cancelled by the host.
            </div>
          )}

          {game.bookingRef && (
            <div style={{ background: colors.panel, color: colors.muted, borderRadius: 12, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
              This game is happening as part of the host's existing room booking — you'll pay your own share to join.
            </div>
          )}

          {pending && !cancelled && (
            <div style={{ background: "#FFF3D6", color: "#9A6B00", borderRadius: 12, padding: "10px 14px", fontWeight: 700, fontSize: 13.5, marginBottom: 16 }}>
              Needs {Math.max(0, (game.minParticipants ?? 0) - game.joined)} more player{Math.max(0, (game.minParticipants ?? 0) - game.joined) === 1 ? "" : "s"} to confirm — still joinable while waiting.
              {game.confirmationDeadline && (
                <div style={{ fontWeight: 500, marginTop: 4 }}>
                  Target: confirmed by {new Date(game.confirmationDeadline).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                </div>
              )}
            </div>
          )}

          {!cancelled && !!game.familiarCount && (
            <div style={{ background: colors.greenBg, color: colors.greenText, borderRadius: 12, padding: "10px 14px", fontWeight: 700, fontSize: 13.5, marginBottom: 16 }}>
              {game.familiarCount} {game.familiarCount === 1 ? "person" : "people"} you've played with before {game.familiarCount === 1 ? "is" : "are"} joining.
            </div>
          )}

          <div style={{ display: "flex", gap: 20, margin: "16px 0", fontSize: 14.5, color: colors.muted, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><CalendarIcon size={15} /> {game.date}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><ClockIcon size={15} /> {game.time}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><UsersIcon size={15} /> {game.joined}/{game.capacity} joined</span>
            {game.skillLevel && <span>· {game.skillLevel}</span>}
          </div>

          {error && <p style={{ color: colors.danger, fontSize: 13.5, margin: "0 0 12px" }}>{error}</p>}

          {!cancelled && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
              {isHost ? (
                <Button variant="danger" onClick={() => run(() => cancelGame(game.id))} disabled={busy}>
                  Cancel this game
                </Button>
              ) : !resident ? (
                <Button onClick={() => navigate("/bookings")}>Sign in to join</Button>
              ) : game.joinedByMe ? (
                <Button variant="ghost" onClick={() => run(() => leaveGame(game.id))} disabled={busy}>
                  Leave game
                </Button>
              ) : full ? (
                game.waitlistedByMe ? (
                  <Button variant="ghost" onClick={() => run(() => leaveGameWaitlist(game.id))} disabled={busy}>
                    Leave waitlist
                  </Button>
                ) : (
                  <Button variant="orange" onClick={() => run(() => joinGameWaitlist(game.id))} disabled={busy}>
                    Join waitlist
                  </Button>
                )
              ) : (
                <Button onClick={() => run(() => joinGame(game.id))} disabled={busy}>
                  {busy ? "Please wait…" : "Join game"}
                </Button>
              )}
              <InviteButton title={game.activityLabel} text={`Join me for ${game.activityLabel} on ${game.date}`} />
              {!isPast && (
                <Button variant="ghost" onClick={() => downloadGameIcs(game.id)}>
                  Add to calendar
                </Button>
              )}
            </div>
          )}
        </Card>

        {/* Activity in progress (IA spec §11) — essentials only, shown in a
            real window around the game's own time; self-serve check-in
            lives here, distinct from the existing vendor-QR check-in
            (bookings/registrations only, vendor-initiated). */}
        {resident && game.joinedByMe && happeningNow && (
          <Card style={{ marginTop: 16, background: colors.greenBg, border: "none" }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 6 }}>Happening now</div>
            <div style={{ fontSize: 13.5, color: colors.muted, marginBottom: 12 }}>
              Meeting point: {game.centreName ?? game.locationText}
            </div>
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
          <Card style={{ marginTop: 16 }}>
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
                {/* Host & Activity reviews (master-prompt punch list #3) —
                    only meaningful once attendance is confirmed. A resident
                    never sees a "review yourself" prompt for their own
                    hosted game. */}
                <div style={{ marginTop: 20 }}>
                  <Reviews listingType="game" listingId={game.id} accent="green" />
                </div>
                {!isHost && game.hostVerified && (
                  <div style={{ marginTop: 20 }}>
                    <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 10px" }}>
                      Review {game.hostName}
                    </h3>
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
          <div style={{ marginTop: 20 }}>
            <ChatPanel scopeType="game" scopeId={game.id} residentId={resident.id} />
          </div>
        )}
      </section>
    </div>
  );
}
