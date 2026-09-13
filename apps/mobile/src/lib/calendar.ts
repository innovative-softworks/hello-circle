// SDK 57's expo-calendar replaced the classic free-function API
// (Calendar.createEventAsync(calendarId, details)) with a class-based one
// — the old function throws at runtime in this version (confirmed against
// the installed package's own type declarations: it's only usable via the
// separate 'expo-calendar/legacy' subpath). This uses the current API
// directly: getCalendars() returns ExpoCalendar instances, and the event is
// created via calendar.createEvent(details), not a free function.
import * as Calendar from 'expo-calendar';

export interface CalendarEventInput {
  title: string;
  date: string;
  time?: string;
  durationMinutes?: number;
  notes?: string;
  allDay?: boolean;
}

export async function addToCalendar(input: CalendarEventInput): Promise<void> {
  const target = await pickDefaultCalendar();
  await writeEvent(target, input);
}

export interface CalendarAccount {
  id: string;
  title: string;
  // Real source metadata (expo-calendar's own Source shape) — used to show
  // a real "Apple Calendar"/"Google Calendar"/etc label, never a fabricated
  // one; falls back to the calendar's own title for anything unrecognised
  // (e.g. a local-only calendar with no account source).
  sourceName: string;
}

async function pickDefaultCalendar() {
  const { status } = await Calendar.requestCalendarPermissions();
  if (status !== 'granted') throw new Error('Calendar permission denied');
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  const target = calendars.find((c) => c.allowsModifications) ?? calendars.find((c) => c.isPrimary);
  if (!target) throw new Error('No writable calendar found');
  return target;
}

// Real device calendars, not a fabricated Apple/Google/Outlook picker — a
// resident with only a local calendar sees exactly that; one with several
// accounts sees each real account by its own name.
export async function fetchWritableCalendars(): Promise<CalendarAccount[]> {
  const { status } = await Calendar.requestCalendarPermissions();
  if (status !== 'granted') throw new Error('Calendar permission denied');
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  return calendars
    .filter((c) => c.allowsModifications)
    .map((c) => ({ id: c.id, title: c.title, sourceName: c.source?.name ?? c.title }));
}

async function writeEvent(target: Awaited<ReturnType<typeof pickDefaultCalendar>>, input: CalendarEventInput): Promise<void> {
  const startDate = new Date(`${input.date}T${input.time ?? '09:00'}:00`);
  const endDate = new Date(startDate.getTime() + (input.durationMinutes ?? 60) * 60_000);

  await target.createEvent({
    title: input.title,
    startDate,
    endDate,
    notes: input.notes,
    allDay: input.allDay ?? false,
  });
}

export async function addToCalendarById(calendarId: string, input: CalendarEventInput): Promise<void> {
  const { status } = await Calendar.requestCalendarPermissions();
  if (status !== 'granted') throw new Error('Calendar permission denied');
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  const target = calendars.find((c) => c.id === calendarId);
  if (!target) throw new Error('Calendar not found');
  await writeEvent(target, input);
}
