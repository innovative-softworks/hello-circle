import { useMemo } from "react";
import { experienceKindWord, kindPath } from "../experienceKind";
import { fetchExperiences } from "../api";
import { TreeIconSmall } from "./icons";
import { BrowseLayout, type BrowseConfig, type BrowseItem } from "./BrowseLayout";
import type { Experience, ExperienceKind } from "../types";
import { cardWord } from "../cardWord";

// Adventures, Experiences and Volunteer browse pages (pages/Adventures.tsx,
// Experiences.tsx, Volunteer.tsx) — same `experiences` table/fetch, split
// into dedicated nav destinations by kind. The page itself is the shared
// BrowseLayout (also used by Programs); this file only maps an Experience
// into a BrowseItem and supplies the per-kind wording.

export { kindPath, experienceKindWord };

export function experienceToBrowseItem(e: Experience): BrowseItem {
  const session = e.sessions[0] ?? null;
  return {
    id: e.id,
    title: e.title,
    searchText: `${e.title} ${e.blurb} ${e.area} ${e.county}`.toLowerCase(),
    locationLabel: `${e.area}${e.area && e.county ? ", " : ""}${e.county}`,
    county: e.county,
    lat: e.lat,
    lng: e.lng,
    locationSource: e.locationSource,
    priceCents: e.priceCents,
    // An event priced by options shows its cheapest option as "from".
    perPerson: e.registration?.mode !== "options",
    imageUrl: e.imageUrl,
    featured: !!e.featured,
    href: `/${kindPath(e.kind)}/${e.slug ?? e.id}`,
    tone: e.kind === "adventure" || e.kind === "event" ? "green" : "orange",
    next: session ? { date: session.date, time: session.time, spotsLeft: session.spotsLeft } : null,
    tags: e.difficulty ? [e.difficulty] : [],
    filterTag: e.difficulty || null,
    ctaLabel: e.kind === "volunteer" ? "Volunteer" : `View ${experienceKindWord(e.kind).toLowerCase()}`,
    save: { kind: "experience", id: e.id },
    durationMinutes: e.durationMinutes || null,
    skill: e.difficulty ? e.difficulty[0].toUpperCase() + e.difficulty.slice(1) : null,
    word: cardWord(e.categoryLabel, experienceKindWord(e.kind)),
  };
}

export function ExperienceKindBrowse({ kind, title, subtitle }: { kind: ExperienceKind; title: string; subtitle: string }) {
  const config = useMemo<BrowseConfig>(
    () => ({
      title,
      subtitle,
      featured: kind === "adventure" ? "experiences" : "adventures",
      nounPlural: kind === "adventure" ? "adventures" : kind === "volunteer" ? "volunteer opportunities" : kind === "event" ? "community events" : "experiences",
      kindLabel: kind === "adventure" ? "Adventure" : kind === "volunteer" ? "Volunteering" : kind === "event" ? "Event" : "Experience",
      searchPlaceholder: kind === "adventure" ? "What kind of adventure? e.g. Kayaking" : kind === "event" ? "What are you looking for? e.g. Diwali" : "What do you feel like doing? e.g. Pottery",
      icon: <TreeIconSmall size={24} />,
      load: (taxonomy) => fetchExperiences(kind, undefined, taxonomy).then((rows) => rows.map(experienceToBrowseItem)),
      resetKey: `experience:${kind}`,
      categoryFamily: kind === "volunteer" ? "volunteer" : "experience",
      categoryExperienceKind: kind === "volunteer" ? undefined : kind,
      categoryBasePath: `/${kind === "volunteer" ? "volunteer" : kindPath(kind)}`,
      // Difficulty only means something for adventures.
      tagFilterLabel: kind === "adventure" ? "Difficulty" : undefined,
      mapSearchTypes: ["experience"],
      supportsFeatured: true,
      // Featured adventures/experiences use the Adventure card (owner plan, 2026-10-23).
      featureStyle: "adventure",
      closing: {
        label: kind === "adventure" ? "Outdoors." : kind === "volunteer" ? "Give back." : kind === "event" ? "Celebrate." : "Try it.",
        lines:
          kind === "adventure"
            ? ["Get", "outside", "together."]
            : kind === "volunteer"
            ? ["Give", "a few", "hours."]
            : kind === "event"
            ? ["Celebrate", "with your", "community."]
            : ["Learn", "something", "new."],
        text:
          kind === "adventure"
            ? "Browse workshops and classes, or just join a session happening nearby."
            : kind === "volunteer"
            ? "Try an adventure instead, or ask for the kind of volunteering you'd like to see."
            : kind === "event"
            ? "Browse experiences and workshops, or join a Circle that runs its own gatherings."
            : "Browse guided outdoor trips, or just join a session happening nearby.",
        primary: kind === "adventure" ? { label: "Browse Experiences", to: "/experiences" } : { label: "Browse Adventures", to: "/adventures" },
        secondary: { label: "Join a Game instead", to: "/games" },
      },
    }),
    [kind, title, subtitle]
  );
  return <BrowseLayout config={config} />;
}
