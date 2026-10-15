import { useState } from "react";
import { ApiError, changeStaffRole, removeStaffMember } from "../api";
import { PLATFORM_ROLES, PLATFORM_ROLE_LABELS } from "../types";
import type { OrgProfile } from "../types";
import { useToast } from "./Toast";
import { Button, ConfirmDialog, inputStyle, labelStyle } from "./ui";
import { RecordState, RecordView } from "./workspace/RecordView";
import { formatDate } from "../vendorFormat";
import { colors, fonts } from "../theme";

// D-08 — one team member as a page (?tab=org&section=staff&record=member:<id>).
// The owner changes an accepted member's role or removes them. Each change
// carries the member's row version, so a change made elsewhere since this page
// opened is refused (409) instead of silently overwritten. Ownership itself
// can't be changed here.

export const ROLE_DESCRIPTION: Record<string, string> = {
  centre_manager: "Edits community centres and their rooms, programmes and bookings; checks guests in at centres.",
  facility_manager: "Edits sports clubs, their sessions and programmes; checks members in at clubs.",
  finance: "Payments, refunds, payouts, coupons, plan and reports. Can see bookings.",
  communications: "Sends messages to participants and replies to reviews.",
  read_only_analyst: "Sees demand insights and the shared read-only views. Can't change anything.",
};

type Member = OrgProfile["staff"][number];

export function StaffMemberRecord({ member, onBack, onChanged }: { member: Member | null; onBack: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [role, setRole] = useState<string>(member?.platformRole ?? PLATFORM_ROLES[0]);
  const [confirm, setConfirm] = useState<"role" | "remove" | null>(null);
  const [stale, setStale] = useState(false);

  if (!member) return <RecordState state="missing" backLabel="Staff & roles" onBack={onBack} message="This person isn't on your team any more." />;
  if (!member.invitedStaff) return <RecordState state="restricted" backLabel="Staff & roles" onBack={onBack} message="The organisation owner can't be changed or removed here." />;

  const roleName = (r: string | null) => (r ? ((PLATFORM_ROLE_LABELS as Record<string, string>)[r] ?? r.replace(/_/g, " ")) : "No role");
  // Throws on failure so the dialog stays open (with the chosen role kept) and shows the error.
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setStale(true);
      throw e;
    }
  };
  const saveRole = () =>
    run(async () => {
      await changeStaffRole(member.id, role, member.rowVersion);
      toast.success(`${member.name || member.email} is now ${roleName(role)}`);
      setConfirm(null);
      onChanged();
    });
  const remove = () =>
    run(async () => {
      await removeStaffMember(member.id, member.rowVersion);
      toast.success(`${member.name || member.email} was removed from your team`);
      setConfirm(null);
      onChanged();
      onBack();
    });

  return (
    <RecordView
      title={member.name || member.email}
      reference={<>Team member · {member.email}</>}
      backLabel="Staff & roles"
      onBack={onBack}
      statuses={
        <>
          <span style={{ fontSize: 13, color: colors.mutedLight }}>Role:</span> <strong style={{ fontSize: 13 }}>{roleName(member.platformRole)}</strong>
        </>
      }
      actions={
        <Button variant="ghost" onClick={() => setConfirm("remove")}>
          Remove from team
        </Button>
      }
    >
      {stale && (
        <p role="alert" style={{ background: colors.dangerBg, color: colors.danger, padding: "10px 12px", fontSize: 13.5 }}>
          This member was changed somewhere else since you opened this page.{" "}
          <button type="button" onClick={() => { setStale(false); onChanged(); }} style={{ background: "none", border: "none", color: "inherit", textDecoration: "underline", cursor: "pointer", fontWeight: 600 }}>
            Refresh
          </button>{" "}
          to see the current details, then try again.
        </p>
      )}
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 16px", fontSize: 14, margin: "0 0 20px" }}>
        <dt style={{ color: colors.mutedLight }}>Joined</dt>
        <dd style={{ margin: 0 }}>{formatDate(member.joinedAt)}</dd>
        <dt style={{ color: colors.mutedLight }}>Account</dt>
        <dd style={{ margin: 0 }}>{member.status === "approved" ? "Active" : member.status}</dd>
        <dt style={{ color: colors.mutedLight }}>Can do</dt>
        <dd style={{ margin: 0 }}>{member.platformRole ? ROLE_DESCRIPTION[member.platformRole] : "—"}</dd>
      </dl>

      <h2 style={{ fontFamily: fonts.display, fontSize: 16, margin: "0 0 8px" }}>Change role</h2>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", maxWidth: 520 }}>
        <div style={{ flex: "1 1 240px" }}>
          <label htmlFor="staff-role" style={labelStyle}>
            New role
          </label>
          <select id="staff-role" value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle} aria-describedby="staff-role-desc">
            {PLATFORM_ROLES.map((r) => (
              <option key={r} value={r}>
                {PLATFORM_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={() => setConfirm("role")} disabled={role === member.platformRole}>
          Change role…
        </Button>
      </div>
      <p id="staff-role-desc" style={{ fontSize: 13, color: colors.mutedLight, margin: "6px 0 0", maxWidth: 520 }}>
        {ROLE_DESCRIPTION[role]}
      </p>

      <ConfirmDialog
        open={confirm === "role"}
        title={`Change ${member.name || member.email}'s role?`}
        message={`From ${roleName(member.platformRole)} to ${roleName(role)}. ${ROLE_DESCRIPTION[role]} It applies from their next action in the Partner workspace — they don't need to sign in again. They're emailed about the change.`}
        confirmLabel="Change role"
        tone="neutral"
        onConfirm={saveRole}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "remove"}
        title={`Remove ${member.name || member.email} from your team?`}
        message="They lose access to your Partner workspace straight away and are signed out of it. Their HelloCircle account isn't deleted. Listings and coupons they created stay with your organisation and move to you (who created them is still recorded). Bookings, messages and history are unchanged. They're emailed that they were removed. You can invite them again later; they rejoin only if they accept the new invitation."
        confirmLabel="Remove from team"
        onConfirm={remove}
        onCancel={() => setConfirm(null)}
      />
    </RecordView>
  );
}
