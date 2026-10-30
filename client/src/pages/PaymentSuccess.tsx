import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  downloadBookingIcs,
  downloadExperienceBookingIcs,
  downloadGameIcs,
  fetchBookingStatus,
  fetchExperienceBookingStatus,
  fetchGameJoinStatus,
  fetchPassStatus,
  fetchProgramEnrollmentStatus,
  fetchRegistrationStatus,
  ApiError,
} from "../api";
import { useMyStuff } from "../MyStuffContext";
import { BkButton, BookingSurface, ConfirmationPanel, ListingSummary, PolicySummary, formatCents } from "../components/booking";
import { ShareButton } from "../components/ShareButton";
import { Pass, passDate, type PassProps } from "../components/pass/Pass";
import { dateLabel } from "../euro";
import { usePageTitle } from "../pageTitle";
import { paymentResultTitle } from "./paymentResultTitle";
import type {
  BookingConfirmation,
  ExperienceBookingConfirmation,
  GameJoinConfirmation,
  PassConfirmation,
  ProgramEnrollmentConfirmation,
  RegistrationConfirmation,
} from "../types";

/** D-10 / D-11 — what the server says about a paid order that couldn't simply
 * be confirmed (GET …/status/:ref → paymentCase). The money was received in
 * every one of these states, so none of them is shown as "not paid" or
 * "not found". */
interface PaymentCase {
  state: "review" | "review_urgent" | "review_expired" | "refund_pending" | "refunded" | "not_fulfilled";
  reason: string;
  receivedMinor: number | null;
  currency: string;
  refundedMinor: number;
  refundedAt: string | null;
}

const WHY: Record<string, string> = {
  capacity_unavailable: "the place was no longer available when your payment came through",
  org_suspended: "this provider isn't taking bookings right now",
  listing_unavailable: "this listing or session is no longer available",
  after_start: "it had already started when your payment came through",
  mid_programme: "the programme had already started when your payment came through",
  order_cancelled: "this booking had already been cancelled when your payment came through",
  provider_state: "your payment needs to be checked by our team",
  amount_mismatch: "the amount charged didn't match what was agreed at checkout",
  currency_mismatch: "the currency charged didn't match what was agreed at checkout",
};

function caseCopy(c: PaymentCase): { variant: "pending" | "cancelled"; title: string; lead: string } {
  const received = c.receivedMinor !== null ? `We've received your payment of ${formatCents(c.receivedMinor)}` : "We've received your payment";
  const why = WHY[c.reason] ?? "it needs a check";
  switch (c.state) {
    case "review":
      return {
        variant: "pending",
        title: "Your payment needs a quick check",
        lead: `${received}, but ${why}, so your booking isn't confirmed yet. ${c.reason === "org_suspended" ? "Our team will contact you about your payment." : "Your place is being held while our team checks it, and we'll contact you."} Please don't pay again.`,
      };
    case "review_urgent":
      return { variant: "pending", title: "We couldn't confirm your payment in time", lead: `${received}, but it couldn't be checked before your booking starts, so it isn't confirmed. Our team will contact you about your payment. Please don't pay again.` };
    case "review_expired":
      return { variant: "pending", title: "We couldn't confirm your booking in time", lead: `${received} and our team is still checking it. Your place is no longer being held. We'll contact you about your payment — please don't pay again.` };
    case "refund_pending":
      return {
        variant: "cancelled",
        title: c.reason === "capacity_unavailable" ? "We couldn't keep your place — your refund is on its way" : c.reason === "org_suspended" ? "This provider isn't taking bookings — your refund is on its way" : "Your booking wasn't confirmed — your refund is on its way",
        lead: `${received}. A full refund is being processed; it can take a few business days to reach your account.`,
      };
    case "refunded":
      return {
        variant: "cancelled",
        title: "Your booking wasn't confirmed — your payment was refunded",
        lead: `${received}, but ${why}. We refunded ${formatCents(c.refundedMinor)}${c.refundedAt ? ` on ${new Date(c.refundedAt).toLocaleDateString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "long", year: "numeric" })}` : ""}. It can take a few business days to show on your statement.`,
      };
    case "not_fulfilled":
    default:
      return { variant: "cancelled", title: c.reason === "capacity_unavailable" ? "We couldn't keep your place" : "We couldn't confirm this booking", lead: `${received}, but ${why}. Our team will arrange your refund and contact you — please don't pay again.` };
  }
}

const POLL_MS = 1500;
const MAX_ATTEMPTS = 12;

type AnyConfirmation = BookingConfirmation | RegistrationConfirmation | GameJoinConfirmation | ExperienceBookingConfirmation | ProgramEnrollmentConfirmation | PassConfirmation;

