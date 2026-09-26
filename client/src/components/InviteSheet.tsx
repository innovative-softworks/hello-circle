import { useState } from "react";
import { createInvitation, type InvitableEntityType } from "../api/invitations";
import { colors, radius } from "../theme";
import { CheckIcon } from "./icons";
import { InviteButton } from "./InviteButton";
import { ResidentPicker } from "./ResidentPicker";
import { Button, Modal, inputStyle, labelStyle } from "./ui";

// Universal Sharing & Invitation system, Phase 2 — "Invite" is distinct from
// "Share" (§7): this is for "I specifically want you to come to this",
// tracked as a real invitations row with an accept/maybe/decline state, not
// a fire-and-forget link. Reuses the existing ResidentPicker
// (search-by-name, invite-on-pick) that Circle organiser invites already
// established, so this is the same interaction pattern generalized to
// games/experiences/programs rather than a new one.

export function InviteSheet({ open, onClose, entityType, entityId, title }: { open: boolean; onClose: () => void; entityType: InvitableEntityType; entityId: string; title: string }) {
  const [email, setEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string[]>([]);

  const inviteResident = async (residentId: string) => {
    await createInvitation({ entityType, entityId, inviteeResidentIds: [residentId] });
    setSentTo((s) => [...s, residentId]);
  };

  const inviteEmail = async () => {
    const value = email.trim();
    if (!value) return;
    setEmailBusy(true);
    try {
      await createInvitation({ entityType, entityId, inviteeEmails: [value] });
      setSentTo((s) => [...s, value]);
      setEmail("");
    } finally {
      setEmailBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite people"
      subtitle={title}
      footer={
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          {sentTo.length > 0 ? (
            <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: colors.greenText, fontSize: 13, fontWeight: 700 }}>
              <CheckIcon size={15} /> {sentTo.length} invitation{sentTo.length === 1 ? "" : "s"} sent
            </span>
          ) : (
            <span style={{ fontSize: 12.5, color: colors.faint }}>They can accept, say maybe, or decline.</span>
          )}
          <Button onClick={onClose}>Done</Button>
        </div>
      }
    >

      <div style={{ fontSize: 11.5, fontWeight: 700, color: colors.faint, letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 8 }}>Invite via HelloCircle</div>
      <div style={{ marginBottom: 18 }}>
        <ResidentPicker onInvite={inviteResident} />
      </div>

      <div style={{ fontSize: 11.5, fontWeight: 700, color: colors.faint, letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 8 }}>Or invite by email</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <label htmlFor="invite-email" style={labelStyle}>Email address</label>
          <input id="invite-email" type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="friend@email.ie" style={inputStyle} onKeyDown={(e) => e.key === "Enter" && inviteEmail()} />
        </div>
        <Button onClick={inviteEmail} disabled={!email.trim() || emailBusy} style={{ alignSelf: "flex-end" }}>
          {emailBusy ? "Sending…" : "Send"}
        </Button>
      </div>

      <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 16 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: colors.faint, letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 10 }}>Other ways to invite</div>
        <InviteButton title={title} text={`I'm going to ${title}. Want to join me?`} listingType={entityType} listingId={entityId} />
      </div>
    </Modal>
  );
}
