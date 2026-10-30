import { useEffect, useState } from "react";
import { PAID_CLOSED_MESSAGE, usePaidCheckoutOpen } from "../paidCheckout";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FormQuestions, type AnswersDraft } from "../components/experience/AttendeeFields";
import { missingAnswers, withDefaults } from "../components/experience/attendeeSlots";
import { ApiError, createBookingCheckout, fetchAvailability, fetchAvailabilityRange, fetchCentre, fetchCentres, quoteVenueBooking, type VenueBookingQuote } from "../api";
import { openCheckout } from "../native";
import {
  Acknowledgement,
  BkButton,
  BkNumberStepper,
  BkTextField,
  BookingShell,
  BookingSurface,
  ChoiceChips,
  ConfirmationPanel,
  ContactConfirm,
  CouponField,
  DateSlotPicker,
  HoldNotice,
  ListingSummary,
  PolicySummary,
  QuoteSummary,
  SubmitBar,
  bk,
  formatCents,
  payLabel,
  useBookingDraft,
  useQuote,
  type ContactValue,
} from "../components/booking";
import { PageSpinner } from "../components/ui";
import { Pass, passDate } from "../components/pass/Pass";
import { DURATION_OPTIONS, EVENT_TYPES, TIME_SLOTS } from "../constants";
import { dateLabel } from "../euro";
import { useGuest } from "../GuestContext";
import { addDays, irelandToday } from "../irelandDate";
import { fallbackCopy } from "../copy";
import type { Centre, Room } from "../types";
import { isValidEmail } from "../validate";

// Venue / room booking (UX plan S1), on the shared booking kit. The price is
// only ever the server's quote (POST /api/bookings/quote — the same code that
// prices checkout); this page never computes VAT, fees or totals.

interface BookingDraft {
  roomId: string | null;
  date: string | null;
  time: string | null;
  duration: number;
  eventType: string | null;
  guests: number;
  contact: ContactValue;
  notes: string;
  couponCode: string | null;
  /** Open Booking — hidden unless the platform switch and the org flag are on (centre.openBookingEnabled). */
  openSpots: string;
  confirmationDeadline: string;
  minParticipants: string;
}

const blankDraft = (): BookingDraft => ({
  roomId: null,
  date: null,
  time: null,
  duration: 3,
  eventType: null,
  guests: 1,
  contact: { name: "", email: "", phone: "" },
  notes: "",
  couponCode: null,
  openSpots: "",
  confirmationDeadline: "",
  minParticipants: "",
});

type StepKey = "room" | "when" | "details" | "review";
const STEP_LABEL: Record<StepKey, string> = { room: "Room", when: "Date and time", details: "Details", review: "Review" };

/** "Sat 24 Oct · 17:00–20:00" — display only; the server validates hours. */
function whenLabel(date: string | null, time: string | null, duration: number): string | null {
  if (!date) return null;
  if (!time) return dateLabel(date);
  const end = parseInt(time.slice(0, 2), 10) + duration;
  return `${dateLabel(date)} · ${time}–${String(end % 24).padStart(2, "0")}:00`;
}

function detailsErrors(d: BookingDraft, room: Room | undefined): Partial<Record<"eventType" | "guests" | "name" | "email" | "phone", string>> {
  const e: Partial<Record<"eventType" | "guests" | "name" | "email" | "phone", string>> = {};
  if (!d.eventType) e.eventType = "Choose what the booking is for";
  if (!Number.isInteger(d.guests) || d.guests < 1) e.guests = "Enter how many people are coming";
  else if (room && room.cap > 0 && d.guests > room.cap) e.guests = `This room holds up to ${room.cap}`;
  if (!d.contact.name.trim()) e.name = "Enter your name";
  if (!isValidEmail(d.contact.email)) e.email = "Enter an email like name@example.ie";
  if (!d.contact.phone.trim()) e.phone = "Enter a phone number the venue can reach you on";
  return e;
}

