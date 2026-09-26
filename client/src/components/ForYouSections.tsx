import { useEffect, useState } from "react";
import { fetchForYou } from "../api";
import type { ForYouSection } from "../types";
import { DiscoverRow } from "./DiscoverRow";

// "For You" (community participation upgrade, Release 4) — personalised
// rows on Home for a signed-in resident: For you, This weekend, Available
// when you're free, Come-alone friendly, Near you, Free nearby, From your
// Circles, Try something new. The server drops empty sections, and this
// renders nothing at all when there are none — no empty shelves. Explore
// stays the place to browse intentionally; this doesn't replace it.

export function ForYouSections({ wrap }: { wrap: (children: React.ReactNode, key: string) => React.ReactNode }) {
  const [sections, setSections] = useState<ForYouSection[]>([]);

  useEffect(() => {
    fetchForYou()
      .then((r) => setSections(r.sections))
      .catch(() => setSections([]));
  }, []);

  if (!sections.length) return null;
  // At most four rows on Home — enough to feel personal without turning the
  // page into a wall of shelves; "For you" always first when present.
  return <>{sections.slice(0, 4).map((s) => wrap(<DiscoverRow title={s.title} items={s.items} limit={10} />, s.key))}</>;
}
