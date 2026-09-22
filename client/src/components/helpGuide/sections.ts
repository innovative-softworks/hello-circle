// Shared by the guide index (cards) and each topic page's shell (prev/next
// + "back to guide" links) — one list, kept in sync with App.tsx's
// /help-guide/* routes by hand (same tradeoff client/src/ogMeta-adjacent
// pages already accept elsewhere in this app — no shared route registry).
export interface GuideSection {
  slug: string;
  label: string;
  description: string;
}

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    slug: "explore",
    label: "Explore",
    description: "Join a session, Adventures, Experiences, Community centres and Sports clubs.",
  },
  {
    slug: "circles",
    label: "Circles",
    description: "Ongoing groups you join or start around a shared activity.",
  },
  {
    slug: "my-life",
    label: "My Life",
    description: "Everything you've booked, joined, saved, and organise.",
  },
  {
    slug: "start",
    label: "Start",
    description: "Book a place, host a session, pitch an idea, or suggest a venue.",
  },
];
