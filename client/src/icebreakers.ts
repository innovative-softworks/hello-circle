// Curated conversation prompts for hosts (community participation upgrade,
// Release 1) — a static, hand-written list on purpose: no generation, no
// per-person data, nothing that needs moderating. Light, local, answerable
// by someone who's new to the area as easily as by a regular.

export const ICEBREAKERS: readonly string[] = [
  "What's one place around here everyone should visit at least once?",
  "What got you into this in the first place?",
  "Best café within walking distance — go.",
  "What's something you've been meaning to try this year?",
  "Where's your favourite walk around here?",
  "What's the best thing you've found locally that most people don't know about?",
  "If you had a free Saturday with no plans, what would you do?",
  "What's a skill you'd love to pick up?",
  "Where did you grow up, and what do you miss about it?",
  "What's the best local event you've been to?",
  "Early bird or night owl?",
  "What's one thing that would make this neighbourhood even better?",
  "What's the last thing you did for the first time?",
  "Which spot around here has the best view?",
  "What would you tell someone who just moved to the area?",
];

/** Next prompt index, never repeating the current one. `random` is injectable for tests. */
export function nextIcebreakerIndex(current: number, random: () => number = Math.random): number {
  if (ICEBREAKERS.length < 2) return 0;
  const step = 1 + Math.floor(random() * (ICEBREAKERS.length - 1));
  return (current + step) % ICEBREAKERS.length;
}

/** A stable "today's prompt" per game, so a reload doesn't reshuffle it. */
export function initialIcebreakerIndex(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % ICEBREAKERS.length;
}
