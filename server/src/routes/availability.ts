import { Router } from "express";
import { db } from "../db/index.js";

export const availabilityRouter = Router();

export const TIME_SLOTS = [
  "09:00", "10:00", "11:00", "12:00", "13:00", "14:00",
  "15:00", "16:00", "17:00", "18:00", "19:00", "20:00",
];

interface BookingRow {
  time: string;
  duration: number;
}

interface BlockRow {
  room_id: string | null;
  time: string | null;
}

interface CentreHours {
  opens_at: string;
  closes_at: string;
}

function slotsWithinHours(hours: CentreHours): string[] {
  const opensHour = parseInt(hours.opens_at.slice(0, 2), 10);
  const closesHour = parseInt(hours.closes_at.slice(0, 2), 10);
  return TIME_SLOTS.filter((t) => {
    const h = parseInt(t.slice(0, 2), 10);
    return h >= opensHour && h < closesHour;
  });
}

/** Every block row that applies to this room: room-specific, or centre-wide (room_id NULL). */
function blocksFor(centreId: string, roomId: string, date: string): BlockRow[] {
  return db
    .prepare(`SELECT room_id, time FROM room_blocks WHERE centre_id = ? AND date = ? AND (room_id = ? OR room_id IS NULL)`)
    .all(centreId, date, roomId) as BlockRow[];
}

availabilityRouter.get("/", (req, res) => {
  const { roomId, date } = req.query;
  if (typeof roomId !== "string" || typeof date !== "string") {
    return res.status(400).json({ error: "roomId and date query params are required" });
  }

  const room = db.prepare(`SELECT centre_id FROM rooms WHERE id = ?`).get(roomId) as { centre_id: string } | undefined;
  if (!room) return res.status(404).json({ error: "Room not found" });

  const hours = db.prepare(`SELECT opens_at, closes_at FROM centres WHERE id = ?`).get(room.centre_id) as CentreHours;
  const slots = slotsWithinHours(hours);

  const bookedHours = new Set<number>();
  const bookings = db.prepare(`SELECT time, duration FROM bookings WHERE room_id = ? AND date = ?`).all(roomId, date) as BookingRow[];
  for (const b of bookings) {
    const startHour = parseInt(b.time.slice(0, 2), 10);
    if (b.duration >= 8) {
      TIME_SLOTS.forEach((t) => bookedHours.add(parseInt(t.slice(0, 2), 10)));
    } else {
      for (let h = startHour; h < startHour + b.duration; h++) bookedHours.add(h);
    }
  }

  const blocks = blocksFor(room.centre_id, roomId, date);
  const closed = blocks.some((b) => b.time === null);
  for (const b of blocks) {
    if (b.time !== null) bookedHours.add(parseInt(b.time.slice(0, 2), 10));
  }

  const bookedTimes = closed ? slots : slots.filter((t) => bookedHours.has(parseInt(t.slice(0, 2), 10)));
  res.json({ slots, bookedTimes, closed });
});

/** Lightweight per-day open/closed flags for a date range, so the client can
 * grey out vendor-closed days across a multi-month calendar without fetching
 * full slot detail for every day. */
availabilityRouter.get("/range", (req, res) => {
  const { roomId, from, days } = req.query;
  if (typeof roomId !== "string" || typeof from !== "string") {
    return res.status(400).json({ error: "roomId and from query params are required" });
  }
  const numDays = Math.min(Number(days) || 60, 90);

  const room = db.prepare(`SELECT centre_id FROM rooms WHERE id = ?`).get(roomId) as { centre_id: string } | undefined;
  if (!room) return res.status(404).json({ error: "Room not found" });

  const wholeDayBlocks = new Set(
    (
      db
        .prepare(`SELECT date FROM room_blocks WHERE centre_id = ? AND (room_id = ? OR room_id IS NULL) AND time IS NULL`)
        .all(room.centre_id, roomId) as { date: string }[]
    ).map((r) => r.date)
  );

  const start = new Date(`${from}T00:00:00Z`);
  const closedDates: string[] = [];
  for (let i = 0; i < numDays; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    if (wholeDayBlocks.has(iso)) closedDates.push(iso);
  }

  res.json({ closedDates });
});
