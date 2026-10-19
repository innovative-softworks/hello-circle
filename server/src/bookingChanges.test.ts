import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const sent: { to: string; text: string }[] = [];
vi.mock("./email.js", async (orig) => ({ ...(await orig<typeof import("./email.js")>()), sendMail: async (m: { to: string; text: string }) => void sent.push(m) }));

const { db } = await import("./db/index.js");
const { irelandTodayIso } = await import("./irelandTime.js");
const { describeProposal, proposeBookingChange, respondToProposal, withdrawProposal } = await import("./bookingChanges.js");

// OG-11 / DEC-17 — a venue proposes a new time; the booking moves only when
// the customer accepts, never onto a taken slot, and only once.

const t = crypto.randomUUID().slice(0, 8);
const vendorId = `test-chg-vendor-${t}`;
const otherVendor = `test-chg-other-${t}`;
const centreId = `test-chg-centre-${t}`;
const roomId = `room-${t}`;
const date = new Date(Date.parse(`${irelandTodayIso()}T12:00:00Z`) + 15 * 86_400_000).toISOString().slice(0, 10);
const actor = `test-chg-actor-${t}`;

async function booking(time: string, email = `chg-${t}@example.test`): Promise<string> {
  const ref = `HBCH-${crypto.randomUUID().slice(0, 8)}`;
  await db
    .prepare(
      `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status)
       VALUES (?, 'chg', ?, ?, ?, ?, 1, 'Meeting', 4, 'Change Guest', ?, '', '', 0, 'confirmed', 'paid')`
    )
    .run(ref, centreId, roomId, date, time, email);
  return ref;
}
const tokenFor = (ref: string) => /token=([a-f0-9]{64})/.exec([...sent].reverse().find((m) => m.text.includes(ref))!.text)![1];
const slot = async (ref: string) => (await db.prepare(`SELECT date, time FROM bookings WHERE ref = ?`).get(ref)) as { date: string; time: string };

beforeAll(async () => {
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'Chg Vendor')`).run(vendorId, `${vendorId}@example.test`);
  await db
    .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status, opens_at, closes_at) VALUES (?, 'Change Centre', 'Area', 'Dublin', 0, 0, 20, 1000, 'Mgr', '', '', '', ?, 'approved', '09:00', '21:00')`)
    .run(centreId, vendorId);
  await db.prepare(`INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order) VALUES (?, ?, 'Hall', 20, 50, '', 0)`).run(roomId, centreId);
});

afterAll(async () => {
  await db.prepare(`DELETE FROM booking_change_proposals WHERE booking_ref IN (SELECT ref FROM bookings WHERE centre_id = ?)`).run(centreId);
  await db.prepare(`DELETE FROM bookings WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM rooms WHERE centre_id = ?`).run(centreId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendorId);
});

describe("proposing a change", () => {
  it("is scoped to the venue's own bookings and refuses a taken slot", async () => {
    const ref = await booking("10:00");
    await booking("15:00");
    await expect(proposeBookingChange({ ref, vendorIds: [otherVendor], actorUserId: actor, date, time: "12:00", message: "" })).rejects.toThrow(/not found/);
    await expect(proposeBookingChange({ ref, vendorIds: [vendorId], actorUserId: actor, date, time: "15:00", message: "" })).rejects.toThrow(/isn't free/);
    await expect(proposeBookingChange({ ref, vendorIds: [vendorId], actorUserId: actor, date, time: "10:00", message: "" })).rejects.toThrow(/already booked for/);
  });
});

describe("the customer's answer", () => {
  it("accepting moves the booking once; the link can't be used again", async () => {
    const ref = await booking("11:00");
    await proposeBookingChange({ ref, vendorIds: [vendorId], actorUserId: actor, date, time: "13:00", message: "Hall floor is being sanded" });
    const token = tokenFor(ref);
    expect(await describeProposal(token)).toMatchObject({ ref, status: "proposed", from: { time: "11:00" }, to: { time: "13:00" }, message: "Hall floor is being sanded" });
    expect(await slot(ref)).toMatchObject({ time: "11:00" }); // nothing moves until they accept
    expect(await respondToProposal(token, true, "")).toMatchObject({ status: "accepted", time: "13:00" });
    expect(await slot(ref)).toMatchObject({ time: "13:00" });
    await expect(respondToProposal(token, true, "")).rejects.toThrow(/already accepted/);
  });

  it("declining leaves the booking as it was", async () => {
    const ref = await booking("16:00");
    await proposeBookingChange({ ref, vendorIds: [vendorId], actorUserId: actor, date, time: "17:00", message: "" });
    expect(await respondToProposal(tokenFor(ref), false, "Can't do that time")).toMatchObject({ status: "declined", time: "16:00" });
    expect(await slot(ref)).toMatchObject({ time: "16:00" });
  });

  it("refuses an accept when the new slot was taken in the meantime", async () => {
    const ref = await booking("18:00");
    await proposeBookingChange({ ref, vendorIds: [vendorId], actorUserId: actor, date, time: "19:00", message: "" });
    await booking("19:00", `taker-${t}@example.test`);
    await expect(respondToProposal(tokenFor(ref), true, "")).rejects.toThrow(/just been taken/);
    expect(await slot(ref)).toMatchObject({ time: "18:00" });
  });

  it("a newer proposal replaces the older one, and a withdrawn or expired one can't be answered", async () => {
    const ref = await booking("09:00");
    await proposeBookingChange({ ref, vendorIds: [vendorId], actorUserId: actor, date, time: "12:00", message: "" });
    const first = tokenFor(ref);
    const { id } = await proposeBookingChange({ ref, vendorIds: [vendorId], actorUserId: actor, date, time: "20:00", message: "" });
    await expect(respondToProposal(first, true, "")).rejects.toThrow(/no longer open/);
    const second = tokenFor(ref);
    await withdrawProposal(ref, id, actor);
    await expect(respondToProposal(second, true, "")).rejects.toThrow(/no longer open/);
    const { id: third } = await proposeBookingChange({ ref, vendorIds: [vendorId], actorUserId: actor, date, time: "20:00", message: "" });
    await db.prepare(`UPDATE booking_change_proposals SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?`).run(third);
    expect((await describeProposal(tokenFor(ref))).status).toBe("expired");
    await expect(respondToProposal(tokenFor(ref), true, "")).rejects.toThrow(/expired/);
  });
});
