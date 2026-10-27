import { useEffect, useState } from "react";
import { fetchHostProfile } from "../api";
import { StarIcon } from "./icons";
import { colors } from "../theme";
import { DetailSection, HostRow } from "./detail/DetailSections";
import type { Game, HostProfile } from "../types";

// Host trust card (Game Detail redesign §15) — real stats only. gamesHostedTotal/
// rating/reviews/bio come from the existing host-profile endpoint (the same
// data HostProfile.tsx itself renders); this app has no "show-up rate" or
// "member since" anywhere, so — per the spec's own explicit instruction not
// to fabricate trust signals — those are simply never shown. HostProfile
// only ever resolves for a verified host (see HostProfile.tsx's own
// comment), so the extra fetch only fires when hostVerified is true; an
// unverified host still gets a name + avatar, just no stats/CTA.

export function GameHostCard({ game }: { game: Game }) {
  const [profile, setProfile] = useState<HostProfile | null>(null);

  useEffect(() => {
    if (!game.hostVerified) return;
    fetchHostProfile(game.hostResidentId)
      .then(setProfile)
      .catch(() => {});
  }, [game.hostResidentId, game.hostVerified]);

  if (!game.hostName) return null;

  // Detail-page redesign — the shared host row (real stats only, see above).
  return (
    <DetailSection title="Hosted by">
      <HostRow
        name={game.hostName}
        avatarUrl={game.hostAvatarUrl ?? profile?.avatarUrl}
        verifiedLabel={game.hostVerified ? "Verified Host" : null}
        meta={
          profile ? (
            <>
              <span>Hosted {profile.gamesHostedTotal} {profile.gamesHostedTotal === 1 ? "activity" : "activities"}</span>
              {profile.reviews > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <StarIcon size={12} style={{ color: colors.gold }} /> {profile.rating} ({profile.reviews})
                </span>
              )}
            </>
          ) : null
        }
        bio={profile?.bio}
        href={game.hostVerified ? `/host/${game.hostResidentId}` : null}
      />
    </DetailSection>
  );
}
