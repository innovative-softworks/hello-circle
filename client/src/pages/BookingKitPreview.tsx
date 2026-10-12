import { useState, type ReactNode } from "react";
import {
  Acknowledgement,
  BkButton,
  BookingShell,
  BookingSurface,
  ConfirmationPanel,
  ContactConfirm,
  CouponField,
  HoldNotice,
  ListingSummary,
  PolicySummary,
  QuoteSummary,
  StepErrors,
  SubmitBar,
  bk,
  bkFonts,
  payLabel,
  useQuote,
  type ContactValue,
  type KitQuote,
  type QuoteState,
} from "../components/booking";
import { CommerceKitSections, DashboardCommercePreview } from "./CommercePreview";

// Dev-only (routed in App.tsx under import.meta.env.DEV): every booking-kit
// component in every state, light and dark side by side — UX plan Phase 1's
// review surface. Sample quotes below are fixed example server responses,
// not computed here.

const SAMPLE: KitQuote = { subtotalCents: 8000, discountCents: 0, vatCents: 1840, platformFeeCents: 400, depositCents: 10000, totalCents: 20240, couponCode: null, payAtVenue: false };
const SAMPLE_CASH: KitQuote = { ...SAMPLE, depositCents: 0, totalCents: 10240, payAtVenue: true };
const SAMPLE_COUPON: KitQuote = { ...SAMPLE, discountCents: 800, vatCents: 1656, platformFeeCents: 360, totalCents: 19216, couponCode: "SPRING10" };
const DEADLINE_OPEN = "2030-10-22T16:00:00.000Z";
const DEADLINE_CLOSED = "2020-10-22T16:00:00.000Z";

const states: { label: string; state: QuoteState<KitQuote> }[] = [
  { label: "Idle", state: { status: "idle", quote: null, error: null, seq: 0 } },
  { label: "First load", state: { status: "loading", quote: null, error: null, seq: 1 } },
  { label: "Re-quoting (previous dimmed)", state: { status: "loading", quote: SAMPLE, error: null, seq: 2 } },
  { label: "Ready", state: { status: "ready", quote: SAMPLE, error: null, seq: 2 } },
  { label: "Ready, code applied", state: { status: "ready", quote: SAMPLE_COUPON, error: null, seq: 3 } },
  { label: "Ready, pay at venue", state: { status: "ready", quote: SAMPLE_CASH, error: null, seq: 4 } },
  { label: "Error", state: { status: "error", quote: null, error: "Check your connection and try again. You haven't been charged.", seq: 5 } },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 28, borderBottom: `1px solid ${bk.line}` }}>
      <h2 style={{ margin: 0, fontFamily: bkFonts.display, fontSize: 22, fontWeight: 700 }}>{title}</h2>
      {children}
    </section>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0, textTransform: "uppercase", color: bk.muted }}>{children}</div>;
}

function KitColumn({ scheme }: { scheme: "light" | "dark" }) {
  const [guest, setGuest] = useState<ContactValue>({ name: "", email: "", phone: "" });
  const [resident, setResident] = useState<ContactValue>({ name: "Aoife Byrne", email: "aoife@example.ie", phone: "" });
  const [agreed, setAgreed] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  return (
    <BookingSurface scheme={scheme} style={{ padding: "28px 20px", display: "flex", flexDirection: "column", gap: 28 }}>
      <div style={{ fontFamily: bkFonts.display, fontSize: 28, fontWeight: 800 }}>{scheme === "light" ? "Light" : "Dark"}</div>

      <Section title="Buttons">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <BkButton>Pay €202.40</BkButton>
          <BkButton variant="secondary">Back</BkButton>
          <BkButton variant="dark">Join waitlist</BkButton>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <BkButton disabled>Agree to continue</BkButton>
          <BkButton busy busyLabel="Starting payment…">Pay</BkButton>
          <BkButton variant="quiet">Have a code?</BkButton>
          <BkButton variant="danger">Cancel booking</BkButton>
        </div>
      </Section>

      <Section title="Contact">
        <Caption>Guest</Caption>
        <ContactConfirm value={guest} onChange={setGuest} askPhone />
        <Caption>Guest with errors</Caption>
        <ContactConfirm value={{ name: "", email: "aoife@example", phone: "" }} onChange={() => {}} errors={{ name: "Enter your name", email: "Enter an email like name@example.ie" }} />
        <Caption>Signed in</Caption>
        <ContactConfirm value={resident} onChange={setResident} identity={{ name: "Aoife Byrne", email: "aoife@example.ie" }} />
      </Section>

      <Section title="Acknowledgement and code">
        <Acknowledgement checked={agreed} onChange={setAgreed}>
          I agree to the <a href="#terms">booking terms</a> and the venue's cancellation policy
        </Acknowledgement>
        <Acknowledgement checked={false} onChange={() => {}} error="Tick this to continue">
          I've read the safety information for this trip
        </Acknowledgement>
        <CouponField
          applied={code}
          onApply={async (c) => {
            await new Promise((r) => setTimeout(r, 400));
            if (c !== "SPRING10") throw new Error("That code isn't valid");
            setCode(c);
          }}
          onRemove={() => setCode(null)}
        />
        <div style={{ fontSize: 13, color: bk.muted }}>Try SPRING10 (sample), or anything else for the error.</div>
      </Section>

      <Section title="Price summary">
        {states.map((s) => (
          <div key={s.label} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Caption>{s.label}</Caption>
            <QuoteSummary state={s.state} subtotalLabel="Hall hire · 2 hours" onRetry={() => {}} />
          </div>
        ))}
      </Section>

      <Section title="Listing and policy">
        <ListingSummary title="Community Hall · Main Hall" when="Sat 24 Oct · 17:00–19:00" details="12 guests · Birthday party" />
        <PolicySummary cancelDeadline={DEADLINE_OPEN} depositCents={10000} />
        <PolicySummary cancelDeadline={DEADLINE_CLOSED} />
        <PolicySummary />
        <StepErrors errors={["That slot is no longer available — pick another time"]} />
      </Section>

      <Section title="Confirmation">
        <ConfirmationPanel
          variant="success"
          bookingRef="HB-482913"
          lead="We've emailed your confirmation to aoife@example.ie."
          summary={<ListingSummary title="Community Hall · Main Hall" when="Sat 24 Oct · 17:00–19:00" details="12 guests" />}
          actions={<><BkButton variant="dark">Add to calendar</BkButton><BkButton variant="secondary">Manage booking</BkButton></>}
        >
          <PolicySummary cancelDeadline={DEADLINE_OPEN} depositCents={10000} />
        </ConfirmationPanel>
        <ConfirmationPanel variant="pending" bookingRef="HB-482913" lead="This usually takes a few seconds. Don't pay again." />
      </Section>

      <CommerceKitSections />
    </BookingSurface>
  );
}

