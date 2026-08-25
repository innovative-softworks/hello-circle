// Minimal ICS (iCalendar) generation (IA spec §13 "Add to calendar").
// Single VEVENT per call — every call site owns exactly one date+time to
// export (a booking slot, a game's start time), so there's no need for a
// general multi-event calendar builder here.

function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function icsTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

export function buildIcsEvent(input: {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
}): string {
  const now = icsTimestamp(new Date());
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hello Circle//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${input.uid}@hellocircle.ie`,
    `DTSTAMP:${now}`,
    `DTSTART:${icsTimestamp(input.start)}`,
    `DTEND:${icsTimestamp(input.end)}`,
    `SUMMARY:${icsEscape(input.title)}`,
    input.description ? `DESCRIPTION:${icsEscape(input.description)}` : undefined,
    input.location ? `LOCATION:${icsEscape(input.location)}` : undefined,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}
