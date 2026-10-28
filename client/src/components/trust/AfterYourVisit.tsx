import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { checkReviewEligibility, fetchAttendancePlaces, requestAttendanceCorrection, type AttendancePlace, type ReviewEligibility, type ReviewListingType } from "../../api";
import { Button, LoadErrorState, Modal, Skeleton } from "../ui";
import "./trust.css";

// Trust & Retention — on a past booking: for each past place the person
// holds (one, or one per past programme session), what the organiser
// recorded, whether they've confirmed *this person* attended (what opens a
// review — see server/src/reviewEligibility.ts), and a way to ask them to.
// Everything shown comes from GET /api/attendance/places (server-scoped to the
// caller); nothing here decides eligibility itself.

export interface VisitInfo {
  /** booking | registration | experience | game | program (the enrolment ref). */
  placeKind: "booking" | "registration" | "experience" | "game" | "program";
  /** The booking/registration/enrolment ref, or the Session id. */
  ref: string;
  review: { listingType: ReviewListingType; listingId: string; href: string | null } | null;
  organiser: "venue" | "host" | "organiser" | "club";
}

const DAY = new Intl.DateTimeFormat("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" });
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function recordedLine(p: AttendancePlace, who: string, isProgramme: boolean): string {
  if (p.forSomeoneElse) {
    if (p.recorded === "present" || p.recorded === "late" || p.confirmed) return `${cap(who)} recorded attendance for the person you registered.`;
    if (p.recorded === "absent" || p.recorded === "no_show") return `${cap(who)} recorded the person you registered as missing a session.`;
    return `${cap(who)} hasn't recorded attendance for the person you registered.`;
  }
  if (p.confirmed) return `${cap(who)} confirmed you attended.`;
  if (p.recorded === "absent" || p.recorded === "no_show") return `${cap(who)} recorded this as missed.`;
  if (p.recorded === "present" || p.recorded === "late") {
    return isProgramme ? `${cap(who)}'s register shows this place as attended, but not who came.` : `${cap(who)} checked the booking in, but their record doesn't say who came.`;
  }
  return `${cap(who)} hasn't recorded attendance.`;
}

function requestLine(p: AttendancePlace, who: string): string | null {
  if (!p.request) return null;
  if (p.request.status === "open") return `You asked ${who} to confirm you attended — waiting for their reply.`;
  if (p.request.status === "accepted") return null; // covered by "confirmed"
  if (p.request.status === "withdrawn") return `${cap(who)} withdrew their confirmation${p.request.decisionNote ? `: “${p.request.decisionNote}”` : "."}`;
  return `${cap(who)} declined${p.request.decisionNote ? `: “${p.request.decisionNote}”` : "."}`;
}