/** checkoutService.ts's six payment types each mint a ref via a distinct
 * generateRef() prefix (util.ts) and all redirect to this same
 * /payment/success URL. Each fetcher now returns a real, type-specific
 * confirmation shape (Resident Experience Polish, Changeset 5) — enriched
 * in place server-side, so the same poll that confirms payment also carries
 * everything needed to answer "what did I just book?", no second fetch. */
const STATUS_FETCHERS: Record<string, (ref: string) => Promise<AnyConfirmation>> = {
  "CR-": fetchRegistrationStatus,
  "GJ-": fetchGameJoinStatus,
  "EX-": fetchExperienceBookingStatus,
  "PS-": fetchPassStatus,
  "PR-": fetchProgramEnrollmentStatus,
  "HB-": fetchBookingStatus,
};

function statusFetcherFor(ref: string): (ref: string) => Promise<AnyConfirmation> {
  const prefix = Object.keys(STATUS_FETCHERS).find((p) => ref.startsWith(p));
  return prefix ? STATUS_FETCHERS[prefix] : fetchBookingStatus;
}

/** What the confirmed-state card actually renders — normalized once per
 * ref-prefix from whichever real fields that type's confirmation carries.
 * Never fabricates a field the source doesn't have (e.g. a registration has
 * no single dated occurrence, so `when` stays null for it, not a made-up
 * date) — matches the same honesty convention as Changeset 1's
 * nextSessionDate work. */
interface ConfirmationView {
  title: string;
  venue: string | null;
  when: string | null;
  quantity: string | null;
  manageHref: string;
  shareEntity: { type: "centre" | "club" | "game" | "experience" | "program"; id: string } | null;
  onAddToCalendar: (() => void) | null;
}

function viewFor(ref: string, d: AnyConfirmation): ConfirmationView {
  if (ref.startsWith("HB-")) {
    const b = d as BookingConfirmation;
    return {
      title: b.roomName ? `${b.centreName} — ${b.roomName}` : b.centreName,
      venue: b.centreName,
      when: `${dateLabel(b.date)} · ${b.time}`,
      quantity: `${b.guests} guest${b.guests === 1 ? "" : "s"}`,
      manageHref: `/bookings/booking/${encodeURIComponent(b.ref)}`,
      shareEntity: { type: "centre", id: b.centreId },
      onAddToCalendar: () => downloadBookingIcs(b.ref),
    };
  }
  if (ref.startsWith("CR-")) {
    const r = d as RegistrationConfirmation;
    return {
      title: `${r.childFirst} ${r.childLast}`.trim(),
      venue: r.clubName,
      when: null, // ongoing club membership — no single dated occurrence
      quantity: r.team || null,
      manageHref: `/bookings/registration/${encodeURIComponent(r.ref)}`,
      shareEntity: { type: "club", id: r.clubId },
      onAddToCalendar: null,
    };
  }
  if (ref.startsWith("GJ-")) {
    const g = d as GameJoinConfirmation;
    return {
      title: g.activityLabel,
      venue: g.centreName ?? (g.locationText || null),
      when: `${dateLabel(g.date)} · ${g.time}`,
      quantity: null,
      manageHref: `/bookings/game/${encodeURIComponent(g.gameId)}`,
      shareEntity: { type: "game", id: g.gameId },
      onAddToCalendar: () => downloadGameIcs(g.gameId),
    };
  }
  if (ref.startsWith("EX-")) {
    const e = d as ExperienceBookingConfirmation;
    return {
      title: e.title,
      venue: e.meetingPoint || null,
      when: `${dateLabel(e.date)} · ${e.time}`,
      quantity: `${e.partySize} ${e.partySize === 1 ? "person" : "people"}`,
      manageHref: `/bookings/experience/${encodeURIComponent(e.ref)}`,
      shareEntity: { type: "experience", id: e.experienceId },
      onAddToCalendar: () => downloadExperienceBookingIcs(e.ref),
    };
  }
  if (ref.startsWith("PR-")) {
    const p = d as ProgramEnrollmentConfirmation;
    return {
      title: p.title,
      venue: p.listingName,
      when: null, // one enrollment covers every session — no single date
      quantity: null,
      manageHref: `/bookings/program/${encodeURIComponent(p.ref)}`,
      shareEntity: { type: "program", id: p.programId },
      onAddToCalendar: null,
    };
  }
  const p = d as PassConfirmation;
  return {
    title: p.clubName ? `${p.clubName} pass` : "Session pass",
    venue: p.clubName,
    when: null,
    quantity: `${p.creditsTotal} session${p.creditsTotal === 1 ? "" : "s"}`,
    manageHref: `/bookings?ref=${p.ref}`,
    shareEntity: p.clubId ? { type: "club", id: p.clubId } : null,
    onAddToCalendar: null,
  };
}

