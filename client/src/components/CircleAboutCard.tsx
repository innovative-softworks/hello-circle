import { useEffect, useState } from "react";
import { fetchHostProfile } from "../api";
import { AwardIcon, CheckIcon } from "./icons";
import { Avatar, Card, RouteLinkButton } from "./ui";
import { colors, fonts } from "../theme";
import type { Circle, HostProfile } from "../types";

// Right-rail About card (reference §24-25) — short description, real
// characteristics only (whatWeDo/whoCanJoin/values — organiser-provided
// structured fields, same ones the old full-width "story" section used),
// then the organiser nested at the bottom behind a divider rather than as
// its own big main-content section. gamesHostedTotal/circles.length/
// rating/bio come from the existing host-profile endpoint, same
// real-stats-only stance as the component this replaces
// (CircleOrganiserCard) — no "member since"/fabricated portrait photo.

export function CircleAboutCard({ circle }: { circle: Circle }) {
  const [profile, setProfile] = useState<HostProfile | null>(null);

  useEffect(() => {
    if (!circle.hostVerified) return;
    fetchHostProfile(circle.createdByResidentId).then(setProfile).catch(() => {});
  }, [circle.createdByResidentId, circle.hostVerified]);

  const bullets = [circle.whatWeDo, circle.whoCanJoin, circle.values].filter((v): v is string => !!v);

  if (!circle.about && bullets.length === 0 && !circle.hostName) return null;

  return (
    <Card>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 16, margin: "0 0 10px", letterSpacing: "-.01em" }}>About this Circle</h3>
      {circle.about && (
        <p style={{ margin: "0 0 14px", fontSize: 14, color: colors.text, lineHeight: 1.55 }}>{circle.about}</p>
      )}
      {bullets.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: circle.hostName ? 4 : 0 }}>
          {bullets.map((b, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13.5, color: colors.muted, lineHeight: 1.5 }}>
              <CheckIcon size={13} style={{ color: colors.greenText, marginTop: 3, flex: "none" }} />
              <span>{b}</span>
            </div>
          ))}
        </div>
      )}

      {circle.hostName && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${colors.border}` }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: colors.mutedLight, textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 10 }}>Circle organiser</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Avatar name={circle.hostName} size={38} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontWeight: 700, fontSize: 14 }}>
                <span>{circle.hostName}</span>
                {circle.hostVerified && (
                  <span title="Verified" style={{ display: "inline-flex", color: colors.greenText }}>
                    <AwardIcon size={13} />
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: colors.mutedLight }}>
                Organiser{profile ? ` · ${profile.circles.length} Circle${profile.circles.length === 1 ? "" : "s"}` : ""}
              </div>
            </div>
          </div>
          {circle.hostVerified && (
            <RouteLinkButton variant="ghost" to={`/host/${circle.createdByResidentId}`} style={{ marginTop: 10, width: "100%" }}>
              View profile
            </RouteLinkButton>
          )}
        </div>
      )}
    </Card>
  );
}
