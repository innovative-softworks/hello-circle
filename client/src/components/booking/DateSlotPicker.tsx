import { useState } from "react";
import { addDays, addMonths, daysBetween, weekdayOf } from "../../irelandDate";
import { bk, bkRadius } from "./bookingTheme";

// Booking kit — pick a day, then a start time, from the server's live
// availability (GET /availability: slots, bookedTimes, closed). All dates are
// Ireland calendar dates ("YYYY-MM-DD", irelandDate.ts) — never the device's
// own timezone. Every day and slot is a real button with a full spoken label.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The month grid for a "YYYY-MM-01" date: weeks start on Sunday, padded with nulls. */
export function monthCells(monthStart: string): (string | null)[] {
  const days = daysBetween(monthStart, addMonths(monthStart, 1));
  const cells: (string | null)[] = Array(weekdayOf(monthStart)).fill(null);
  for (let i = 0; i < days; i++) cells.push(addDays(monthStart, i));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function spokenDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${DOW_LONG[weekdayOf(iso)]} ${d} ${MONTHS[m - 1]}`;
}

const sectionLabel = { fontSize: 14, fontWeight: 600, margin: "0 0 10px" } as const;

export function DateSlotPicker({
  minDate,
  maxDate,
  closedDates,
  date,
  onDate,
  slots,
  bookedTimes,
  dayClosed,
  time,
  onTime,
  loadingSlots,
}: {
  /** First and last bookable Ireland dates (inclusive). */
  minDate: string;
  maxDate: string;
  closedDates: Set<string>;
  date: string | null;
  onDate: (iso: string) => void;
  slots: string[];
  bookedTimes: string[];
  dayClosed: boolean;
  time: string | null;
  onTime: (t: string) => void;
  loadingSlots?: boolean;
}) {
  const firstMonth = `${minDate.slice(0, 7)}-01`;
  const lastMonth = `${maxDate.slice(0, 7)}-01`;
  const [month, setMonth] = useState(() => (date ? `${date.slice(0, 7)}-01` : firstMonth));
  const [, mm] = month.split("-").map(Number);
  const canPrev = month > firstMonth;
  const canNext = month < lastMonth;

  const navButton = (enabled: boolean) => ({
    width: 44,
    height: 44,
    border: `1px solid ${enabled ? bk.lineStrong : bk.line}`,
    background: "transparent",
    borderRadius: bkRadius.control,
    color: bk.ink,
    opacity: enabled ? 1 : 0.4,
    cursor: enabled ? "pointer" : "default",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <fieldset style={{ border: "none", margin: 0, padding: 0, maxWidth: 420 }}>
        <legend style={sectionLabel}>Date</legend>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <button type="button" onClick={() => canPrev && setMonth(addMonths(month, -1))} disabled={!canPrev} aria-label="Previous month" style={navButton(canPrev)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <div aria-live="polite" style={{ fontWeight: 700, fontSize: 16 }}>
            {MONTHS[mm - 1]} {month.slice(0, 4)}
          </div>
          <button type="button" onClick={() => canNext && setMonth(addMonths(month, 1))} disabled={!canNext} aria-label="Next month" style={navButton(canNext)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </div>
        <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4, marginBottom: 4 }}>
          {DOW.map((d) => (
            <div key={d} style={{ textAlign: "center", fontSize: 12, fontWeight: 600, color: bk.muted }}>
              {d}
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4 }}>
          {monthCells(month).map((iso, i) => {
            if (!iso) return <div key={`pad-${i}`} />;
            const closed = closedDates.has(iso);
            const outOfRange = iso < minDate || iso > maxDate;
            const disabled = closed || outOfRange;
            const selected = date === iso;
            return (
              <button
                key={iso}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                aria-label={`${spokenDate(iso)}${closed ? ", closed" : outOfRange ? ", not bookable" : ""}`}
                onClick={() => onDate(iso)}
                style={{
                  minHeight: 44,
                  aspectRatio: "1",
                  border: selected ? "none" : `1px solid ${disabled ? "transparent" : bk.line}`,
                  background: selected ? bk.ink : disabled ? "transparent" : bk.surface,
                  color: selected ? bk.bg : disabled ? bk.muted : bk.ink,
                  opacity: disabled ? 0.55 : 1,
                  textDecoration: closed ? "line-through" : "none",
                  borderRadius: bkRadius.control,
                  fontSize: 15,
                  fontWeight: selected ? 700 : 500,
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
              >
                {Number(iso.slice(8))}
              </button>
            );
          })}
        </div>
      </fieldset>

      {date && (
        <fieldset style={{ border: "none", margin: 0, padding: 0 }} aria-busy={loadingSlots || undefined}>
          <legend style={sectionLabel}>Start time · {spokenDate(date)}</legend>
          {dayClosed ? (
            <p style={{ margin: 0, color: bk.soft }}>The venue is closed on this date. Pick another day.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 8 }}>
              {slots.map((t) => {
                const taken = bookedTimes.includes(t);
                const selected = time === t;
                return (
                  <button
                    key={t}
                    type="button"
                    disabled={taken}
                    aria-pressed={selected}
                    aria-label={`${t}${taken ? ", taken" : ""}`}
                    onClick={() => onTime(t)}
                    style={{
                      minHeight: 48,
                      border: selected ? "none" : `1px solid ${taken ? bk.line : bk.lineStrong}`,
                      background: selected ? bk.ink : taken ? "transparent" : bk.surface,
                      color: selected ? bk.bg : taken ? bk.muted : bk.ink,
                      opacity: taken ? 0.55 : 1,
                      textDecoration: taken ? "line-through" : "none",
                      borderRadius: bkRadius.control,
                      fontSize: 15,
                      fontWeight: 600,
                      cursor: taken ? "not-allowed" : "pointer",
                    }}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          )}
        </fieldset>
      )}
    </div>
  );
}
