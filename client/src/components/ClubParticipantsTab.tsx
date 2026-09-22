import { useEffect, useState } from "react";
import { fetchClubParticipants } from "../api";
import { UsersIcon } from "./icons";
import { Avatar, ManageCard as Card, EmptyState, PageSpinner, tableStyle, tdStyle, thStyle } from "./ui";
import { colors, radius } from "../theme";
import type { ClubParticipant } from "../types";

// Host Manage spec §11 — a club's "Participants" is a real roster grouped
// by child (a centre's would be identical to its Bookings list, since a
// hall booking has no repeat-participant concept — see GET
// /vendor/clubs/:id/participants's own comment for why this only exists
// here, not on the centre edit page).
export function ClubParticipantsTab({ clubId }: { clubId: string }) {
  const [participants, setParticipants] = useState<ClubParticipant[] | null>(null);

  useEffect(() => {
    fetchClubParticipants(clubId).then(setParticipants);
  }, [clubId]);

  if (participants === null) return <PageSpinner />;
  if (participants.length === 0) return <EmptyState icon={<UsersIcon size={26} />} title="No participants yet" />;

  return (
    <Card>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Child</th>
              <th style={thStyle}>Team(s)</th>
              <th style={thStyle}>Registrations</th>
              <th style={thStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {participants.map((p) => (
              <tr key={`${p.childFirst}-${p.childLast}`}>
                <td style={tdStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Avatar name={`${p.childFirst} ${p.childLast}`} size={24} />
                    {p.childFirst} {p.childLast}
                  </div>
                </td>
                <td style={tdStyle}>{p.teams.join(", ")}</td>
                <td style={tdStyle}>{p.registrations}</td>
                <td style={tdStyle}>
                  {p.active ? (
                    <span style={{ fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "2px 8px" }}>Active</span>
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 700, color: colors.muted, background: colors.panel, borderRadius: radius.pill, padding: "2px 8px" }}>Inactive</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
