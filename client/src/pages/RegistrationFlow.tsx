import { useEffect, useState } from "react";
import { PAID_CLOSED_MESSAGE, usePaidCheckoutOpen } from "../paidCheckout";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FormQuestions, type AnswersDraft } from "../components/experience/AttendeeFields";
import { missingAnswers, withDefaults } from "../components/experience/attendeeSlots";
import { ApiError, createRegistrationCheckout, fetchClub, fetchClubSessions, fetchHousehold, fetchMyPasses, joinClubWaitlist, quoteRegistration } from "../api";
import { openCheckout } from "../native";
import {
  Acknowledgement,
  BkButton,
  BkTextField,
  BookingShell,
  BookingSurface,
  ChoiceChips,
  ConfirmationPanel,
  ContactConfirm,
  CouponField,
  ListingSummary,
  PolicySummary,
  QuoteSummary,
  SubmitBar,
  bk,
  bkRadius,
  formatCents,
  payLabel,
  useBookingDraft,
  useQuote,
  type ContactValue,
} from "../components/booking";
import { PageSpinner } from "../components/ui";
import { colors } from "../theme";
import { Pass as PassCard } from "../components/pass/Pass";
import { AGE_GROUPS } from "../constants";
import { useGuest } from "../GuestContext";
import { useMyStuff } from "../MyStuffContext";
import { priceLabel } from "../priceLabel";
import { fallbackCopy } from "../copy";
import type { Club, ClubSession, HouseholdMember, Pass } from "../types";
import { isValidEmail } from "../validate";

// Club registration (UX plan S2), on the shared booking kit. The price is the
// server's quote (POST /api/registrations/quote — the same code that prices
// checkout); this page never computes VAT, fees or totals. A free trial is
// only offered when the club offers one (the server enforces it too, once per
// participant). No home address is asked for (audit §C, data minimisation).

interface RegDraft {
  registrantType: "child" | "adult";
  first: string;
  last: string;
  dob: string;
  team: string | null;
  contact: ContactValue;
  ecName: string;
  ecPhone: string;
  ecRel: string;
  sessionId: string | null;
  option: "pay" | "trial" | "pass";
  couponCode: string | null;
}

const blankDraft = (): RegDraft => ({
  registrantType: "child",
  first: "",
  last: "",
  dob: "",
  team: null,
  contact: { name: "", email: "", phone: "" },
  ecName: "",
  ecPhone: "",
  ecRel: "",
  sessionId: null,
  option: "pay",
  couponCode: null,
});

type StepKey = "who" | "contacts" | "review";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const sessionLabel = (s: ClubSession) => `${DAY_NAMES[s.dayOfWeek] ?? "?"} ${s.time}${s.label ? ` · ${s.label}` : ""}`;

/** "Mary Anne O'Brien" → ["Mary Anne", "O'Brien"] — the API stores guardian first/last separately. */
function splitName(full: string): [string, string] {
  const t = full.trim().replace(/\s+/g, " ");
  const i = t.lastIndexOf(" ");
  return i > 0 ? [t.slice(0, i), t.slice(i + 1)] : [t, ""];
}

type FieldKey = "first" | "last" | "dob" | "team" | "name" | "email" | "phone" | "ecName" | "ecPhone";

function errorsFor(step: StepKey, d: RegDraft): Partial<Record<FieldKey, string>> {
  const e: Partial<Record<FieldKey, string>> = {};
  const isAdult = d.registrantType === "adult";
  if (step === "who") {
    if (!d.first.trim()) e.first = "Enter a first name";
    if (!d.last.trim()) e.last = "Enter a last name";
    if (!isAdult) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.dob)) e.dob = "Enter a date of birth";
      if (!d.team) e.team = "Choose an age group";
    }
  }
  if (step === "contacts") {
    if (!isAdult && !d.contact.name.trim()) e.name = "Enter your name";
    if (!isValidEmail(d.contact.email)) e.email = "Enter an email like name@example.ie";
    if (!d.contact.phone.trim()) e.phone = "Enter a phone number the club can reach you on";
    if (!isAdult && !d.ecName.trim()) e.ecName = "Enter an emergency contact";
    if (!isAdult && !d.ecPhone.trim()) e.ecPhone = "Enter their phone number";
  }
  return e;
}

