import { useEffect, useState } from "react";
import { ExperienceGetReady, GameGetReady, ProgrammeJourneyView } from "../components/experience/BookingPrep";
import type { Game } from "../types";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  lookupBooking,
  lookupRegistration,
  cancelBooking,
  cancelExperienceBooking,
  cancelProgramEnrollment,
  cancelRegistration,
  downloadBookingIcs,
  downloadExperienceBookingIcs,
  downloadGameIcs,
  fetchMyBookings,
  fetchMyExperienceBookings,
  fetchMyGames,
  fetchMyPasses,
  fetchMyProgramEnrollments,
  fetchMyRegistrations,
  leaveGame,
} from "../api";
import { BkButton, BookingSurface, ConfirmationPanel, PolicySummary, formatCents } from "../components/booking";
import { ConfirmDialog, LoadErrorState, PageSpinner } from "../components/ui";
import { signInHref } from "../authRedirect";
import { dateLabel } from "../euro";
import { useGuest } from "../GuestContext";
import { irelandToday } from "../irelandDate";
import { usePageTitle } from "../pageTitle";
import { VENUE_PAGES_PUBLIC } from "../venueLaunch";
import { bookingState, isBookingKind, type BookingKind } from "./bookingDetailModel";
import { Pass, passDate, passTime, type PassKind, type PassLook, type PassTone } from "../components/pass/Pass";
import { gamePassCode } from "../components/pass/ScanPassModal";

// Booking details (Batch 2, approved 2026-10-22) — one page per booking at
// /bookings/:kind/:ref, for all six participation types. Built only from the
// booking kit the confirmation page already uses (BookingSurface,
// ConfirmationPanel, ListingSummary, PolicySummary) and the existing
// "my …" endpoints and cancel calls. Each "my …" endpoint returns only the
// caller's own rows (resident session or this browser's guest id), so a ref
// that isn't yours reads exactly like one that doesn't exist. No booking,
// refund or payment rule lives here: what can be cancelled, and until when,
// comes from the server's own fields (canCancel, cancelDeadline).

interface Rec {
  typeLabel: string;
  title: string;
  when: string | null;
  details: string | null;
  imageUrl: string | null;
  status: string | null;
  paymentStatus: string | null;
  refundState: "none" | "pending" | "refunded" | null;
  isPast: boolean;
  totalCents: number | null;
  paidOnline: boolean;
  cancelDeadline: string | null;
  contact: "venue" | "host" | "organiser" | "club";
  cancel: { label: string; title: string; message: string; run: () => Promise<unknown> } | null;
  listing: { label: string; href: string } | null;
  ics: (() => Promise<void>) | null;
  extra: string | null;
  /** The pass (owner 2026-10-27): what it shows for this booking. */
  pass: { kind: PassKind; look: PassLook; who?: string | null; whoLabel?: string; date?: string | null; time?: string | null; where?: string | null; fields: [string, string][]; gameId?: string; progress?: { done: number; total: number } | null };
  /** Experience 3.0 — what the preparation / journey sections need. */
  prep?: { kind: "experience"; experienceId: string } | { kind: "game"; game: Game } | { kind: "program" };
}

const past = (date: string | null | undefined) => !!date && date.slice(0, 10) < irelandToday();
const when = (date: string | null | undefined, time: string | null | undefined) => (date ? `${dateLabel(date)}${time ? ` · ${time}` : ""}` : null);
const refundNote = (paidOnline: boolean, totalCents: number) =>
  paidOnline && totalCents > 0 ? " Any refund follows the cancellation terms shown on this page." : paidOnline ? "" : " Nothing was charged online.";

/** `lookupEmail` — a booking found in My Life by reference + email on a
 * device that didn't make it (passed in navigation state, never in the URL).
 * The same rate-limited look-up then loads it, and cancelling sends the email
 * as proof, exactly like the My Life row does. */