export function AfterYourVisit({ info }: { info: VisitInfo }) {
  const uid = useId();
  const [places, setPlaces] = useState<AttendancePlace[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [eligibility, setEligibility] = useState<ReviewEligibility | null>(null);
  const [asking, setAsking] = useState<AttendancePlace | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const who = info.organiser === "venue" ? "the venue" : info.organiser === "club" ? "the club" : info.organiser === "host" ? "the host" : "the organiser";
  const isProgramme = info.placeKind === "program";

  const load = () => {
    setFailed(false);
    fetchAttendancePlaces(info.placeKind, info.ref)
      .then((r) => setPlaces(r.items))
      .catch(() => setFailed(true));
    if (info.review) checkReviewEligibility(info.review.listingType, info.review.listingId).then(setEligibility).catch(() => setEligibility(null));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [info.placeKind, info.ref]);

  const send = async () => {
    if (!asking) return;
    setBusy(true);
    setError(null);
    try {
      await requestAttendanceCorrection({ kind: asking.correctionKind, ref: asking.requestRef, note: note.trim() || undefined });
      setSent(`Sent. ${cap(who)} will be asked to confirm you attended${isProgramme ? ` on ${DAY.format(new Date(`${asking.date}T12:00:00Z`))}` : ""}.`);
      setAsking(null);
      setNote("");
      load();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Couldn't send your request. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const shell = (body: React.ReactNode) => (
    <section className="tr-section" aria-labelledby={`${uid}-h`} style={{ maxWidth: 608, margin: "8px auto 48px", width: "calc(100% - 32px)", boxSizing: "border-box" }}>
      <h2 id={`${uid}-h`}>After your visit</h2>
      {body}
    </section>
  );

  if (failed) return shell(<LoadErrorState title="We couldn't load your attendance." onRetry={load} />);
  if (!places) return shell(<Skeleton height={88} />);
  if (places.length === 0) return null; // nothing past to show yet

  const anyConfirmed = places.some((p) => p.confirmed);
  const occurrence = eligibility?.occurrences?.find((o) => o.ref === info.ref);
  const occurrenceReviewed = !!occurrence?.reviewed;
  const declined = places.find((p) => p.request?.status === "declined" && !p.confirmed);

  return shell(
    <>
      <p className="tr-note" style={{ marginBottom: 12 }}>
        Reviews come only from people the organiser confirms attended. {isProgramme ? "Each session is listed separately." : ""}
      </p>
      <ul className="tr-reviews" aria-label={isProgramme ? "Past sessions" : "Your visit"}>
        {places.map((p) => (
          <li key={p.requestRef} className="tr-review" style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ minWidth: 0, flex: "1 1 260px" }}>
              {isProgramme && <div className="tr-review-meta" style={{ fontWeight: 700, color: "var(--color-text)" }}>{DAY.format(new Date(`${p.date}T12:00:00Z`))}</div>}
              {/* The status leads; the booking title is already at the top of the page. */}
              <div className={`np-visit-state ${p.confirmed && !p.forSomeoneElse ? "is-review_available" : ""}`} style={{ fontSize: 15 }}>
                {p.forSomeoneElse
                  ? "Registered for someone else"
                  : p.confirmed
                    ? occurrenceReviewed
                      ? "Review submitted"
                      : "Attendance confirmed — you can review it"
                    : p.request?.status === "open"
                      ? "Confirmation pending"
                      : "Not confirmed yet"}
              </div>
              <div className="tr-review-meta" style={{ marginTop: 2 }}>
                {recordedLine(p, who, isProgramme)}
              </div>
              {requestLine(p, who) && (
                <div className="tr-review-meta" style={{ marginTop: 2 }} role="status">
                  {requestLine(p, who)}
                </div>
              )}
            </div>
            {p.canRequest && (
              <Button variant="ghost" onClick={() => setAsking(p)} aria-label={`Ask ${who} to confirm you attended${isProgramme ? ` on ${p.date}` : ""}`}>
                {p.request?.status === "declined" || p.request?.status === "withdrawn" ? "Ask again" : "Ask to confirm"}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div aria-live="polite">{sent && <p className="tr-ok" style={{ marginTop: 12 }}>{sent}</p>}</div>
      <dl className="tr-facts" style={{ marginTop: 16 }}>
        <dt>Review</dt>
        <dd>
          {eligibility?.reason === "guardian" || places.every((p) => p.forSomeoneElse) ? (
            "Reviews are for people who took part themselves. Feedback from parents and guardians isn't available yet."
          ) : occurrence && !occurrence.reviewed && info.review?.href ? (
            <Link to={`${info.review.href}#reviews`}>Review this {isProgramme ? "programme" : "visit"}</Link>
          ) : occurrence?.reviewed ? (
            "You've reviewed this. You can edit or delete it on the listing."
          ) : anyConfirmed && !info.review?.href ? (
            "Confirmed — reviews for this listing open when its page is public."
          ) : (
            "Opens once the organiser confirms you attended."
          )}
        </dd>
        {declined && (
          <>
            <dt>Disagree?</dt>
            <dd>
              <Link to={`/complaints?kind=complaint&subject=booking&ref=${encodeURIComponent(info.ref)}`}>Ask HelloCircle to look at it</Link>
            </dd>
          </>
        )}
      </dl>
      <Modal
        open={!!asking}
        onClose={() => setAsking(null)}
        title="Ask to confirm you attended"
        subtitle={`${cap(who)} sees your request and decides. If they decline, you can ask HelloCircle to look at it.`}
        footer={
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={() => setAsking(null)}>
              Cancel
            </Button>
            <Button onClick={send} disabled={busy}>
              {busy ? "Sending…" : "Send request"}
            </Button>
          </div>
        }
      >
        {asking && isProgramme && <p className="tr-note" style={{ marginBottom: 10 }}>Session on {DAY.format(new Date(`${asking.date}T12:00:00Z`))}</p>}
        <label className="tr-label" htmlFor={`${uid}-note`}>
          Anything that helps them check <span className="tr-muted" style={{ fontWeight: 400 }}>(optional)</span>
        </label>
        <textarea id={`${uid}-note`} className="tr-input" rows={3} maxLength={1500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: I was the lead booker and arrived at 10" />
        <div aria-live="assertive">{error && <p className="tr-alert" style={{ marginTop: 10 }}>{error}</p>}</div>
      </Modal>
    </>
  );
}
