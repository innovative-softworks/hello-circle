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
  const { status } = await Calendar.requestCalendarPermissions();
  if (status !== 'granted') throw new Error('Calendar permission denied');

  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  const target = calendars.find((c) => c.allowsModifications) ?? calendars.find((c) => c.isPrimary);
  if (!target) throw new Error('No writable calendar found');

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
