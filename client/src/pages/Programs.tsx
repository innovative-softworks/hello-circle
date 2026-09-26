import { useMemo } from "react";
import { fetchProgramBrowse } from "../api";
import { BrowseLayout, type BrowseConfig, type BrowseItem } from "../components/BrowseLayout";
import { GridIcon } from "../components/icons";
import type { ProgramSummary } from "../types";

// Programs browse (/programs) — multi-week courses and series from
// community centres and clubs, on the same BrowseLayout as Adventures/
// Experiences/Volunteer so every browse page looks and behaves the same.
// The server only returns published programs at approved venues that
// still have an upcoming session (a finished course isn't browseable).

export function programToBrowseItem(p: ProgramSummary): BrowseItem {
  return {
    id: p.id,
    title: p.title,
    searchText: `${p.title} ${p.description} ${p.category} ${p.listingName} ${p.area} ${p.county}`.toLowerCase(),
    // The venue matters more than the area for a weekly course.
    locationLabel: [p.listingName, p.area].filter(Boolean).join(", "),
    county: p.county,
    lat: p.lat,
    lng: p.lng,
    locationSource: (p.locationSource as BrowseItem["locationSource"]) ?? undefined,
    priceCents: p.priceCents,
    // One price covers the whole program, not each session.
    perPerson: false,
    imageUrl: p.imageUrl,
    featured: false,
    href: `/programs/${p.id}`,
    tone: p.listingType === "club" ? "orange" : "green",
    next: { date: p.nextSessionDate, time: p.nextSessionTime, spotsLeft: p.spotsLeft },
    tags: [p.category, p.skillLevel, p.ageRange ? `Ages ${p.ageRange}` : "", p.upcomingSessions > 1 ? `${p.upcomingSessions} sessions` : ""].filter(Boolean),
    filterTag: p.category || null,
    ctaLabel: "View program",
    // Favourites don't cover programs yet, so no save button.
    save: null,
  };
}

export function Programs() {
  const config = useMemo<BrowseConfig>(
    () => ({
      title: "Programs",
      subtitle: "Multi-week courses and series at community centres and clubs — sign up once and come back each week.",
      nounPlural: "programs",
      searchPlaceholder: "What would you like to learn? e.g. Pottery",
      icon: <GridIcon size={24} />,
      load: () => fetchProgramBrowse().then((rows) => rows.map(programToBrowseItem)),
      resetKey: "programs",
      tagFilterLabel: "Category",
      // No "Search this area" — the map's area search covers venues and
      // experiences, not programs; the list's own pins are shown instead.
      mapSearchTypes: undefined,
      supportsFeatured: false,
      closing: {
        text: "Prefer something one-off? Try an experience, or just join a session happening nearby.",
        primary: { label: "Browse Experiences", to: "/experiences" },
        secondary: { label: "Join a Game instead", to: "/games" },
      },
    }),
    []
  );
  return <BrowseLayout config={config} />;
}
