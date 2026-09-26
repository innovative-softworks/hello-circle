import { ExperienceKindBrowse } from "../components/ExperienceKindBrowse";

// Volunteering (community participation upgrade, Release 5) — not a
// separate volunteering app: volunteer opportunities are an experience kind
// listed by organisations, so this is the same browse page as Adventures/
// Experiences, filtered to that kind.
export function Volunteer() {
  return (
    <ExperienceKindBrowse
      kind="volunteer"
      title="Volunteer"
      subtitle="Beach clean-ups, community gardens and local causes that need a few more hands. Always free to join."
    />
  );
}
