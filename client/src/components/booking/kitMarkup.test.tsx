import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BkButton, BookingShell, SubmitBar } from "./BookingShell";
import { Acknowledgement, BkTextField, ContactConfirm } from "./fields";
import { ConfirmationPanel, QuoteSummary } from "./summary";

// Accessibility contract of the kit's markup (UX plan Q18–Q20), checked on
// server-rendered HTML — no browser needed.

const noop = () => {};
const html = (el: JSX.Element) => renderToStaticMarkup(el);
const idOfLabel = (markup: string, text: string) => markup.match(new RegExp(`<label for="([^"]+)"[^>]*>${text}`))?.[1];

describe("fields", () => {
  it("labels every guest contact field and gives the right keyboard/autofill hints", () => {
    const m = html(<ContactConfirm value={{ name: "", email: "", phone: "" }} onChange={noop} askPhone />);
    for (const [label, attrs] of [
      ["Full name", ['autoComplete="name"', 'type="text"']],
      ["Email", ['autoComplete="email"', 'type="email"', 'inputMode="email"']],
      ["Phone", ['autoComplete="tel"', 'type="tel"', 'inputMode="tel"']],
    ] as const) {
      const id = idOfLabel(m, label);
      expect(id, label).toBeTruthy();
      const input = m.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] ?? "";
      // React's server renderer keeps camelCase; HTML attribute names are case-insensitive.
      for (const a of attrs) expect(input.toLowerCase(), `${label} ${a}`).toContain(a.toLowerCase());
    }
  });

  it("shows a signed-in resident as one confirm line, not empty fields", () => {
    const m = html(<ContactConfirm value={{ name: "Aoife Byrne", email: "aoife@example.ie", phone: "" }} onChange={noop} identity={{ name: "Aoife Byrne", email: "aoife@example.ie" }} />);
    expect(m).toContain("Booking as");
    expect(m).toContain('aria-label="Edit your name and email"');
    expect(m).not.toContain("<input");
  });

  it("ties an error to its control", () => {
    const m = html(<BkTextField label="Email" value="x" onChange={noop} error="Enter an email like name@example.ie" required />);
    const describedBy = m.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(m).toContain('aria-invalid="true"');
    expect(m).toContain(`id="${describedBy}"`);
    expect(m).not.toContain("(optional)");
  });

  it("labels the acknowledgement tick-box by its own text", () => {
    const m = html(<Acknowledgement checked={false} onChange={noop}>I agree to the booking terms</Acknowledgement>);
    const id = m.match(/<input id="([^"]+)" type="checkbox"/)?.[1];
    expect(m).toContain(`<label for="${id}"`);
  });
});

describe("buttons, shell and states", () => {
  it("announces a busy button and keeps a disabled one disabled", () => {
    expect(html(<BkButton busy busyLabel="Starting payment…" onClick={noop}>Pay €202.40</BkButton>)).toMatch(/aria-busy="true"[^>]*>.*Starting payment…/);
    expect(html(<BkButton disabled>Pay</BkButton>)).toContain("disabled");
  });

  it("marks the current step and renders the summary as a labelled rail", () => {
    const m = html(
      <BookingShell steps={["Room", "Date and time", "Details", "Review"]} current={4} title="Review and pay" onBack={noop} summary={<p>sum</p>} submitBar={<SubmitBar note="note">x</SubmitBar>}>
        <p>body</p>
      </BookingShell>
    );
    expect(m).toContain("Step 4 of 4 · Review");
    expect((m.match(/aria-current="step"/g) ?? []).length).toBe(1);
    expect(m).toContain('aria-label="Booking summary"');
    expect(m).toContain('aria-label="Back"');
    expect(m).toContain("data-bottom-chrome");
    expect(m).toMatch(/<h1[^>]*>Review and pay<\/h1>/);
  });

  it("shows no price at all when quoting failed", () => {
    const m = html(<QuoteSummary state={{ status: "error", quote: null, error: "That code has expired", seq: 2 }} subtotalLabel="Hire" onRetry={noop} />);
    expect(m).toContain('role="alert"');
    expect(m).not.toContain("€");
    expect(m).toContain("Try again");
  });

  it("never says booked while payment is still being confirmed", () => {
    const m = html(<ConfirmationPanel variant="pending" bookingRef="HB-482913" lead="This can take a few seconds." />);
    expect(m).toContain("Finishing your payment…");
    expect(m).not.toContain("You're booked");
    expect(m).toContain('role="status"');
  });
});

describe("choice chips, number stepper, date picker", () => {
  it("exposes one-of-many choices as pressed/unpressed buttons in a labelled group", async () => {
    const { ChoiceChips } = await import("./fields");
    const m = html(<ChoiceChips legend="How long?" value={3} onChange={noop} options={[{ value: 2, label: "2 hours" }, { value: 3, label: "3 hours" }]} />);
    expect(m).toMatch(/<fieldset[^>]*><legend[^>]*>How long\?<\/legend>/);
    expect((m.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    expect(m).toMatch(/aria-pressed="true"[^>]*>.*3 hours/);
  });

  it("labels the stepper's input and buttons, and disables − at the minimum", async () => {
    const { BkNumberStepper } = await import("./fields");
    const m = html(<BkNumberStepper label="Expected guests" value={1} onChange={noop} min={1} max={40} helper="This room holds up to 40." />);
    const id = idOfLabel(m, "Expected guests");
    expect(m).toContain(`id="${id}"`);
    expect(m.toLowerCase()).toContain('inputmode="numeric"');
    expect(m).toMatch(/aria-label="Fewer — Expected guests" disabled=""/);
  });

  it("gives every day a spoken date and marks closed days", async () => {
    const { DateSlotPicker } = await import("./DateSlotPicker");
    const m = html(
      <DateSlotPicker minDate="2026-10-12" maxDate="2026-12-10" closedDates={new Set(["2026-10-20"])} date="2026-10-24" onDate={noop} slots={["17:00", "18:00"]} bookedTimes={["18:00"]} dayClosed={false} time="17:00" onTime={noop} />
    );
    expect(m).toContain('aria-label="Tuesday 20 October, closed"');
    expect(m).toContain('aria-label="Sunday 11 October, not bookable"');
    expect(m).toMatch(/aria-pressed="true" aria-label="Saturday 24 October"/);
    expect(m).toContain('aria-label="18:00, taken"');
    expect(m).toContain('aria-label="Previous month"');
  });
});
