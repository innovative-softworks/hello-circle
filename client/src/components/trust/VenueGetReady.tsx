import { useEffect, useState } from "react";
import { fetchCentre, isNotFound } from "../../api";
import type { Centre } from "../../types";
import { LoadErrorState, Skeleton } from "../ui";
import { WhatToExpect, centreExpectFacts } from "./WhatToExpect";

// Trust & Retention — "Get ready" for a hall booking: the venue's own arrival
// line, hours, accessibility and facilities, from the same public venue record
// and fact builder as the venue page. Empty fields read "Not provided by the
// venue"; a venue that's no longer public shows nothing rather than stale data.

const PREP_LABELS = new Set(["Who meets you on arrival", "Opening hours", "Accessibility", "Facilities"]);

export function VenueGetReady({ centreId }: { centreId: string }) {
  const [centre, setCentre] = useState<Centre | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    fetchCentre(centreId)
      .then(setCentre)
      .catch((e) => (isNotFound(e) ? setCentre(null) : setFailed(true)));
  };
  useEffect(load, [centreId]);
  const wrap = (body: React.ReactNode) => <div style={{ maxWidth: 608, margin: "8px auto 48px", width: "calc(100% - 32px)", boxSizing: "border-box" }}>{body}</div>;
  if (failed) return wrap(<LoadErrorState title="We couldn't load the venue's arrival details." onRetry={load} />);
  if (centre === undefined) return wrap(<Skeleton height={140} />);
  if (centre === null) return null;
  return wrap(<WhatToExpect facts={centreExpectFacts(centre).filter((f) => PREP_LABELS.has(f.label))} title="Get ready" contact="Questions about the hall? Contact the venue from your booking, or" />);
}
