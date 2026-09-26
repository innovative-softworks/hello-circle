import { useMemo } from "react";
import { fetchExperiences } from "../api";
import { TreeIconSmall } from "./icons";
import { BrowseLayout, type BrowseConfig, type BrowseItem } from "./BrowseLayout";
import type { Experience, ExperienceKind } from "../types";

// Adventures, Experiences and Volunteer browse pages (pages/Adventures.tsx,
// Experiences.tsx, Volunteer.tsx) — same `experiences` table/fetch, split
// into dedicated nav destinations by kind. The page itself is the shared
// BrowseLayout (also used by Programs); this file only maps an Experience
// into a BrowseItem and supplies the per-kind wording.

function kindPath(kind: ExperienceKind): string {
  return kind === "adventure" ? "adventures" : "experiences";
}

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
    perPerson: true,
    imageUrl: e.imageUrl,
    featured: !!e.featured,
    href: `/${kindPath(e.kind)}/${e.slug ?? e.id}`,
    tone: e.kind === "adventure" ? "green" : "orange",
    next: session ? { date: session.date, time: session.time, spotsLeft: session.spotsLeft } : null,
    tags: e.difficulty ? [e.difficulty] : [],
    filterTag: e.difficulty || null,
    ctaLabel: e.kind === "volunteer" ? "Volunteer" : `View ${e.kind === "adventure" ? "adventure" : "experience"}`,
    save: { kind: "experience", id: e.id },
  };
}

export function ExperienceKindBrowse({ kind, title, subtitle }: { kind: ExperienceKind; title: string; subtitle: string }) {
  const config = useMemo<BrowseConfig>(
    () => ({
      title,
      subtitle,
      nounPlural: kind === "adventure" ? "adventures" : kind === "volunteer" ? "volunteer opportunities" : "experiences",
      searchPlaceholder: kind === "adventure" ? "What kind of adventure? e.g. Kayaking" : "What do you feel like doing? e.g. Pottery",
      icon: <TreeIconSmall size={24} />,
      load: () => fetchExperiences(kind).then((rows) => rows.map(experienceToBrowseItem)),
      resetKey: `experience:${kind}`,
      // Difficulty only means something for adventures.
      tagFilterLabel: kind === "adventure" ? "Difficulty" : undefined,
      mapSearchTypes: ["experience"],
      supportsFeatured: true,
      closing: {
        text:
          kind === "adventure"
            ? "Browse workshops and classes, or just join a session happening nearby."
            : kind === "volunteer"
            ? "Try an adventure instead, or ask for the kind of volunteering you'd like to see."
            : "Browse guided outdoor trips, or just join a session happening nearby.",
        primary: kind === "adventure" ? { label: "Browse Experiences", to: "/experiences" } : { label: "Browse Adventures", to: "/adventures" },
        secondary: { label: "Join a Game instead", to: "/games" },
      },
    }),
    [kind, title, subtitle]
  );
  return <BrowseLayout config={config} />;
}