export function BookingFlow() {
  const paidOpen = usePaidCheckoutOpen();
  const { centreId } = useParams<{ centreId: string }>();
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [centre, setCentre] = useState<Centre | null>(null);
  const [loadError, setLoadError] = useState(false);
  const { value: draft, setValue: setDraft, clear: clearDraft } = useBookingDraft<BookingDraft>(`venue:${centreId ?? ""}`, blankDraft());
  const [stepIndex, setStepIndex] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [slots, setSlots] = useState<string[]>(TIME_SLOTS);
  const [bookedTimes, setBookedTimes] = useState<string[]>([]);
  const [dayClosed, setDayClosed] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [closedDates, setClosedDates] = useState<Set<string>>(new Set());
  // Phase H — the venue's booking questions (asked once per booking; none = the usual form).
  const [answers, setAnswers] = useState<AnswersDraft>({ booking: {}, attendees: [] });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Booking failure/recovery (IA spec §6) — real alternatives, fetched only once an error occurs.
  const [similarCentres, setSimilarCentres] = useState<Centre[] | null>(null);
  const [confirmed, setConfirmed] = useState<{ ref: string; totalCents: number; email: string } | null>(null);

  const set = <K extends keyof BookingDraft>(k: K, v: BookingDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  useEffect(() => {
    if (!centreId) return;
    fetchCentre(centreId)
      .then(setCentre)
      .catch(() => setLoadError(true));
  }, [centreId]);

  // A single-room centre skips the room step; a saved draft's room must still exist.
  useEffect(() => {
    if (!centre) return;
    const stillThere = centre.rooms.some((r) => r.id === draft.roomId);
    if (centre.rooms.length === 1 && draft.roomId !== centre.rooms[0].id) set("roomId", centre.rooms[0].id);
    else if (draft.roomId && !stillThere) set("roomId", null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centre]);

  const room: Room | undefined = centre?.rooms.find((r) => r.id === draft.roomId);
  const roomId = room?.id;
  const steps: StepKey[] = centre && centre.rooms.length > 1 ? ["room", "when", "details", "review"] : ["when", "details", "review"];
  const step = steps[Math.min(stepIndex, steps.length - 1)];

  const today = irelandToday();
  const minDate = addDays(today, 1);
  const maxDate = addDays(today, 60);

  useEffect(() => {
    if (centreId && roomId) fetchAvailabilityRange(centreId, roomId, today, 62).then((r) => setClosedDates(new Set(r.closedDates))).catch(() => {});
  }, [centreId, roomId, today]);

  useEffect(() => {
    if (!centreId || !roomId || !draft.date) return;
    setLoadingSlots(true);
    fetchAvailability(centreId, roomId, draft.date, draft.duration)
      .then((r) => {
        setBookedTimes(r.bookedTimes);
        setSlots(r.slots);
        setDayClosed(r.closed);
        // A longer duration can make the picked start time clash — clear it so it's re-picked.
        setDraft((d) => (d.time && r.bookedTimes.includes(d.time) ? { ...d, time: null } : d));
      })
      .catch(() => {})
      .finally(() => setLoadingSlots(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centreId, roomId, draft.date, draft.duration]);

  // The price follows every input that changes it. Guests don't change the
  // price (they're checked against the room's capacity), so a blank count
  // is quoted as 1 to show the price as soon as a slot is picked.
  const quote = useQuote<VenueBookingQuote>(
    () =>
      quoteVenueBooking({
        centreId: centreId!,
        roomId: roomId!,
        date: draft.date!,
        time: draft.time!,
        duration: draft.duration,
        guests: Math.max(1, draft.guests || 1),
        couponCode: draft.couponCode ?? undefined,
      }),
    [centreId, roomId, draft.date, draft.time, draft.duration, draft.guests, draft.couponCode],
    { enabled: !!(centreId && roomId && draft.date && draft.time) }
  );
  const priced = quote.status === "ready" ? quote.quote : null;

  const fieldErrors = detailsErrors(draft, room);
  const formQs = centre?.registrationForm?.questions ?? [];
  const sendAnswers = withDefaults(formQs, [], answers);
  const missing = formQs.length ? missingAnswers(formQs, [], sendAnswers) : [];
  const stepProblems = (k: StepKey): string[] => {
    if (k === "room") return roomId ? [] : ["Choose a room"];
    if (k === "when") return draft.date && draft.time ? [] : [draft.date ? "Choose a start time" : "Choose a date"];
    if (k === "details") return [...(Object.values(fieldErrors) as string[]), ...missing.map((m) => m.message)];
    if (!agreed) return ["Tick the box to agree to the booking terms"];
    if (!priced) return [quote.status === "error" ? "We couldn't price this booking — try again" : "Wait for the price to load"];
    return [];
  };

  const top = () => window.scrollTo({ top: 0, behavior: "smooth" });
  const goTo = (k: StepKey) => {
    setStepIndex(steps.indexOf(k));
    setAttempted(false);
    top();
  };

  const submit = async () => {
    if (!centreId || !roomId || !draft.date || !draft.time || !draft.eventType) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await createBookingCheckout({
        centreId,
        roomId,
        date: draft.date,
        time: draft.time,
        duration: draft.duration,
        eventType: draft.eventType,
        guests: draft.guests,
        name: draft.contact.name.trim(),
        email: draft.contact.email.trim(),
        phone: draft.contact.phone.trim(),
        notes: draft.notes,
        couponCode: draft.couponCode ?? undefined,
        openSpots: resident && draft.openSpots ? Number(draft.openSpots) : undefined,
        confirmationDeadline: resident && draft.openSpots && draft.confirmationDeadline ? new Date(draft.confirmationDeadline).toISOString() : undefined,
        minParticipants: resident && draft.openSpots && draft.minParticipants ? Number(draft.minParticipants) : undefined,
        acceptedTerms: agreed,
        ...(formQs.length ? { answers: sendAnswers, questionsVersion: centre?.registrationForm?.questionsVersion } : {}),
      });
      clearDraft();
      if (res.url) {
        openCheckout(res.url);
        return;
      }
      // Cash room: confirmed now. The total shown is the server's recorded one.
      setConfirmed({ ref: res.ref, totalCents: Math.round(res.totalEuro * 100), email: draft.contact.email.trim() });
      setSubmitting(false);
      top();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallbackCopy.generic);
      setSubmitting(false);
      // The venue changed its questions since the page loaded: show the new ones.
      if (e instanceof ApiError && (e.body.code === "questions_changed" || e.body.code === "form_required") && centreId) fetchCentre(centreId).then(setCentre).catch(() => {});
      if (centre) {
        fetchCentres(centre.county)
          .then((rows) => setSimilarCentres(rows.filter((c) => c.id !== centre.id).slice(0, 3)))
          .catch(() => setSimilarCentres([]));
      }
    }
  };

  const next = () => {
    setAttempted(true);
    if (stepProblems(step).length > 0) return;
    if (step === "review") return void submit();
    setStepIndex((i) => i + 1);
    setAttempted(false);
    top();
  };
  const back = () => {
    if (stepIndex > 0) {
      setStepIndex((i) => i - 1);
      setAttempted(false);
      top();
    } else navigate(`/centres/${centre?.slug ?? centreId}`);
  };

  const title = centre ? `${centre.name}${room && centre.rooms.length > 1 ? ` · ${room.name}` : ""}` : "";
  const when = whenLabel(draft.date, draft.time, draft.duration);
  // Guests/purpose only once they've been asked for — not the form's defaults.
  const reachedDetails = steps.indexOf(step) >= steps.indexOf("details");
  const details = reachedDetails ? [`${draft.guests} ${draft.guests === 1 ? "guest" : "guests"}`, draft.eventType].filter(Boolean).join(" · ") : null;

  const summary = centre && (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <ListingSummary title={title} when={when} details={details} imageUrl={centre.image || null} />
      {roomId && <QuoteSummary state={quote} subtotalLabel={`Hall hire · ${DURATION_OPTIONS.find((o) => o.hours === draft.duration)?.label ?? `${draft.duration} hours`}`} onRetry={quote.retry} emptyHint="Pick a date and time to see the price." />}
      {priced && <PolicySummary cancelDeadline={priced.cancelDeadline} depositCents={priced.depositCents} />}
    </div>
  );

  if (loadError) {
    return (
      <BookingSurface page>
        <ConfirmationPanel variant="failed" title="We couldn't load this venue" lead="Check your connection and try again." actions={<BkButton variant="secondary" onClick={() => window.location.reload()}>Try again</BkButton>} />
      </BookingSurface>
    );
  }
  if (!centre) return <PageSpinner />;

  if (confirmed) {
    return (
      <BookingSurface page>
        <ConfirmationPanel
          variant="success"
          lead={`Pay ${formatCents(confirmed.totalCents)} at the venue — nothing is charged online. We've emailed the details to ${confirmed.email}.`}
          summary={
            // The pass, ticket look (owner 2026-10-27): show the reference at the desk.
            <Pass
              look="ticket"
              kind="room"
              tone="ok"
              status="Booked · pay at the venue"
              title={room && centre.rooms.length > 1 ? room.name : centre.name}
              who={draft.contact.name.trim() || null}
              date={draft.date ? passDate(draft.date) : null}
              time={when?.split(" · ")[1] ?? null}
              where={centre.name}
              fields={[
                ["Guests", String(draft.guests)],
                ["Pay", `${formatCents(confirmed.totalCents)} at the desk`],
              ]}
              reference={confirmed.ref}
            />
          }
          actions={
            <>
              <BkButton variant="dark" onClick={() => navigate("/bookings")}>View my bookings</BkButton>
              <BkButton variant="secondary" onClick={() => navigate("/home")}>Back home</BkButton>
            </>
          }
        >
          {priced && <PolicySummary cancelDeadline={priced.cancelDeadline} />}
        </ConfirmationPanel>
      </BookingSurface>
    );
  }

  const problems = attempted ? stepProblems(step) : [];
  const showFieldErrors = attempted && step === "details";
  const primaryLabel = step === "review" ? (priced ? payLabel(priced) : "Pay") : "Continue";
  // Commercial release gate — a card payment can't start while paid checkout is closed (the server refuses it too).
  const paidClosed = paidOpen === false && !!priced && !priced.payAtVenue && priced.totalCents > 0;

  return (
    <BookingSurface page>
      <BookingShell
        steps={steps.map((k) => STEP_LABEL[k])}
        current={steps.indexOf(step) + 1}
        title={step === "room" ? "Which room?" : step === "when" ? "When do you need it?" : step === "details" ? "Who's coming?" : "Review and pay"}
        onBack={back}
        backLabel={stepIndex > 0 ? "Back a step" : `Back to ${centre.name}`}
        errors={problems}
        summary={summary}
        submitBar={
          <SubmitBar note={paidClosed ? <span role="status">{PAID_CLOSED_MESSAGE}</span> : step === "review" ? (priced?.payAtVenue ? "You'll pay at the venue — nothing is charged online." : <HoldNotice />) : undefined}>
            <BkButton full onClick={next} busy={submitting} busyLabel={priced?.payAtVenue ? "Confirming…" : "Starting payment…"} disabled={(step === "review" && (!priced || !agreed)) || (step === "review" && paidClosed)}>
              {primaryLabel}
            </BkButton>
          </SubmitBar>
        }
      >
        {step === "room" && (
          <ChoiceChips
            legend="Rooms at this venue"
            value={draft.roomId}
            onChange={(id) => setDraft((d) => ({ ...d, roomId: id, time: null }))}
            options={centre.rooms.map((r) => ({
              value: r.id,
              label: `${r.name} · €${r.rate}/hour`,
              hint: `Up to ${r.cap} guests${r.paymentMethod === "cash" ? " · pay at the venue" : ""}${r.desc ? ` · ${r.desc}` : ""}`,
            }))}
          />
        )}

        {step === "when" && (
          <>
            <ChoiceChips legend="How long?" value={draft.duration} onChange={(h) => setDraft((d) => ({ ...d, duration: h }))} options={DURATION_OPTIONS.map((o) => ({ value: o.hours, label: o.label }))} />
            <DateSlotPicker
              minDate={minDate}
              maxDate={maxDate}
              closedDates={closedDates}
              date={draft.date}
              onDate={(iso) => setDraft((d) => ({ ...d, date: iso, time: null }))}
              slots={slots}
              bookedTimes={bookedTimes}
              dayClosed={dayClosed}
              time={draft.time}
              onTime={(t) => set("time", t)}
              loadingSlots={loadingSlots}
            />
          </>
        )}

        {step === "details" && (
          <>
            <BkNumberStepper
              label="Expected guests"
              value={draft.guests}
              onChange={(n) => set("guests", n)}
              min={1}
              max={room && room.cap > 0 ? room.cap : undefined}
              helper={room && room.cap > 0 ? `This room holds up to ${room.cap}.` : undefined}
              error={showFieldErrors ? fieldErrors.guests : undefined}
            />
            <div>
              <ChoiceChips legend="What's it for?" value={draft.eventType} onChange={(v) => set("eventType", v)} options={EVENT_TYPES.map((e) => ({ value: e, label: e }))} />
              {showFieldErrors && fieldErrors.eventType && <div style={{ fontSize: 13, fontWeight: 600, color: bk.danger, marginTop: 8 }}>{fieldErrors.eventType}</div>}
            </div>
            <ContactConfirm
              value={draft.contact}
              onChange={(c) => set("contact", c)}
              identity={resident ? { name: resident.name, email: resident.email } : null}
              askPhone
              phoneRequired
              errors={showFieldErrors ? { name: fieldErrors.name, email: fieldErrors.email, phone: fieldErrors.phone } : {}}
            />
            <BkTextField label="Anything the venue should know?" value={draft.notes} onChange={(v) => set("notes", v)} helper="Setup, catering or accessibility needs." maxLength={500} />
            {formQs.length > 0 && (
              <FormQuestions
                questions={formQs}
                answers={answers}
                onAnswers={setAnswers}
                person={null}
                title="A few questions from the venue"
                fe={{
                  control: (id: string) => ({ id, "aria-invalid": showFieldErrors && missing.some((m) => m.fieldId === id) ? true : undefined }),
                  messageFor: (id: string) => (showFieldErrors ? missing.find((m) => m.fieldId === id)?.message : undefined),
                  clearField: () => undefined,
                }}
              />
            )}

            {resident && centre.openBookingEnabled && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 16, background: bk.panel }}>
                <ChoiceChips
                  legend="Playing privately, or looking for more players?"
                  value={draft.openSpots ? "open" : "private"}
                  onChange={(v) => set("openSpots", v === "open" ? draft.openSpots || "1" : "")}
                  options={[{ value: "private", label: "Private" }, { value: "open", label: "Open spots" }]}
                />
                {draft.openSpots && (
                  <>
                    <BkNumberStepper label="Spots to open" value={Number(draft.openSpots)} onChange={(n) => set("openSpots", String(n))} min={1} max={20} helper="Other residents can find and join this booking once it's confirmed." />
                    <BkTextField label="Confirm by" type="datetime-local" value={draft.confirmationDeadline} onChange={(v) => set("confirmationDeadline", v)} helper="Shown on the listing as a target — not enforced." />
                    <BkTextField label="Players needed before it's confirmed" inputMode="numeric" value={draft.minParticipants} onChange={(v) => set("minParticipants", v.replace(/\D/g, ""))} />
                  </>
                )}
              </div>
            )}
          </>
        )}

        {step === "review" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 15 }}>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0, textTransform: "uppercase", color: bk.muted }}>Booking as</div>
              <div style={{ fontWeight: 600 }}>{draft.contact.name}</div>
              <div style={{ color: bk.muted }}>
                {draft.contact.email} · {draft.contact.phone}
              </div>
              <BkButton variant="quiet" onClick={() => goTo("details")} style={{ alignSelf: "flex-start" }}>
                Change details
              </BkButton>
            </div>
            <CouponField
              applied={draft.couponCode}
              onApply={async (code) => {
                // Ask the server about the code with this exact booking; it
                // only sticks if the server prices it.
                await quoteVenueBooking({ centreId: centreId!, roomId: roomId!, date: draft.date!, time: draft.time!, duration: draft.duration, guests: Math.max(1, draft.guests || 1), couponCode: code });
                set("couponCode", code);
              }}
              onRemove={() => set("couponCode", null)}
            />
            <Acknowledgement checked={agreed} onChange={setAgreed} error={attempted && !agreed ? "Tick this to continue" : undefined}>
              I agree to the <Link to="/policies/customer-booking-terms" target="_blank">booking terms</Link> and the <Link to="/policies/cancellation-refunds" target="_blank">cancellation policy</Link>
            </Acknowledgement>
            {error && similarCentres && similarCentres.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <BkButton variant="secondary" onClick={() => goTo("when")} style={{ alignSelf: "flex-start" }}>
                  Pick another time
                </BkButton>
                <div style={{ fontSize: 14, color: bk.soft }}>Or try somewhere nearby:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {similarCentres.map((c) => (
                    <BkButton key={c.id} variant="secondary" onClick={() => navigate(`/centres/${c.slug ?? c.id}`)}>
                      {c.name}
                    </BkButton>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        {error && <div role="alert" style={{ color: bk.danger, fontWeight: 600 }}>{error}</div>}
      </BookingShell>
    </BookingSurface>
  );
}