/** The pass for a paid order (owner 2026-10-27): ticket look; a club
 * registration uses the lanyard look (the person it's for first). While the
 * payment is being checked the pass says so and its code is greyed out. */
function passFor(ref: string, d: AnyConfirmation, review: boolean): PassProps {
  const paid = formatCents(d.totalCents);
  const base = { look: "ticket" as const, tone: review ? ("warn" as const) : ("ok" as const), reference: ref, codeActive: !review, as: "h2" as const };
  const status = (ok: string) => (review ? "Payment being checked" : ok);
  const paidLabel = review ? "Received" : "Paid";
  const note = review ? "We received your payment and are checking it. This isn't booked yet. Please don't pay again." : null;
  if (ref.startsWith("HB-")) {
    const b = d as BookingConfirmation;
    return { ...base, kind: "room", status: status("Booked"), title: b.roomName ?? b.centreName, date: passDate(b.date), time: b.time, where: b.centreName, fields: [["Guests", String(b.guests)], [paidLabel, paid]], note };
  }
  if (ref.startsWith("CR-")) {
    const r = d as RegistrationConfirmation;
    return { ...base, look: "lanyard", kind: "club", status: status("Registered"), title: r.clubName, whoLabel: "Member", who: `${r.childFirst} ${r.childLast}`.trim() || null, fields: [...(r.team ? ([["Team", r.team]] as [string, string][]) : []), [paidLabel, paid]], note };
  }
  if (ref.startsWith("GJ-")) {
    const g = d as GameJoinConfirmation;
    return { ...base, kind: "activity", status: status("You're going"), title: g.activityLabel, date: passDate(g.date), time: g.time, where: g.centreName ?? g.locationText, fields: [[paidLabel, paid]], note };
  }
  if (ref.startsWith("EX-")) {
    const e = d as ExperienceBookingConfirmation;
    return { ...base, kind: e.kind === "adventure" ? "adventure" : e.kind === "volunteer" ? "volunteer" : e.kind === "event" ? "event" : "experience", status: status("Booked"), title: e.title, date: passDate(e.date), time: e.time, where: e.meetingPoint || null, fields: [["People", String(e.partySize)], [paidLabel, paid]], note };
  }
  if (ref.startsWith("PR-")) {
    const p = d as ProgramEnrollmentConfirmation;
    return { ...base, kind: "programme", status: status("Enrolled"), title: p.title, where: p.listingName, fields: [[paidLabel, paid]], note };
  }
  const p = d as PassConfirmation;
  return { ...base, kind: "pass", status: status("Ready to use"), title: p.clubName ? `${p.clubName} pass` : "Session pass", where: p.clubName, fields: [["Sessions", String(p.creditsTotal)], [paidLabel, paid]], note };
}

