import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PAID_CLOSED_MESSAGE, openBookingOpen, paidCheckoutOpen, resetPaidCheckoutCache } from "./paidCheckout";

// Commercial release gate, client side — display only (the server refuses a
// paid checkout regardless). These pin how the client reads /api/config.

afterEach(() => {
  vi.unstubAllGlobals();
  resetPaidCheckoutCache();
});

describe("paid checkout flag", () => {
  it("is closed when the server says so", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mapsEnabled: true, paidCheckoutOpen: false }) }));
    expect(await paidCheckoutOpen()).toBe(false);
  });

  it("is open when the server says so, or says nothing (older server)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mapsEnabled: true }) }));
    expect(await paidCheckoutOpen()).toBe(true);
  });

  it("a failed config call never hides free or cash bookings (the server still decides)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await paidCheckoutOpen()).toBe(true);
  });

  it("is fetched once and shared", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ paidCheckoutOpen: false }) });
    vi.stubGlobal("fetch", f);
    await Promise.all([paidCheckoutOpen(), paidCheckoutOpen(), paidCheckoutOpen()]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("Make It Happen: closed/open from the server, open on an older server, unknown when the call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ openBooking: false }) }));
    expect(await openBookingOpen()).toBe(false);
    resetPaidCheckoutCache();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ openBooking: true }) }));
    expect(await openBookingOpen()).toBe(true);
    resetPaidCheckoutCache();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mapsEnabled: true }) }));
    expect(await openBookingOpen()).toBe(true);
    resetPaidCheckoutCache();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await openBookingOpen()).toBe(null);
    expect(await paidCheckoutOpen()).toBe(true);
  });

  it("paid and Make It Happen share one config call", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ paidCheckoutOpen: false, openBooking: false }) });
    vi.stubGlobal("fetch", f);
    await Promise.all([paidCheckoutOpen(), openBookingOpen()]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("every card-payment entry point reads it", () => {
    for (const f of ["./pages/BookingFlow.tsx", "./pages/RegistrationFlow.tsx", "./pages/ProgramDetail.tsx", "./pages/ExperienceDetail.tsx", "./components/GameJoinCard.tsx", "./pages/ClubDetail.tsx"]) {
      expect(readFileSync(new URL(f, import.meta.url), "utf8"), f).toContain("usePaidCheckoutOpen");
    }
    expect(PAID_CLOSED_MESSAGE).toMatch(/only free bookings/);
  });
});