/** The full step, interactive: guests drive a (sample) re-quote through the
 * real useQuote hook, so the debounce and dimmed-while-loading states show. */
function FullStepDemo({ onClose }: { onClose: () => void }) {
  const [guests, setGuests] = useState(12);
  const [agreed, setAgreed] = useState(false);
  const [contact, setContact] = useState<ContactValue>({ name: "", email: "", phone: "" });
  const quote = useQuote<KitQuote>(() => new Promise((r) => setTimeout(() => r(guests > 30 ? SAMPLE_COUPON : SAMPLE), 700)), [guests], { enabled: guests > 0 });
  return (
    <BookingSurface>
      <BookingShell
        steps={["Room", "Date and time", "Details", "Review"]}
        current={4}
        title="Review and pay"
        onBack={onClose}
        backLabel="Close the full-step demo"
        summary={
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <ListingSummary title="Community Hall · Main Hall" when="Sat 24 Oct · 17:00–19:00" details={`${guests} guests`} />
            <QuoteSummary state={quote} subtotalLabel="Hall hire · 2 hours" onRetry={quote.retry} />
          </div>
        }
        submitBar={
          <SubmitBar note={<HoldNotice />}>
            <BkButton full disabled={!agreed || quote.status !== "ready"}>{quote.status === "ready" ? payLabel(quote.quote) : "Pay"}</BkButton>
          </SubmitBar>
        }
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <BkButton variant="secondary" onClick={() => setGuests((g) => Math.max(1, g - 5))} ariaLabel="Five fewer guests">−5</BkButton>
          <span style={{ fontSize: 17, fontWeight: 600, minWidth: 90, textAlign: "center" }} aria-live="polite">{guests} guests</span>
          <BkButton variant="secondary" onClick={() => setGuests((g) => g + 5)} ariaLabel="Five more guests">+5</BkButton>
        </div>
        <ContactConfirm value={contact} onChange={setContact} identity={{ name: "Aoife Byrne", email: "aoife@example.ie" }} />
        <PolicySummary cancelDeadline={DEADLINE_OPEN} depositCents={10000} />
        <Acknowledgement checked={agreed} onChange={setAgreed}>
          I agree to the <a href="#terms">booking terms</a> and the venue's cancellation policy
        </Acknowledgement>
      </BookingShell>
    </BookingSurface>
  );
}

export function BookingKitPreview() {
  const [fullStep, setFullStep] = useState(false);
  if (fullStep) return <FullStepDemo onClose={() => setFullStep(false)} />;
  return (
    <div>
      <BookingSurface style={{ padding: "24px 20px 0" }}>
        <h1 style={{ margin: 0, fontFamily: bkFonts.display, fontSize: 40, fontWeight: 800, letterSpacing: 0 }}>Booking kit</h1>
        <p style={{ margin: "8px 0 0", color: bk.soft, maxWidth: 640 }}>Every component in every state, light and dark. Dev builds only. Commercial UX R1/R2 components use fixtures from components/booking/__fixtures__ — no API calls.</p>
        <div style={{ padding: "16px 0 24px" }}>
          <BkButton variant="dark" onClick={() => setFullStep(true)}>Open the full review step</BkButton>
        </div>
      </BookingSurface>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))" }}>
        <KitColumn scheme="light" />
        <KitColumn scheme="dark" />
      </div>
      <DashboardCommercePreview />
    </div>
  );
}
