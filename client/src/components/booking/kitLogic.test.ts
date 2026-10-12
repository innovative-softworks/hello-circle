import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DRAFT_MAX_AGE_MS, clearDraft, readDraft, writeDraft } from "./draft";
import { cancellationCopy, formatIrishDateTime } from "./policy";
import { payLabel, quoteRows } from "./quoteLines";
import { initialQuoteState, quoteReducer, type QuoteState } from "./useQuote";

// The venue quote the server returns for €40/h × 2h, online room (the
// legacy computePricing model: VAT and fee on top, €100 deposit).
const venueQuote = { subtotalCents: 8000, discountCents: 0, vatCents: 1840, platformFeeCents: 400, depositCents: 10000, totalCents: 20240, couponCode: null, payAtVenue: false };

describe("quoteRows — server quote to display rows", () => {
  it("lists every non-zero line in a fixed order and ends with the server's total", () => {
    expect(quoteRows(venueQuote, "Hall hire · 2 hours").map((r) => [r.key, r.label, r.cents])).toEqual([
      ["subtotal", "Hall hire · 2 hours", 8000],
      ["vat", "VAT (23%)", 1840],
      ["fee", "Platform fee", 400],
      ["deposit", "Refundable deposit", 10000],
      ["total", "Total today", 20240],
    ]);
  });

  it("shows a coupon as a reduction and passes the total through untouched", () => {
    const rows = quoteRows({ ...venueQuote, discountCents: 800, couponCode: "SPRING10", totalCents: 12345 }, "Hire");
    expect(rows.find((r) => r.key === "discount")).toMatchObject({ label: "Code SPRING10", cents: 800, negative: true });
    // Even an "inconsistent" total is shown as sent: the client never re-adds.
    expect(rows.at(-1)!.cents).toBe(12345);
  });

  it("words cash, free and VAT-inclusive quotes correctly", () => {
    expect(quoteRows({ ...venueQuote, payAtVenue: true, depositCents: 0 }, "Hire").at(-1)!.label).toBe("Pay at the venue");
    expect(quoteRows({ ...venueQuote, totalCents: 0 }, "Hire").at(-1)!.label).toBe("Total · nothing to pay");
    expect(quoteRows({ ...venueQuote, vatIncluded: true }, "Hire").some((r) => r.key === "vat")).toBe(false);
    expect(payLabel(venueQuote)).toBe("Pay €202.40");
    expect(payLabel({ totalCents: 1500, payAtVenue: true })).toBe("Confirm booking");
  });
});

describe("cancellation wording (Irish time, server-provided deadline)", () => {
  it("formats in Europe/Dublin whatever the device timezone, across the DST change", () => {
    // Summer time (UTC+1): 16:00Z is 17:00 in Dublin.
    expect(formatIrishDateTime("2026-10-22T16:00:00.000Z")).toBe("Thu 22 Oct, 17:00");
    // Clocks go back 25 Oct 2026; winter (UTC+0): 17:00Z is 17:00.
    expect(formatIrishDateTime("2026-10-27T17:00:00.000Z")).toBe("Tue 27 Oct, 17:00");
  });

  it("says when free cancellation ends, or that it has closed", () => {
    const now = Date.parse("2026-10-11T12:00:00Z");
    expect(cancellationCopy({ cancelDeadline: "2026-10-22T16:00:00.000Z", depositCents: 10000, now })).toEqual({
      headline: "Free cancellation until Thu 22 Oct, 17:00",
      detail: "After that, contact the venue. Your €100 deposit is returned by the venue after the event.",
    });
    expect(cancellationCopy({ cancelDeadline: "2026-10-10T16:00:00.000Z", now, contact: "host" }).headline).toBe("Online cancellation has closed");
    expect(cancellationCopy({}).headline).toBe("Cancel any time from My Life");
  });
});

describe("drafts (sessionStorage, never blocking)", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
  };

  it("round-trips, expires after two hours, and clears", () => {
    const s = memory();
    writeDraft("venue:c1", { guests: 12 }, s, 1000);
    expect(readDraft("venue:c1", s, 2000)).toEqual({ guests: 12 });
    expect(readDraft("venue:c1", s, 1000 + DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(s.m.size).toBe(0);
    writeDraft("venue:c1", { guests: 3 }, s);
    clearDraft("venue:c1", s);
    expect(readDraft("venue:c1", s)).toBeNull();
  });

  it("carries on when storage is missing, throws, or holds junk", () => {
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(() => writeDraft("k", { a: 1 }, throwing)).not.toThrow();
    expect(readDraft("k", throwing)).toBeNull();
    expect(() => clearDraft("k", throwing)).not.toThrow();
    expect(readDraft("k", null)).toBeNull();
    const s = memory();
    s.setItem("hc_booking_draft:k", "{not json");
    expect(readDraft("k", s)).toBeNull();
  });
});

describe("quoteReducer — only the latest request wins", () => {
  type Q = { totalCents: number };
  it("ignores a slow answer to an older request", () => {
    let s: QuoteState<Q> = initialQuoteState<Q>();
    s = quoteReducer(s, { type: "request", seq: 1 });
    s = quoteReducer(s, { type: "request", seq: 2 });
    s = quoteReducer(s, { type: "success", seq: 1, quote: { totalCents: 100 } });
    expect(s.status).toBe("loading");
    s = quoteReducer(s, { type: "success", seq: 2, quote: { totalCents: 200 } });
    expect(s).toMatchObject({ status: "ready", quote: { totalCents: 200 } });
  });

  it("keeps the old price dimmed while re-quoting, but drops it on failure", () => {
    let s: QuoteState<Q> = quoteReducer(quoteReducer(initialQuoteState<Q>(), { type: "request", seq: 1 }), { type: "success", seq: 1, quote: { totalCents: 100 } });
    s = quoteReducer(s, { type: "request", seq: 2 });
    expect(s).toMatchObject({ status: "loading", quote: { totalCents: 100 } });
    s = quoteReducer(s, { type: "failure", seq: 2, error: "That code has expired" });
    expect(s).toEqual({ status: "error", quote: null, error: "That code has expired", seq: 2 });
    expect(quoteReducer(s, { type: "reset" }).status).toBe("idle");
  });
});

describe("no client-side pricing in the booking kit (UX plan Q2)", () => {
  it("never imports or applies VAT/fee rates", () => {
    const dir = new URL(".", import.meta.url);
    for (const file of readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))) {
      const src = readFileSync(new URL(file, dir), "utf-8");
      expect(src, file).not.toMatch(/VAT_RATE|PLATFORM_FEE_RATE|\b0\.23\b|\* ?0\.05\b|\b23 ?\/ ?100\b/);
    }
  });
});

describe("monthCells (Ireland calendar dates, Sunday-first weeks)", () => {
  it("pads October 2026 (starts on a Thursday) to whole weeks", async () => {
    const { monthCells } = await import("./DateSlotPicker");
    const cells = monthCells("2026-10-01");
    expect(cells.slice(0, 5)).toEqual([null, null, null, null, "2026-10-01"]);
    expect(cells.filter(Boolean)).toHaveLength(31);
    expect(cells.length % 7).toBe(0);
    expect(cells.at(-1)).toBe("2026-10-31"); // a Saturday: 4 + 31 = exactly five weeks
  });
});
