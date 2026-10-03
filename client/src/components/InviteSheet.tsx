import { useCallback, useEffect, useRef, useState } from "react";
import { createInvitation, fetchSentInvitations, revokeInvitation, type InvitableEntityType, type SentInvitation } from "../api/invitations";
import { useConfirm } from "./ConfirmProvider";
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

const INVITE_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  accepted: "Accepted",
  maybe: "Maybe",
  declined: "Declined",
  expired: "Expired",
  revoked: "Revoked",
};

export function InviteSheet({ open, onClose, entityType, entityId, title }: { open: boolean; onClose: () => void; entityType: InvitableEntityType; entityId: string; title: string }) {
  const [email, setEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string[]>([]);

  // Phase 11B — invitations this resident may manage (host: all; others:
  // their own), with "Revoke invitation" for pending ones.
  const confirm = useConfirm();
  const [sent, setSent] = useState<SentInvitation[] | null>(null);
  const [sentError, setSentError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeMessage, setRevokeMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const revokeInFlight = useRef(false);

  const loadSent = useCallback(() => {
    setSentError(null);
    fetchSentInvitations(entityType, entityId)
      .then(setSent)
      .catch(() => setSentError("Couldn't load your invitations."));
  }, [entityType, entityId]);

  useEffect(() => {
    if (open) loadSent();
  }, [open, loadSent]);

  const revoke = async (inv: SentInvitation) => {
    if (revokeInFlight.current) return;
    const ok = await confirm({
      title: "Revoke invitation?",
      message: `${inv.invitee} will no longer be able to see or join ${title} through this invitation. You can invite them again later.`,
      confirmLabel: "Revoke invitation",
      cancelLabel: "Keep invitation",
      tone: "danger",
    });
    if (!ok) return;
    revokeInFlight.current = true;
    setRevokingId(inv.id);
    setRevokeMessage(null);
    try {
      const result = await revokeInvitation(inv.id);
      setRevokeMessage({ tone: "ok", text: result.alreadyRevoked ? `The invitation to ${inv.invitee} was already revoked.` : `Invitation to ${inv.invitee} revoked.` });
    } catch (e) {
      setRevokeMessage({ tone: "error", text: e instanceof Error && e.message ? e.message : "Couldn't revoke this invitation — please try again." });
    } finally {
      revokeInFlight.current = false;
      setRevokingId(null);
      loadSent();
    }
  };

  const inviteResident = async (residentId: string) => {
    await createInvitation({ entityType, entityId, inviteeResidentIds: [residentId] });
    setSentTo((s) => [...s, residentId]);
    loadSent();
  };

  const inviteEmail = async () => {
    const value = email.trim();
    if (!value) return;
    setEmailBusy(true);
    try {
      await createInvitation({ entityType, entityId, inviteeEmails: [value] });
      setSentTo((s) => [...s, value]);
      setEmail("");
      loadSent();
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

      {sent && sent.length > 0 && (
        <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 16, marginBottom: 18 }}>
          <h3 style={{ fontSize: 11.5, fontWeight: 700, color: colors.faint, letterSpacing: ".04em", textTransform: "uppercase", margin: "0 0 10px" }}>Invitations sent</h3>
          <ul aria-label="Invitations sent" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {sent.map((inv) => (
              <li key={inv.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: colors.bg, borderRadius: radius.control, padding: "8px 12px" }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {inv.invitee} <span style={{ fontWeight: 500, color: colors.mutedLight }}>· {INVITE_STATUS_LABEL[inv.status] ?? inv.status}</span>
                </span>
                {inv.canRevoke && (
                  <button
                    type="button"
                    className="btn-reset"
                    onClick={() => revoke(inv)}
                    disabled={revokingId !== null}
                    aria-label={`Revoke invitation to ${inv.invitee}`}
                    style={{ color: colors.danger, fontWeight: 700, fontSize: 12.5, padding: "4px 2px", cursor: revokingId ? "default" : "pointer", flex: "none" }}
                  >
                    {revokingId === inv.id ? "Revoking…" : "Revoke invitation"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div aria-live="polite" role={revokeMessage?.tone === "error" || sentError ? "alert" : "status"} style={{ fontSize: 13, fontWeight: 600, marginBottom: revokeMessage || sentError ? 12 : 0, color: revokeMessage?.tone === "error" || sentError ? colors.danger : colors.greenText }}>
        {sentError ?? revokeMessage?.text}
      </div>

      <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 16 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: colors.faint, letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 10 }}>Other ways to invite</div>
        <InviteButton title={title} text={`I'm going to ${title}. Want to join me?`} listingType={entityType} listingId={entityId} />
      </div>
    </Modal>
  );
}
