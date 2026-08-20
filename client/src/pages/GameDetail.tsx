import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cancelGame, fetchGame, joinGame, joinGameWaitlist, leaveGame, leaveGameWaitlist } from "../api";
import { AwardIcon, CalendarIcon, ClockIcon, PinIcon, UsersIcon } from "../components/icons";
import { Button, Card, PageSpinner } from "../components/ui";
import { BackLink } from "../components/BackLink";
import { ChatPanel } from "../components/ChatPanel";
import { PageTitle } from "../components/PageTitle";
import { InviteButton } from "../components/InviteButton";
import { useGuest } from "../GuestContext";
import { colors, fonts } from "../theme";
import { fallbackCopy } from "../copy";
import type { Game } from "../types";

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
                  Hosted by {game.hostName}
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
            </div>
          )}
        </Card>

        {resident && (isHost || game.joinedByMe) && (
          <div style={{ marginTop: 20 }}>
            <ChatPanel scopeType="game" scopeId={game.id} residentId={resident.id} />
          </div>
        )}
      </section>
    </div>
  );
}