export function RegistrationFlow() {
  const paidOpen = usePaidCheckoutOpen();
  const { clubId } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const { refresh } = useMyStuff();
  const { email: guestEmail, resident } = useGuest();
  const [club, setClub] = useState<Club | null>(null);
  const [loadError, setLoadError] = useState(false);
  const { value: draft, setValue: setDraft, clear: clearDraft } = useBookingDraft<RegDraft>(`club:${clubId ?? ""}`, blankDraft());
  const [consent, setConsent] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const [household, setHousehold] = useState<HouseholdMember[]>([]);
  const [sessions, setSessions] = useState<ClubSession[]>([]);
  const [usablePass, setUsablePass] = useState<Pass | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 409 { full: true } — offer the waitlist instead of a dead end.
  const [clubFull, setClubFull] = useState(false);
  const [waitlisted, setWaitlisted] = useState(false);
  const [waitlistJoining, setWaitlistJoining] = useState(false);
  const [confirmed, setConfirmed] = useState<{ ref: string; totalCents: number; option: RegDraft["option"]; payAtVenue: boolean; email: string } | null>(null);

  const set = <K extends keyof RegDraft>(k: K, v: RegDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const isAdult = draft.registrantType === "adult";
  // Phase H — the club's own registration questions (none = the usual form, unchanged).
  const [answers, setAnswers] = useState<AnswersDraft>({ booking: {}, attendees: [{}] });
  const formQs = club?.registrationForm?.questions ?? [];
  const formPerson = { name: `${draft.first} ${draft.last}`.trim(), personType: isAdult ? ("adult" as const) : ("child" as const) };
  const formPeople = [{ ...formPerson, guardian: "" as const }];
  const sendAnswers = withDefaults(formQs, formPeople, answers);
  const missing = formQs.length ? missingAnswers(formQs, formPeople, sendAnswers) : [];

  useEffect(() => {
    if (!clubId) return;
    fetchClub(clubId)
      .then((c) => {
        setClub(c);
        if (c.audience === "adults") set("registrantType", "adult");
        else if (c.audience === "kids") set("registrantType", "child");
        // A saved "trial" choice can't survive a club that no longer offers one.
        if (!c.trial) setDraft((d) => (d.option === "trial" ? { ...d, option: "pay" } : d));
      })
      .catch(() => setLoadError(true));
    fetchClubSessions(clubId).then(setSessions).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId]);

  // Household picker — only useful when signed in.
  useEffect(() => {
    if (guestEmail) fetchHousehold().then(setHousehold).catch(() => {});
  }, [guestEmail]);

  // Pass redemption — only when the resident holds a pass with credits for this club.
  useEffect(() => {
    if (!guestEmail || !clubId) return;
    fetchMyPasses()
      .then((passes) => setUsablePass(passes.find((p) => p.listingId === clubId && p.creditsUsed < p.creditsTotal) ?? null))
      .catch(() => setUsablePass(null));
  }, [guestEmail, clubId]);

  // An adult registering themselves, signed in: their own name is the participant's.
  useEffect(() => {
    if (isAdult && resident && !draft.first && !draft.last) {
      const [f, l] = splitName(resident.name);
      setDraft((d) => ({ ...d, first: f, last: l }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdult, resident?.name]);

  const steps: StepKey[] = ["who", "contacts", "review"];
  const step = steps[stepIndex];
  const usingPass = draft.option === "pass" && !!usablePass;

  const quote = useQuote(() => quoteRegistration({ clubId: clubId!, trial: draft.option === "trial", couponCode: draft.option === "pay" ? draft.couponCode ?? undefined : undefined }), [clubId, draft.option, draft.couponCode], {
    enabled: !!club && !usingPass,
  });
  const priced = quote.status === "ready" ? quote.quote : null;

  const fieldErrors = attempted ? errorsFor(step, draft) : {};
  const stepProblems = (k: StepKey): string[] => {
    if (k !== "review") return Object.values(errorsFor(k, draft)) as string[];
    const p: string[] = [];
    if (sessions.length > 0 && !draft.sessionId) p.push("Choose a session");
    for (const m of missing) p.push(m.message);
    if (!consent) p.push("Tick the consent box to continue");
    if (!usingPass && !priced) p.push(quote.status === "error" ? "We couldn't price this registration — try again" : "Wait for the price to load");
    return p;
  };

  const top = () => window.scrollTo({ top: 0, behavior: "smooth" });

  const submit = async () => {
    if (!clubId) return;
    setError(null);
    setClubFull(false);
    setSubmitting(true);
    const [gFirst, gLast] = isAdult ? [draft.first.trim(), draft.last.trim()] : splitName(draft.contact.name);
    try {
      const res = await createRegistrationCheckout({
        clubId,
        registrantType: draft.registrantType,
        team: isAdult ? undefined : draft.team ?? undefined,
        childFirst: draft.first.trim(),
        childLast: draft.last.trim(),
        dob: isAdult ? undefined : draft.dob,
        gFirst,
        gLast,
        email: draft.contact.email.trim(),
        phone: draft.contact.phone.trim(),
        address: "",
        ecName: draft.ecName.trim() || undefined,
        ecPhone: draft.ecPhone.trim() || undefined,
        ecRel: draft.ecRel.trim() || undefined,
        consent,
        trial: draft.option === "trial",
        couponCode: draft.option === "pay" ? draft.couponCode ?? undefined : undefined,
        sessionId: draft.sessionId ?? undefined,
        passId: usingPass ? usablePass!.id : undefined,
        acceptedTerms: consent,
        ...(formQs.length ? { answers: sendAnswers, questionsVersion: club?.registrationForm?.questionsVersion } : {}),
      });
      clearDraft();
      if (res.url) {
        openCheckout(res.url);
        return;
      }
      setConfirmed({ ref: res.ref, totalCents: Math.round(res.totalEuro * 100), option: draft.option, payAtVenue: !!priced?.payAtVenue, email: draft.contact.email.trim() });
      refresh();
      top();
    } catch (e) {
      if (e instanceof ApiError && e.body.full) setClubFull(true);
      else setError(e instanceof Error ? e.message : fallbackCopy.generic);
      // The club changed its questions since the page loaded: show the new ones.
      if (e instanceof ApiError && (e.body.code === "questions_changed" || e.body.code === "form_required") && clubId) fetchClub(clubId).then(setClub).catch(() => {});
    } finally {
      setSubmitting(false);
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
    } else navigate(`/clubs/${club?.slug ?? clubId}`);
  };

  const joinWaitlist = async () => {
    if (!clubId) return;
    setWaitlistJoining(true);
    try {
      await joinClubWaitlist(clubId, { name: draft.contact.name.trim() || `${draft.first} ${draft.last}`.trim(), email: draft.contact.email.trim() });
      setWaitlisted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join the waitlist");
    } finally {
      setWaitlistJoining(false);
    }
  };

  if (loadError) {
    return (
      <BookingSurface page>
        <ConfirmationPanel variant="failed" title="We couldn't load this club" lead="Check your connection and try again." actions={<BkButton variant="secondary" onClick={() => window.location.reload()}>Try again</BkButton>} />
      </BookingSurface>
    );
  }
  if (!club) return <PageSpinner />;

  const participant = `${draft.first} ${draft.last}`.trim();
  const session = sessions.find((s) => s.id === draft.sessionId);
  const listing = (
    <ListingSummary
      title={club.name}
      when={session ? sessionLabel(session) : club.sport}
      details={[participant || null, !isAdult && draft.team ? draft.team : null].filter(Boolean).join(" · ") || priceLabel(club)}
      imageUrl={club.image || null}
    />
  );

  if (confirmed) {
    const lead =
      confirmed.option === "trial"
        ? `We've emailed ${confirmed.email} the details for ${isAdult ? "your" : `${draft.first || "your child"}'s`} free trial.`
        : confirmed.option === "pass"
          ? `Covered by your pass — one credit used. We've emailed ${confirmed.email} the details.`
          : confirmed.totalCents > 0 && confirmed.payAtVenue
            ? `Pay ${formatCents(confirmed.totalCents)} at the club — nothing is charged online. We've emailed ${confirmed.email} the details.`
            : `We've emailed ${confirmed.email} the details.`;
    return (
      <BookingSurface page>
        <ConfirmationPanel
          variant="success"
          title={confirmed.option === "trial" ? "Free trial booked" : "You're registered"}
          lead={lead}
          summary={
            // The pass, lanyard look (owner 2026-10-27): the person it's for first.
            <PassCard
              look="lanyard"
              kind="club"
              tone="ok"
              status={confirmed.option === "trial" ? "Free trial booked" : confirmed.payAtVenue && confirmed.totalCents > 0 ? "Registered · pay at the club" : "Registered"}
              title={club.name}
              whoLabel={isAdult ? "Member" : `Registered by ${draft.contact.name.trim() || "you"}`}
              who={participant || null}
              date={session ? sessionLabel(session) : null}
              where={club.sport}
              fields={[
                ...(!isAdult && draft.team ? ([["Team", draft.team]] as [string, string][]) : []),
                [confirmed.option === "trial" ? "Trial" : "Pay", confirmed.option === "trial" ? "1 session, free" : confirmed.option === "pass" ? "1 pass credit" : confirmed.totalCents > 0 ? `${formatCents(confirmed.totalCents)}${confirmed.payAtVenue ? " at the club" : ""}` : "Free"],
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
          <PolicySummary contact="club" />
        </ConfirmationPanel>
      </BookingSurface>
    );
  }

  const summary = (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {listing}
      {usingPass ? (
        <div style={{ background: bk.panel, borderRadius: bkRadius.card, padding: "14px 16px", fontSize: 15 }}>
          <strong>Covered by your pass</strong> · one credit, {usablePass!.creditsTotal - usablePass!.creditsUsed} left
        </div>
      ) : (
        <QuoteSummary state={quote} subtotalLabel={draft.option === "trial" ? "Free trial session" : `Membership · ${priceLabel(club)}`} onRetry={quote.retry} />
      )}
      <PolicySummary contact="club" />
    </div>
  );

  const problems = attempted ? stepProblems(step) : [];
  // Commercial release gate — a card payment can't start while paid checkout is closed (the server refuses it too).
  const paidClosed = paidOpen === false && draft.option === "pay" && !usingPass && !!priced && !priced.payAtVenue && priced.totalCents > 0;
  const primaryLabel =
    step !== "review" ? "Continue" : usingPass ? "Use a pass credit" : draft.option === "trial" ? "Book free trial" : priced ? payLabel(priced, "Confirm registration") : "Continue";

  const options: { value: RegDraft["option"]; label: string; hint?: string }[] = [{ value: "pay", label: "Register", hint: priceLabel(club) }];
  if (club.trial) options.push({ value: "trial", label: "Free trial first", hint: "One session, nothing to pay" });
  if (usablePass) options.push({ value: "pass", label: "Use a pass credit", hint: `${usablePass.creditsTotal - usablePass.creditsUsed} left` });

  return (
    <BookingSurface page>
      <BookingShell
        steps={[isAdult ? "You" : "Your child", "Contacts", "Review"]}
        current={stepIndex + 1}
        title={step === "who" ? "Who's joining?" : step === "contacts" ? (isAdult ? "How can the club reach you?" : "Your details and an emergency contact") : "Review and register"}
        onBack={back}
        backLabel={stepIndex > 0 ? "Back a step" : `Back to ${club.name}`}
        errors={problems}
        summary={summary}
        submitBar={
          !clubFull && (
            <SubmitBar note={paidClosed ? <span role="status">{PAID_CLOSED_MESSAGE}</span> : step === "review" && !usingPass && draft.option === "pay" && priced && !priced.payAtVenue && priced.totalCents > 0 ? "You'll pay securely on the next screen." : undefined}>
              <BkButton full onClick={next} busy={submitting} busyLabel="Please wait…" disabled={step === "review" && (!consent || paidClosed)}>
                {primaryLabel}
              </BkButton>
            </SubmitBar>
          )
        }
      >
        {step === "who" && (
          <>
            {club.audience === "all" && (
              <ChoiceChips
                legend="Who are you registering?"
                value={draft.registrantType}
                onChange={(v) => set("registrantType", v)}
                options={[{ value: "child", label: "My child" }, { value: "adult", label: "Myself" }]}
              />
            )}
            {!isAdult && household.length > 0 && (
              <ChoiceChips
                legend="From your household"
                value={household.find((m) => m.firstName === draft.first && m.lastName === draft.last)?.id ?? null}
                onChange={(id) => {
                  const m = household.find((x) => x.id === id);
                  if (m) setDraft((d) => ({ ...d, first: m.firstName, last: m.lastName, dob: m.dob || d.dob }));
                }}
                options={household.map((m) => ({ value: m.id, label: `${m.firstName} ${m.lastName}` }))}
              />
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
              <BkTextField label="First name" value={draft.first} onChange={(v) => set("first", v)} autoComplete={isAdult ? "given-name" : "off"} required error={fieldErrors.first} />
              <BkTextField label="Last name" value={draft.last} onChange={(v) => set("last", v)} autoComplete={isAdult ? "family-name" : "off"} required error={fieldErrors.last} />
            </div>
            {!isAdult && (
              <>
                <BkTextField label="Date of birth" type="date" value={draft.dob} onChange={(v) => set("dob", v)} required error={fieldErrors.dob} helper={club.ages ? `This club is for ages ${club.ages}.` : undefined} />
                <div>
                  <ChoiceChips legend="Age group" value={draft.team} onChange={(v) => set("team", v)} options={AGE_GROUPS.map((t) => ({ value: t, label: t }))} />
                  {fieldErrors.team && <div style={{ fontSize: 13, fontWeight: 600, color: bk.danger, marginTop: 8 }}>{fieldErrors.team}</div>}
                </div>
              </>
            )}
          </>
        )}

        {step === "contacts" && (
          <>
            {isAdult ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
                <BkTextField label="Email" type="email" inputMode="email" autoComplete="email" value={draft.contact.email} onChange={(v) => set("contact", { ...draft.contact, email: v })} required error={fieldErrors.email} helper="Your confirmation goes here." />
                <BkTextField label="Phone" type="tel" inputMode="tel" autoComplete="tel" value={draft.contact.phone} onChange={(v) => set("contact", { ...draft.contact, phone: v })} required error={fieldErrors.phone} />
              </div>
            ) : (
              <ContactConfirm
                value={draft.contact}
                onChange={(c) => set("contact", c)}
                identity={resident ? { name: resident.name, email: resident.email } : null}
                askPhone
                phoneRequired
                phoneHelper="Only the club sees this."
                errors={{ name: fieldErrors.name, email: fieldErrors.email, phone: fieldErrors.phone }}
              />
            )}
            <fieldset style={{ border: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 }}>
              <legend style={{ fontSize: 16, fontWeight: 700, padding: 0, marginBottom: 12 }}>Emergency contact{isAdult ? " (optional)" : ""}</legend>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
                <BkTextField label="Name" value={draft.ecName} onChange={(v) => set("ecName", v)} required={!isAdult} error={fieldErrors.ecName} />
                <BkTextField label="Phone" type="tel" inputMode="tel" value={draft.ecPhone} onChange={(v) => set("ecPhone", v)} required={!isAdult} error={fieldErrors.ecPhone} />
                <BkTextField label="Relationship" value={draft.ecRel} onChange={(v) => set("ecRel", v)} placeholder="e.g. Grandparent" />
              </div>
            </fieldset>
            {/* Privacy decision D-A4 — health information isn't collected here (no approved lawful basis yet). */}
            <p style={{ margin: 0, fontSize: 13.5, color: colors.muted, lineHeight: 1.5 }}>
              If {isAdult ? "you have" : "your child has"} a health need the club should know about to keep {isAdult ? "you" : "them"} safe, please tell the club directly. HelloCircle doesn't collect health information.
            </p>
          </>
        )}

        {step === "review" && (
          <>
            {sessions.length > 0 && <ChoiceChips legend="Which session?" value={draft.sessionId} onChange={(id) => set("sessionId", id)} options={sessions.map((s) => ({ value: s.id, label: sessionLabel(s) }))} />}
            {formQs.length > 0 && (
              <FormQuestions
                questions={formQs}
                answers={answers}
                onAnswers={setAnswers}
                person={formPerson}
                fe={{
                  control: (id: string) => ({ id, "aria-invalid": attempted && missing.some((m) => m.fieldId === id) ? true : undefined }),
                  messageFor: (id: string) => (attempted ? missing.find((m) => m.fieldId === id)?.message : undefined),
                  clearField: () => undefined,
                }}
              />
            )}
            {options.length > 1 && <ChoiceChips legend="How would you like to start?" value={draft.option} onChange={(v) => set("option", v)} options={options} />}
            {draft.option === "pay" && !usingPass && <CouponField applied={draft.couponCode} onApply={async (code) => { await quoteRegistration({ clubId: clubId!, couponCode: code }); set("couponCode", code); }} onRemove={() => set("couponCode", null)} />}
            <Acknowledgement checked={consent} onChange={setConsent} error={attempted && !consent ? "Tick this to continue" : undefined}>
              {isAdult
                ? "I consent to taking part in club activities and confirm the information provided is accurate. I understand photos may be taken at club events."
                : "I consent to my child taking part in club activities and confirm the information provided is accurate. I understand photos may be taken at club events."}{" "}
              <Link to="/policies/customer-booking-terms" target="_blank">Booking terms</Link>
            </Acknowledgement>
            {clubFull && (
              <div role="status" style={{ background: bk.panel, borderRadius: bkRadius.card, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                {waitlisted ? (
                  <strong>You're on the waitlist — we'll email you the moment a place opens.</strong>
                ) : (
                  <>
                    <strong>This club is full right now.</strong>
                    <span style={{ color: bk.soft }}>Join the waitlist and we'll tell you the moment a place opens. You'll have 48 hours to claim it.</span>
                    <BkButton variant="dark" onClick={joinWaitlist} busy={waitlistJoining} busyLabel="Joining…" style={{ alignSelf: "flex-start" }}>
                      Join the waitlist
                    </BkButton>
                  </>
                )}
              </div>
            )}
          </>
        )}
        {error && <div role="alert" style={{ color: bk.danger, fontWeight: 600 }}>{error}</div>}
      </BookingShell>
    </BookingSurface>
  );
}