async function load(kind: BookingKind, ref: string, lookupEmail?: string): Promise<Rec | null> {
  if (kind === "booking") {
    let b = (await fetchMyBookings()).find((x) => x.ref === ref);
    if (!b && lookupEmail) b = await lookupBooking(ref, lookupEmail).catch(() => undefined);
    if (!b) return null;
    const label = b.roomName ? `${b.centreName} — ${b.roomName}` : b.centreName;
    const active = b.status !== "cancelled" && !past(b.date);
    return {
      typeLabel: "Venue booking", title: label, when: when(b.date, b.time), details: null, imageUrl: b.image || null,
      status: b.status, paymentStatus: b.paymentStatus ?? null, refundState: b.refundState ?? null, isPast: past(b.date),
      totalCents: b.totalCents, paidOnline: !!b.paidOnline, cancelDeadline: active ? b.cancelDeadline ?? null : null, contact: "venue",
      cancel: active && (b.canCancel ?? true) ? { label: "Cancel booking", title: "Cancel this booking?", message: `${label}, ${dateLabel(b.date)} at ${b.time}.${refundNote(!!b.paidOnline, b.totalCents)} This can't be undone.`, run: () => cancelBooking(b.ref, lookupEmail) } : null,
      listing: null, ics: active ? () => downloadBookingIcs(b.ref) : null, extra: null,
      pass: { kind: "room", look: "ticket", date: passDate(b.date), time: b.time, where: b.centreName, fields: b.roomName ? [["Room", b.roomName]] : [] },
    };
  }
  if (kind === "registration") {
    let r = (await fetchMyRegistrations()).find((x) => x.ref === ref);
    if (!r && lookupEmail) r = await lookupRegistration(ref, lookupEmail).catch(() => undefined);
    if (!r) return null;
    const child = `${r.childFirst} ${r.childLast}`.trim();
    const active = r.status !== "cancelled";
    return {
      typeLabel: "Club registration", title: `${r.clubName}${r.team ? ` — ${r.team}` : ""}`, when: null, details: [child, r.sport, r.trial ? "Free trial" : null].filter(Boolean).join(" · "), imageUrl: null,
      status: r.status, paymentStatus: r.paymentStatus ?? null, refundState: r.refundState ?? null, isPast: false,
      totalCents: r.totalCents, paidOnline: !!r.paidOnline, cancelDeadline: null, contact: "club",
      cancel: active && (r.canCancel ?? true) ? { label: "Cancel registration", title: "Cancel this registration?", message: `${child} at ${r.clubName}.${refundNote(!!r.paidOnline, r.totalCents)} This can't be undone.`, run: () => cancelRegistration(r.ref, lookupEmail) } : null,
      listing: VENUE_PAGES_PUBLIC ? { label: "View the club", href: `/clubs/${r.clubId}` } : null, ics: null, extra: null,
      pass: { kind: "club", look: "lanyard", whoLabel: r.trial ? "Free trial" : "Member", who: child || null, where: r.sport, fields: r.team ? [["Team", r.team]] : [] },
    };
  }
  if (kind === "program") {
    const p = (await fetchMyProgramEnrollments()).find((x) => x.ref === ref);
    if (!p) return null;
    const active = p.status !== "cancelled";
    const finished = !p.nextSessionDate && p.hasPastSession;
    return {
      typeLabel: "Programme enrolment", title: p.title, when: p.nextSessionDate ? `Next session ${when(p.nextSessionDate, p.nextSessionTime)}` : null, details: [p.listingName, p.participantName].filter(Boolean).join(" · "), imageUrl: p.imageUrl || null,
      status: p.status, paymentStatus: p.paymentStatus, refundState: p.refundState ?? null, isPast: finished,
      totalCents: p.totalCents, paidOnline: !!p.paidOnline, cancelDeadline: null, contact: "venue",
      cancel: active && p.canCancel ? { label: "Cancel enrolment", title: "Cancel this enrolment?", message: `${p.title} for ${p.participantName}.${refundNote(!!p.paidOnline, p.totalCents)} This can't be undone.`, run: () => cancelProgramEnrollment(p.ref) } : null,
      listing: { label: "View the programme", href: `/programs/${p.programId}` }, ics: null,
      extra: p.sessionsAttended || p.sessionsMissed ? `Attended ${p.sessionsAttended ?? 0} · missed ${p.sessionsMissed ?? 0}` : null,
      pass: {
        kind: "programme", look: "ticket", who: p.participantName || null,
        date: p.nextSessionDate ? `Next ${passDate(p.nextSessionDate)}` : null, time: p.nextSessionTime ?? null, where: p.listingName,
        fields: p.sessionsAttended || p.sessionsMissed ? [["Attended", String(p.sessionsAttended ?? 0)], ["Missed", String(p.sessionsMissed ?? 0)]] : [],
      },
      prep: { kind: "program" },
    };
  }
  if (kind === "experience") {
    const e = (await fetchMyExperienceBookings()).find((x) => x.ref === ref);
    if (!e) return null;
    const active = e.status !== "cancelled" && !past(e.date);
    const noun = e.kind === "adventure" ? "adventure" : "experience";
    return {
      typeLabel: e.kind === "adventure" ? "Adventure booking" : "Experience booking", title: e.title, when: when(e.date, e.time), details: `${e.partySize} ${e.partySize === 1 ? "person" : "people"} · ${e.participantName}`, imageUrl: e.imageUrl || null,
      status: e.status, paymentStatus: e.paymentStatus, refundState: e.refundState ?? null, isPast: past(e.date),
      totalCents: e.totalCents, paidOnline: !!e.paidOnline, cancelDeadline: null, contact: "host",
      cancel: active && e.canCancel ? { label: "Cancel booking", title: "Cancel this booking?", message: `${e.title}, ${dateLabel(e.date)} at ${e.time}.${refundNote(!!e.paidOnline, e.totalCents)} This can't be undone.`, run: () => cancelExperienceBooking(e.ref) } : null,
      listing: { label: `View the ${noun}`, href: `/${e.kind === "adventure" ? "adventures" : "experiences"}/${e.experienceId}` }, ics: active ? () => downloadExperienceBookingIcs(e.ref) : null, extra: null,
      pass: {
        kind: e.kind === "adventure" ? "adventure" : e.kind === "volunteer" ? "volunteer" : "experience", look: e.kind === "volunteer" ? "lanyard" : "ticket",
        who: e.participantName || null, date: passDate(e.date), time: e.time, fields: [["People", String(e.partySize)]],
      },
      prep: { kind: "experience", experienceId: e.experienceId },
    };
  }
  if (kind === "game") {
    // /games/mine returns only activities this resident has joined (game_participants status 'joined').
    const g = (await fetchMyGames()).find((x) => x.id === ref);
    if (!g) return null;
    const active = g.status !== "cancelled" && !past(g.date);
    return {
      typeLabel: "Activity", title: g.activityLabel, when: when(g.date, g.time), details: g.centreName ?? (g.locationText || null), imageUrl: g.imageUrl,
      status: g.status === "cancelled" ? "cancelled" : "confirmed", paymentStatus: null, refundState: null, isPast: past(g.date),
      totalCents: g.priceCents ?? null, paidOnline: !!g.priceCents, cancelDeadline: null, contact: "host",
      cancel: active ? { label: "Leave activity", title: "Leave this activity?", message: `${g.activityLabel}, ${dateLabel(g.date)} at ${g.time}. Your place goes to the next person.`, run: () => leaveGame(g.id) } : null,
      listing: { label: "View the activity", href: `/games/${g.id}` }, ics: active ? () => downloadGameIcs(g.id) : null,
      extra: null,
      pass: {
        kind: g.circleId ? "circle" : "activity", look: g.circleId ? "lanyard" : "wallet", date: passDate(g.date), time: passTime(g.time, g.durationMinutes),
        where: g.centreName ?? (g.locationText || null), fields: [[g.circleId ? "Organiser" : "Host", g.hostName], ["Going", `${g.joined} of ${g.capacity}`]], gameId: g.id,
      },
      prep: { kind: "game", game: g },
    };
  }
  const pass = (await fetchMyPasses()).find((x) => String(x.id) === ref);
  if (!pass) return null;
  const left = pass.creditsTotal - pass.creditsUsed;
  const expired = past(pass.expiresAt);
  return {
    typeLabel: "Session pass", title: `${pass.listingName} pass`, when: pass.expiresAt ? `${expired ? "Expired" : "Valid until"} ${dateLabel(pass.expiresAt)}` : null, details: `${left} of ${pass.creditsTotal} session${pass.creditsTotal === 1 ? "" : "s"} left`, imageUrl: null,
    status: "confirmed", paymentStatus: "paid", refundState: null, isPast: expired || left <= 0,
    totalCents: pass.purchasedCents, paidOnline: true, cancelDeadline: null, contact: "club", cancel: null,
    listing: VENUE_PAGES_PUBLIC ? { label: "View the club", href: `/clubs/${pass.listingId}` } : null, ics: null, extra: null,
    pass: { kind: "pass", look: "ticket", where: pass.listingName, date: pass.expiresAt ? `${expired ? "Expired" : "Valid until"} ${passDate(pass.expiresAt)}` : null, fields: [["Sessions left", `${left} of ${pass.creditsTotal}`]] },
  };
}

