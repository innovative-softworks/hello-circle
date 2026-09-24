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
import { CheckIcon, ClockIcon } from "../components/icons";
import { ShareButton } from "../components/ShareButton";
import { dateLabel, euro } from "../euro";
import { colors, fonts } from "../theme";
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

  // The richer "what did I just book?" content only ever renders once the
  // transaction can be resolved safely — never during "checking"/"pending",
  // which keep their existing plain reference-number-only copy unchanged.
  const view = status === "paid" && ref && details ? viewFor(ref, details) : null;

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "64px 24px 90px", textAlign: "center" }}>
        {status === "checking" && (
          <>
            <div style={{ width: 74, height: 74, borderRadius: "50%", background: colors.panel, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px", color: colors.muted }}>
              <ClockIcon size={32} />
            </div>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 8px", letterSpacing: "-.02em" }}>Confirming your payment…</h1>
            <p style={{ color: colors.muted, fontSize: 16, lineHeight: 1.5 }}>This only takes a moment. Reference: <b style={{ color: colors.text }}>{ref}</b></p>
          </>
        )}

        {status === "paid" && (
          <>
            <div style={{ width: 74, height: 74, borderRadius: "50%", background: colors.greenBg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px", color: colors.green }}>
              <CheckIcon size={32} />
            </div>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 32, margin: "0 0 8px", letterSpacing: "-.02em" }}>You're all set!</h1>

            {view ? (
              <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 16, padding: "20px 22px", margin: "0 0 22px", textAlign: "left" }}>
                <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 19, marginBottom: 6 }}>{view.title}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 14, color: colors.muted }}>
                  {view.when && <span>{view.when}</span>}
                  {view.venue && <span>{view.venue}</span>}
                  {view.quantity && <span>{view.quantity}</span>}
                  <span>{euro((details?.totalCents ?? 0) / 100)} · Ref {ref}</span>
                </div>
              </div>
            ) : (
              <p style={{ color: colors.muted, fontSize: 16, lineHeight: 1.5, marginBottom: 28 }}>
                Payment confirmed and a receipt is on its way to your email. Reference: <b style={{ color: colors.text }}>{ref}</b>
              </p>
            )}

            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 12 }}>
              <button onClick={() => navigate(view?.manageHref ?? "/bookings")} style={{ background: colors.green, color: "#fff", border: "none", borderRadius: 12, padding: "13px 22px", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
                View booking
              </button>
              <button onClick={() => navigate("/home")} style={{ background: "#fff", color: colors.text, border: `1px solid ${colors.borderStrong}`, borderRadius: 12, padding: "13px 22px", fontWeight: 600, fontSize: 15, cursor: "pointer" }}>
                Explore more
              </button>
            </div>

            {view && (view.onAddToCalendar || view.shareEntity) && (
              <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                {view.onAddToCalendar && (
                  <button
                    onClick={() => view.onAddToCalendar!()}
                    style={{ background: "none", border: "none", padding: 0, color: colors.muted, fontSize: 13.5, fontWeight: 600, textDecoration: "underline", cursor: "pointer" }}
                  >
                    Add to calendar
                  </button>
                )}
                {view.shareEntity && <ShareButton entityType={view.shareEntity.type} entityId={view.shareEntity.id} variant="ghost" label="Share" />}
              </div>
            )}
          </>
        )}

        {status === "pending" && (
          <>
            <div style={{ width: 74, height: 74, borderRadius: "50%", background: colors.panel, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px", color: colors.muted }}>
              <ClockIcon size={32} />
            </div>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 8px", letterSpacing: "-.02em" }}>Still confirming</h1>
            <p style={{ color: colors.muted, fontSize: 16, lineHeight: 1.5, marginBottom: 28 }}>
              Your payment is taking a little longer to confirm than usual. It'll show up in "My Life" as soon as it's through — reference <b style={{ color: colors.text }}>{ref}</b>.
            </p>
            <button onClick={() => navigate("/bookings")} style={{ background: colors.green, color: "#fff", border: "none", borderRadius: 12, padding: "13px 22px", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
              Check my bookings
            </button>
          </>
        )}

        {(status === "failed" || status === "notfound") && (
          <>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 8px", letterSpacing: "-.02em" }}>We couldn't confirm that</h1>
            <p style={{ color: colors.muted, fontSize: 16, lineHeight: 1.5, marginBottom: 28 }}>
              {status === "failed" ? "That payment didn't go through — no charge was made." : "We couldn't find that booking reference."}
            </p>
            <button onClick={() => navigate("/home")} style={{ background: colors.green, color: "#fff", border: "none", borderRadius: 12, padding: "13px 22px", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
              Back home
            </button>
          </>
        )}
      </section>
    </div>
  );
}
