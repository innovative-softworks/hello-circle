import { useEffect, useState } from "react";
import { fetchExperiences } from "../api";
import { ExperienceCard } from "./ExperienceCard";
import { UsersIcon } from "./icons";
import { PageTitle } from "./PageTitle";
import { CardSkeleton, EmptyState } from "./ui";
import { colors } from "../theme";
import type { Experience, ExperienceKind } from "../types";

// Shared browse layout for the Adventures and Experiences pages (see
// pages/Adventures.tsx / pages/Experiences.tsx) — same underlying
// `experiences` table/fetch, split into two dedicated nav destinations/URLs
// rather than one page with a kind toggle, per the separation the user
// asked for. No kind switcher here — each page is now a single-purpose
// destination, so a toggle back to "the other kind" would just duplicate
// what the Explore nav already offers.

export function ExperienceKindBrowse({ kind, title, subtitle }: { kind: ExperienceKind; title: string; subtitle: string }) {
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchExperiences(kind)
      .then(setExperiences)
      .finally(() => setLoading(false));
  }, [kind]);

  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth: 1100, margin: "0 auto", padding: "36px 24px 90px" }}>
        <PageTitle>{title}</PageTitle>
        <p style={{ color: colors.mutedLight, fontSize: 15, margin: "0 0 24px" }}>{subtitle}</p>

        {loading ? (
          <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : experiences.length === 0 ? (
          <EmptyState icon={<UsersIcon size={26} />} title="Nothing here yet" subtitle="Check back soon." />
        ) : (
          <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
            {experiences.map((e) => (
              <ExperienceCard key={e.id} e={e} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