const CONFIRMED_STATUS: Record<BookingKind, string> = { booking: "Booked", registration: "Registered", program: "Enrolled", experience: "Booked", game: "You're going", pass: "Ready to use" };

const PASS_TONE: Record<ReturnType<typeof bookingState>["key"], PassTone> = {
  confirmed: "ok",
  pending: "warn",
  failed: "bad",
  cancelled: "bad",
  refund_pending: "bad",
  refunded: "bad",
  completed: "ended",
};

export function BookingDetailPage() {
  const { kind, ref } = useParams<{ kind: string; ref: string }>();
  const navigate = useNavigate();
  const lookupEmail = (useLocation().state as { lookupEmail?: string } | null)?.lookupEmail;
  const { resident, loading: guestLoading } = useGuest();
  const [rec, setRec] = useState<Rec | null | "error" | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [cancelNote, setCancelNote] = useState<string | null>(null);
  usePageTitle(rec && rec !== "error" ? `${rec.title} — booking` : "Booking");

  useEffect(() => {
    if (guestLoading) return;
    if (!isBookingKind(kind) || !ref) return setRec(null);
    let live = true;
    setRec(undefined);
    load(kind, ref, lookupEmail)
      .then((r) => live && setRec(r))
      .catch((e: unknown) => {
        if (!live) return;
        // A signed-out visitor gets 401 from resident-only lists: that's "not found here", not an error.
        const status = (e as { status?: number })?.status;
        setRec(status === 401 || status === 403 ? null : "error");
      });
    return () => {
      live = false;
    };
  }, [kind, ref, guestLoading, resident?.id, attempt]);

  if (rec === undefined) return <PageSpinner />;

  if (rec === "error") {
    return (
      <BookingSurface page>
        <section style={{ maxWidth: 640, margin: "0 auto", padding: "32px 16px 64px" }}>
          <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Booking</h1>
          <LoadErrorState title="We couldn't load this booking." detail="Nothing has been changed. Check your connection and try again." onRetry={() => setAttempt((n) => n + 1)} />
        </section>
      </BookingSurface>
    );
  }

  if (rec === null) {
    return (
      <BookingSurface page>
        <ConfirmationPanel
          variant="failed"
          title="We couldn't find that booking"
          lead={resident ? "It may belong to a different account, or the link may be out of date." : "Sign in to see bookings made with your account, or find a guest booking with its reference and email in My Life."}
          actions={
            <>
              {!resident && <BkButton variant="dark" onClick={() => navigate(signInHref())}>Sign in</BkButton>}
              <BkButton variant={resident ? "dark" : "secondary"} onClick={() => navigate("/my-life")}>Go to My Life</BkButton>
            </>
          }
        />
      </BookingSurface>
    );
  }

  const state = bookingState({ status: rec.status, paymentStatus: rec.paymentStatus, refundState: rec.refundState, isPast: rec.isPast });
  const paidLine = rec.totalCents ? `${formatCents(rec.totalCents)}${rec.paidOnline ? " paid by card" : " — nothing charged online"}` : "Free";
  const showReceipt = !!resident && rec.paidOnline && !!rec.totalCents && kind !== "game" && kind !== "pass";

  return (
    <BookingSurface page>
      <ConfirmationPanel
        variant={state.variant}
        title={state.title}
        lead={cancelNote ?? state.lead}
        summary={
          // The pass (owner 2026-10-27) — the booking as you show up with it.
          // A code only while it's good to use; never while a payment is open.
          <Pass
            look={rec.pass.look}
            kind={rec.pass.kind}
            tone={PASS_TONE[state.key]}
            status={state.key === "confirmed" ? CONFIRMED_STATUS[kind as BookingKind] : state.title}
            title={rec.title}
            whoLabel={rec.pass.whoLabel}
            who={rec.pass.who ?? (kind === "game" ? resident?.name ?? null : null)}
            date={rec.pass.date}
            time={rec.pass.time}
            where={rec.pass.where}
            fields={[...rec.pass.fields, ["Payment", paidLine] as [string, string]].slice(0, 4)}
            reference={kind === "game" || kind === "pass" ? null : ref}
            code={kind === "game" && rec.pass.gameId && resident && state.key === "confirmed" ? gamePassCode(rec.pass.gameId, resident.id) : null}
            codeActive={state.key === "confirmed"}
            listLine={kind === "pass" ? { title: "Use it when you book", text: "Pick the pass at checkout" } : undefined}
          />
        }
        actions={
          <>
            {rec.ics && state.key === "confirmed" && <BkButton variant="dark" onClick={() => void rec.ics!()}>Add to calendar</BkButton>}
            {rec.listing && <BkButton variant={rec.ics && state.key === "confirmed" ? "secondary" : "dark"} onClick={() => navigate(rec.listing!.href)}>{rec.listing.label}</BkButton>}
            {showReceipt && <BkButton variant="secondary" onClick={() => navigate(`/receipts/${encodeURIComponent(ref!)}`)}>View receipt</BkButton>}
            <BkButton variant="quiet" onClick={() => navigate("/my-life")}>Back to My Life</BkButton>
          </>
        }
      >
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "minmax(0, 140px) 1fr", gap: "8px 16px", fontSize: 15 }}>
          <dt style={{ opacity: 0.7 }}>Payment</dt>
          <dd style={{ margin: 0 }}>{paidLine}</dd>
          {rec.extra && (
            <>
              <dt style={{ opacity: 0.7 }}>Note</dt>
              <dd style={{ margin: 0 }}>{rec.extra}</dd>
            </>
          )}
        </dl>
        {state.key === "confirmed" && (rec.cancelDeadline || rec.cancel) && <PolicySummary cancelDeadline={rec.cancelDeadline} contact={rec.contact} />}
        {state.key === "confirmed" && rec.cancel && (
          <div>
            <BkButton variant="danger" onClick={() => setConfirming(true)}>{rec.cancel.label}</BkButton>
          </div>
        )}
      </ConfirmationPanel>
      {/* Experience 3.0 — preparation for a confirmed, upcoming booking; the
          programme journey whenever there's a programme. */}
      {rec.prep?.kind === "experience" && state.key === "confirmed" && !rec.isPast && <ExperienceGetReady experienceId={rec.prep.experienceId} />}
      {rec.prep?.kind === "game" && state.key === "confirmed" && !rec.isPast && <GameGetReady game={rec.prep.game} />}
      {rec.prep?.kind === "program" && ref && <ProgrammeJourneyView bookingRef={ref} />}
      {rec.cancel && (
        <ConfirmDialog
          open={confirming}
          title={rec.cancel.title}
          message={rec.cancel.message}
          confirmLabel={rec.cancel.label}
          cancelLabel="Keep it"
          onConfirm={async () => {
            await rec.cancel!.run();
            setConfirming(false);
            if (kind === "game") {
              // Leaving removes you from the activity, so a re-fetch wouldn't
              // find it any more — show the result in place instead.
              setRec({ ...rec, status: "cancelled", cancel: null, ics: null, typeLabel: "Activity", extra: null });
              setCancelNote("You've left this activity. Your place went to the next person.");
            } else {
              setCancelNote("Done. We've updated this booking.");
              setAttempt((n) => n + 1);
            }
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </BookingSurface>
  );
}
