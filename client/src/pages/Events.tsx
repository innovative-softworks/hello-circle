import { ExperienceKindBrowse } from "../components/ExperienceKindBrowse";

// Participation Phase 1 — community events (experiences.kind = 'event').
// Reached through search, filters, category pages and direct links; the
// frozen Explore menu doesn't list it (owner decision, 2026-10-29).
export function Events() {
  return (
    <ExperienceKindBrowse
      kind="event"
      title="Community events"
      subtitle="Cultural festivals, faith gatherings and community celebrations — register for the options you want in one place."
    />
  );
}
