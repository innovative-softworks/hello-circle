import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyInvitations, respondToInvitation, type MyInvitation } from "../api/invitations";
import { colors, radius } from "../theme";
import { AwardIcon } from "./icons";
import { Button } from "./ui";

const ENTITY_PATH: Record<string, string> = {
  game: "/games/",
  experience: "/experiences/",
  adventure: "/adventures/",
  program: "/programs/",
};

// Universal Sharing & Invitation system §9 — the resident's own pending
// inbox for person-to-person invitations to games/experiences/programs
// (Circle *membership* invites already have their own equivalent block on
// Circles.tsx — this is the generalized parallel for everything else
// invitable). Self-contained: renders nothing while empty, same "don't
// interrupt with a mostly-empty section" convention as this page's other
// optional panels.
export function MyInvitationsPanel() {
  const navigate = useNavigate();
  const [invitations, setInvitations] = useState<MyInvitation[]>([]);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  useEffect(() => {
    fetchMyInvitations().then(setInvitations).catch(() => setInvitations([]));
  }, []);

  const respond = async (invite: MyInvitation, response: "accepted" | "maybe" | "declined") => {
    setRespondingId(invite.id);
    try {
      await respondToInvitation(invite.id, response);
      setInvitations((rows) => rows.filter((r) => r.id !== invite.id));
      if (response === "accepted" && invite.entity) navigate(`${ENTITY_PATH[invite.entityType] ?? "/"}${invite.entityId}`);
    } finally {
      setRespondingId(null);
    }
  };

  if (invitations.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
      {invitations.map((inv) => (
        <div
          key={inv.id}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "16px 20px" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <AwardIcon size={18} style={{ color: colors.greenText, flex: "none" }} />
            <span style={{ fontSize: 14.5 }}>
              <strong>{inv.inviterName}</strong> invited you to <strong>{inv.entity?.title ?? "an activity"}</strong>
              {inv.entity?.date ? ` — ${inv.entity.date}${inv.entity.time ? ` · ${inv.entity.time}` : ""}` : ""}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={() => respond(inv, "accepted")} disabled={respondingId === inv.id}>Accept</Button>
            <Button variant="ghost" onClick={() => respond(inv, "maybe")} disabled={respondingId === inv.id}>Maybe</Button>
            <Button variant="ghost" onClick={() => respond(inv, "declined")} disabled={respondingId === inv.id}>Decline</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
