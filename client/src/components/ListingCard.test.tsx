import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { CardAction, CardArrow, CardAvailability, ListingCard } from "./ListingCard";

// Batch 2 — the no-photo block and the phone row layout, on rendered HTML.

const html = (el: JSX.Element) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);

describe("ListingCard no-photo block", () => {
  it("shows the listing's own kind, title and date instead of the icon placeholder", () => {
    const m = html(<ListingCard href="/games/g1" title="Hiking Group Walk" ph="var(--color-green-bg)" icon={<span>ICON</span>} tag="Activity" fallbackLine="Sat 24 Oct · 13:00" />);
    expect(m).toContain("no-photo-text");
    expect(m).toContain("Hiking Group Walk");
    expect(m).toContain("Sat 24 Oct · 13:00");
    expect(m).toContain(">Activity<");
    expect(m).not.toContain("ICON");
    expect(m).not.toContain("card-photo-badge"); // the kind isn't repeated as a photo badge
    expect(m).toContain("#1f4d36"); // green family tone
  });

  it("keeps the photo (and its badge) when there is one", () => {
    const m = html(<ListingCard href="/x" title="With photo" image="https://example.test/p.jpg" ph="var(--color-orange-bg)" tag="Experience" />);
    expect(m).not.toContain("no-photo-text");
    expect(m).toContain("card-photo-badge");
  });

  it("lets a page keep the older icon placeholder (Home)", () => {
    const m = html(<ListingCard href="/x" title="Home card" ph="var(--color-green-bg)" icon={<span>ICON</span>} noPhoto="icon" />);
    expect(m).not.toContain("no-photo-text");
    expect(m).toContain("ICON");
  });

  it("uses fallbackKind over a date-pill tag, and picks tones by family", () => {
    const m = html(<ListingCard href="/x" title="Yoga" ph="repeating-linear-gradient(135deg,#D9E6EC 0 14px,#E4EDF1 14px 28px)" tag="SAT, 24 OCT" fallbackKind="Programme" />);
    expect(m).toContain(">Programme<");
    expect(m).toContain("#2b3a59");
  });

  it("stays a full-width card on phones (card redesign 2026-10-22 — no row layout)", () => {
    expect(html(<ListingCard href="/x" title="a" ph="x" rowOnPhone />)).not.toContain("listing-card--row");
  });
});

// Card redesign (2026-10-22) — the reference grid card's parts.
describe("ListingCard redesign", () => {
  it("shows a real going count only, and no avatars", () => {
    expect(html(<ListingCard href="/x" title="a" ph="x" going={8} />)).toContain("8 going");
    expect(html(<ListingCard href="/x" title="a" ph="x" going={0} />)).not.toContain("going");
    expect(html(<ListingCard href="/x" title="a" ph="x" going={null} />)).not.toContain("going");
  });

  it("puts the status pill on the photo with its tone", () => {
    const m = html(<ListingCard href="/x" title="a" ph="x" image="/p.jpg" status={{ label: "Almost full", tone: "hot" }} tag="Sport" />);
    expect(m).toContain('data-tone="hot"');
    expect(m).toContain("Almost full");
    expect(m).toContain("lc-tag");
  });

  it("labels the arrow for screen readers", () => {
    expect(html(<CardArrow label="View Five-a-side Football" onClick={() => {}} />)).toContain('aria-label="View Five-a-side Football"');
  });

  it("never offers an active action when booked, and shows the busy label", () => {
    expect(html(<CardAction look="booked">Booked</CardAction>)).toContain("disabled");
    const busy = html(<CardAction busy busyLabel="Joining…">Join</CardAction>);
    expect(busy).toContain("Joining…");
    expect(busy).toContain('aria-busy="true"');
  });

  it("tones availability from real numbers and shows nothing without them", () => {
    // Price rules (owner 2026-10-27): "N left", orange from 3 down, "Full".
    expect(html(<CardAvailability spotsLeft={3} />)).toContain("3 left");
    expect(html(<CardAvailability spotsLeft={3} />)).toContain('data-tone="few"');
    expect(html(<CardAvailability spotsLeft={4} />)).toContain('data-tone="good"');
    expect(html(<CardAvailability spotsLeft={12} />)).toContain('data-tone="good"');
    expect(html(<CardAvailability spotsLeft={0} />)).toContain("Full");
    expect(html(<CardAvailability spotsLeft={null} />)).toBe("");
  });
});