export function PaymentSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useMyStuff();
  const ref = searchParams.get("ref");
  // "review": Stripe reported a payment that didn't match the checkout the
  // server agreed, so it is parked for a person to check — never shown as
  // booked. "error": the status couldn't be fetched (not the same as "not found").
  const [status, setStatus] = useState<"checking" | "paid" | "pending" | "review" | "case" | "failed" | "notfound" | "error">("checking");
  const [paymentCase, setPaymentCase] = useState<PaymentCase | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [details, setDetails] = useState<AnyConfirmation | null>(null);
  const attempts = useRef(0);

  useEffect(() => {
    if (!ref) {
      setStatus("notfound");
      return;
    }
    const fetchStatus = statusFetcherFor(ref);
    let cancelled = false;

    const poll = () => {
      fetchStatus(ref)
        .then((r) => {
          if (cancelled) return;
          const pc = (r as { paymentCase?: PaymentCase | null }).paymentCase;
          if (pc) {
            setPaymentCase(pc);
            setStatus("case");
          } else if (r.paymentStatus === "paid") {
            setDetails(r);
            setStatus("paid");
            refresh();
          } else if (r.paymentStatus === "failed") {
            setStatus("failed");
          } else if ((r as { paymentReview?: boolean }).paymentReview) {
            setDetails(r);
            setStatus("review");
          } else if (attempts.current < MAX_ATTEMPTS) {
            attempts.current += 1;
            setTimeout(poll, POLL_MS);
          } else {
            setStatus("pending");
          }
        })
        .catch((e) => !cancelled && setStatus(e instanceof ApiError && e.status === 404 ? "notfound" : "error"));
    };
    attempts.current = 0;
    poll();
    return () => {
      cancelled = true;
    };
  }, [ref, refresh, attempt]);

  // Never says "booked" before the server does: the rich summary renders only
  // once the poll has returned paid (Booking UX Phase 3, on the booking kit).
  const view = status === "paid" && ref && details ? viewFor(ref, details) : null;
  usePageTitle(paymentResultTitle(status, paymentCase?.state));
  const cancelDeadline = details && "cancelDeadline" in details ? details.cancelDeadline : undefined;

  return (
    <BookingSurface page>
      {status === "checking" && (
        <ConfirmationPanel variant="pending" title="Confirming your payment…" bookingRef={ref} lead="This usually takes a few seconds. Please don't pay again." />
      )}

      {status === "paid" && (
        <ConfirmationPanel
          variant="success"
          title="You're all set!"
          bookingRef={view ? null : ref}
          lead={details ? `Paid ${formatCents(details.totalCents)}. A receipt is on its way to your email.` : "Payment confirmed. A receipt is on its way to your email."}
          summary={view && ref && details && <Pass {...passFor(ref, details, false)} />}
          actions={
            <>
              <BkButton variant="dark" onClick={() => navigate(view?.manageHref ?? "/bookings")}>View booking</BkButton>
              <BkButton variant="secondary" onClick={() => navigate("/home")}>Explore more</BkButton>
              {view?.onAddToCalendar && (
                <BkButton variant="quiet" onClick={() => view.onAddToCalendar!()}>
                  Add to calendar
                </BkButton>
              )}
              {view?.shareEntity && <ShareButton entityType={view.shareEntity.type} entityId={view.shareEntity.id} variant="ghost" label="Share" />}
            </>
          }
        >
          {cancelDeadline && <PolicySummary cancelDeadline={cancelDeadline} contact={ref?.startsWith("EX-") ? "host" : "venue"} />}
        </ConfirmationPanel>
      )}

      {status === "pending" && (
        <ConfirmationPanel
          variant="pending"
          title="Still confirming"
          bookingRef={ref}
          lead="Your payment is taking longer than usual to confirm. It will appear in My Life as soon as it's through — please don't pay again."
          actions={<BkButton variant="dark" onClick={() => navigate("/bookings")}>Check my bookings</BkButton>}
        />
      )}

      {status === "review" && (
        <ConfirmationPanel
          variant="pending"
          title="Your payment needs a quick check"
          bookingRef={details ? null : ref}
          summary={ref && details ? <Pass {...passFor(ref, details, true)} /> : undefined}
          lead="The payment Stripe reported for this booking didn't match what was agreed at checkout, so the booking isn't confirmed yet. It's waiting for our team to check. Please don't pay again — contact us with your booking reference if you have a question."
          actions={
            <>
              <BkButton variant="dark" onClick={() => navigate("/contact")}>Contact us</BkButton>
              <BkButton variant="secondary" onClick={() => navigate("/bookings")}>My bookings</BkButton>
            </>
          }
        />
      )}

      {status === "case" && paymentCase && (
        <ConfirmationPanel
          variant={caseCopy(paymentCase).variant}
          title={caseCopy(paymentCase).title}
          bookingRef={ref}
          lead={caseCopy(paymentCase).lead}
          actions={
            <>
              <BkButton variant="dark" onClick={() => navigate("/contact")}>Contact us</BkButton>
              <BkButton variant="secondary" onClick={() => navigate("/bookings")}>My bookings</BkButton>
            </>
          }
        />
      )}

      {status === "error" && (
        <ConfirmationPanel
          variant="pending"
          title="We couldn't check your payment just now"
          bookingRef={ref}
          lead="This is a connection problem on our side or yours — it doesn't mean the payment failed. Please don't pay again; try checking again in a moment."
          actions={<BkButton variant="dark" onClick={() => { setStatus("checking"); setAttempt((n) => n + 1); }}>Check again</BkButton>}
        />
      )}

      {(status === "failed" || status === "notfound") && (
        <ConfirmationPanel
          variant="failed"
          title={status === "failed" ? "Payment didn't go through" : "We couldn't find that booking"}
          bookingRef={status === "failed" ? ref : null}
          lead={status === "failed" ? "No charge was made, and your place has been released." : "Check the link in your confirmation email, or look in My Life."}
          actions={<BkButton variant="dark" onClick={() => navigate(status === "failed" ? "/home" : "/bookings")}>{status === "failed" ? "Back home" : "My bookings"}</BkButton>}
        />
      )}
    </BookingSurface>
  );
}
