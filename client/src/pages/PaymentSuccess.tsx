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
} from "../api";
import { useMyStuff } from "../MyStuffContext";
import { BkButton, BookingSurface, ConfirmationPanel, ListingSummary, PolicySummary, formatCents } from "../components/booking";
import { ShareButton } from "../components/ShareButton";
import { dateLabel } from "../euro";
import type {
  BookingConfirmation,
  ExperienceBookingConfirmation,
  GameJoinConfirmation,
  PassConfirmation,
  ProgramEnrollmentConfirmation,
  RegistrationConfirmation,
} from "../types";

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
      manageHref: `/bookings?ref=${b.ref}`,
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
      manageHref: `/bookings?ref=${r.ref}`,
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
      manageHref: `/games/${g.gameId}`,
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
      manageHref: `/experiences/${e.experienceId}`,
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
      manageHref: `/programs/${p.programId}`,
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

export function PaymentSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useMyStuff();
  const ref = searchParams.get("ref");
  const [status, setStatus] = useState<"checking" | "paid" | "pending" | "failed" | "notfound">("checking");
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
          if (r.paymentStatus === "paid") {
            setDetails(r);
            setStatus("paid");
            refresh();
          } else if (r.paymentStatus === "failed") {
            setStatus("failed");
          } else if (attempts.current < MAX_ATTEMPTS) {
            attempts.current += 1;
            setTimeout(poll, POLL_MS);
          } else {
            setStatus("pending");
          }
        })
        .catch(() => !cancelled && setStatus("notfound"));
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [ref, refresh]);

  // Never says "booked" before the server does: the rich summary renders only
  // once the poll has returned paid (Booking UX Phase 3, on the booking kit).
  const view = status === "paid" && ref && details ? viewFor(ref, details) : null;
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
          bookingRef={ref}
          lead={details ? `Paid ${formatCents(details.totalCents)}. A receipt is on its way to your email.` : "Payment confirmed. A receipt is on its way to your email."}
          summary={view && <ListingSummary title={view.title} when={view.when} details={[view.venue, view.quantity].filter(Boolean).join(" · ") || null} />}
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
