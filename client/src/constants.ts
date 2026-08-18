export const EVENT_TYPES = [
  "Birthday party",
  "Family function",
  "Naming ceremony",
  "Community meeting",
  "Cultural event",
  "Class / workshop",
  "Indoor sports",
];
export const AGE_GROUPS = ["Under 6", "Under 8", "Under 10", "Under 12", "Under 14", "Under 16"];
export const DURATION_OPTIONS = [
  { hours: 2, label: "2 hours" },
  { hours: 3, label: "3 hours" },
  { hours: 4, label: "4 hours" },
  { hours: 8, label: "Full day" },
];
export const TIME_SLOTS = [
  "09:00", "10:00", "11:00", "12:00", "13:00", "14:00",
  "15:00", "16:00", "17:00", "18:00", "19:00", "20:00",
];

// Phase 3 first slice: a lightweight, fixed category tag for clubs/programs
// — deliberately not a database-backed taxonomy (see CLAUDE.md's Phase 3
// note), just a shared vocabulary for tagging/display.
export const ACTIVITY_CATEGORIES = [
  "GAA", "Soccer", "Rugby", "Swimming", "Basketball", "Athletics",
  "Martial Arts", "Dance", "Fitness & Wellness", "Arts & Crafts",
  "Music", "Community & Social", "Kids & Family", "Other",
];
export const SKILL_LEVELS = ["All levels", "Beginner", "Intermediate", "Advanced"];
export const PROGRAM_STATUSES = ["draft", "published", "paused", "archived"] as const;
