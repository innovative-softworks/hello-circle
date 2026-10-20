import { useState } from "react";
import { KeyRound, MailPlus, ShieldCheck } from "lucide-react";
import { createAdminInvite, fetchAdminInvites, fetchAdminMfaStatus, fetchAdmins, regenerateAdminRecoveryCodes, resetAdminMfa, revokeAdminInvite, type AdminInvite } from "../../api";
import { useAuth } from "../../AuthContext";
import { ConfirmDialog } from "../ui";
import { ADMIN_ROLE_LABEL, type AdminRoleName } from "./adminNav";
import { RowMenu, AdminButton, AdminModal, Box, EmptyMessage, FormField, Loaded, StatusTag, formatDate, useAdminAction, useAdminData } from "./adminUi";

// Settings → Admin roles, team access (OG-06 / OG-07): invitations (super
// only, 72-hour single-use links), each admin's two-step status with a reset
// for a lost phone, and the signed-in admin's own recovery codes.

const ROLES: AdminRoleName[] = ["super", "finance", "support", "legal"];

export function AdminInvitesCard() {
  const state = useAdminData(fetchAdminInvites);
  const { run, busy } = useAdminAction();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminRoleName>("support");
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<AdminInvite | null>(null);

  const send = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter a valid email address");
    setError(null);
    const ok = await run("invite", () => createAdminInvite(email.trim(), role), { success: `Invitation sent to ${email.trim()}` });
    if (ok) {
      setOpen(false);
      setEmail("");
      state.reload();
    }
  };

  return (
    <Box
      flush
      icon={MailPlus}
      title="Invitations"
      subtitle="Invite someone to the admin team. The link works once and expires after 72 hours; they set a password and two-step sign-in."
      actions={
        <AdminButton variant="primary" onClick={() => setOpen(true)}>
          Invite an admin
        </AdminButton>
      }
    >
      <Loaded state={state} title="Couldn't load invitations">
        {(invites) =>
          invites.length === 0 ? (
            <EmptyMessage title="No invitations yet" />
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table adm-table--stack">
                <caption className="adm-visually-hidden">Admin invitations</caption>
                <thead>
                  <tr>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th scope="col">Sent</th>
                    <th scope="col">
                      <span className="adm-visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((i) => (
                    <tr key={i.id}>
                      <td data-label="Email">{i.email}</td>
                      <td data-label="Role">{ADMIN_ROLE_LABEL[i.adminRole]}</td>
                      <td data-label="Status">
                        <StatusTag status={i.status === "accepted" ? "active" : i.status === "pending" ? "pending" : "rejected"} label={i.status.charAt(0).toUpperCase() + i.status.slice(1)} />
                      </td>
                      <td data-label="Sent">
                        {formatDate(i.createdAt, true)}
                        {i.invitedByEmail && <div className="adm-note">by {i.invitedByEmail}</div>}
                      </td>
                      <td data-label="">
                        <div className="adm-cell-actions">
                          {i.status === "pending" && (
                            <AdminButton size="sm" onClick={() => setRevoking(i)}>
                              Revoke
                            </AdminButton>
                          )}
                          <RowMenu name={`invitation for ${i.email}`} items={i.status === "pending" ? [{ label: "Revoke…", danger: true, onSelect: () => setRevoking(i) }] : []} copy={{ label: "Copy email", value: i.email }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
      <AdminModal
        open={open}
        onClose={() => setOpen(false)}
        dirty={!!email}
        title="Invite an admin"
        subtitle="Choose the smallest role that lets them do their job. You can change it later."
        footer={
          <>
            <AdminButton variant="quiet" onClick={() => setOpen(false)}>
              Cancel
            </AdminButton>
            <AdminButton variant="primary" onClick={send} disabled={busy === "invite"}>
              {busy === "invite" ? "Sending…" : "Send invitation"}
            </AdminButton>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <FormField label="Email" required error={error}>
            {(p) => <input {...p} type="email" className="adm-input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />}
          </FormField>
          <FormField label="Role" hint="Super: everything. Finance: money, rules, coupons. Support: moderation, support, orders. Legal: policies, complaints, trader checks.">
            {(p) => (
              <select {...p} className="adm-select" value={role} onChange={(e) => setRole(e.target.value as AdminRoleName)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ADMIN_ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </div>
      </AdminModal>
      <ConfirmDialog
        open={!!revoking}
        title="Revoke this invitation?"
        message={`The link sent to ${revoking?.email ?? "them"} stops working. You can send a new one later.`}
        confirmLabel="Revoke invitation"
        onConfirm={() =>
          run("revoke", () => revokeAdminInvite(revoking!.id), { success: "Invitation revoked" }).then((ok) => {
            setRevoking(null);
            state.reload();
            return ok;
          })
        }
        onCancel={() => setRevoking(null)}
      />
    </Box>
  );
}

export function AdminTwoStepCard() {
  const { user } = useAuth();
  const state = useAdminData(fetchAdmins);
  const mine = useAdminData(fetchAdminMfaStatus);
  const { run } = useAdminAction();
  const [resetting, setResetting] = useState<{ id: string; email: string } | null>(null);
  const [reason, setReason] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);

  return (
    <Box flush icon={ShieldCheck} title="Two-step sign-in" subtitle="Every admin signs in with a password and a code from an authenticator app.">
      <Loaded state={state} title="Couldn't load the admin team">
        {(admins) => (
          <div className="adm-table-wrap">
            <table className="adm-table adm-table--stack">
              <caption className="adm-visually-hidden">Two-step sign-in by admin</caption>
              <thead>
                <tr>
                  <th scope="col">Admin</th>
                  <th scope="col">Two-step sign-in</th>
                  <th scope="col">
                    <span className="adm-visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.id}>
                    <td data-label="Admin">
                      {a.name || a.email}
                      <div className="adm-note">{a.email}</div>
                    </td>
                    <td data-label="Two-step sign-in">{a.mfaEnrolled ? <StatusTag status="active" label="On" /> : <StatusTag status="pending" label="Not set up yet" />}</td>
                    <td data-label="">
                      <div className="adm-cell-actions">
                        {a.id !== user?.id && a.mfaEnrolled && (
                          <AdminButton size="sm" onClick={() => setResetting({ id: a.id, email: a.email })}>
                            Reset…
                          </AdminButton>
                        )}
                        <RowMenu
                          name={a.name || a.email}
                          items={a.id !== user?.id && a.mfaEnrolled ? [{ label: "Reset two-step sign-in…", danger: true, onSelect: () => setResetting({ id: a.id, email: a.email }) }] : []}
                          copy={{ label: "Copy email", value: a.email }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Loaded>
      <div style={{ padding: "16px 24px", borderTop: "1px solid var(--adm-line)", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <KeyRound size={18} aria-hidden="true" />
        <span>Your recovery codes: {mine.data ? `${mine.data.recoveryCodesLeft} left` : "…"}</span>
        <AdminButton
          size="sm"
          onClick={() =>
            run("codes", async () => setCodes((await regenerateAdminRecoveryCodes()).recoveryCodes), { success: "New recovery codes made — the old ones no longer work" }).then(() => mine.reload())
          }
        >
          Make new recovery codes
        </AdminButton>
      </div>
      {codes && (
        <div className="adm-callout" style={{ margin: "0 24px 20px" }}>
          <strong>Save these now — they won't be shown again.</strong>
          <ol style={{ columns: 2, fontFamily: "ui-monospace, monospace", margin: "8px 0 0" }}>
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
        </div>
      )}
      <ConfirmDialog
        open={!!resetting}
        title={`Reset two-step sign-in for ${resetting?.email ?? "this admin"}?`}
        message="Use this only when they've lost both their phone and their recovery codes, and you've confirmed who they are. They're signed out everywhere and set up two-step sign-in again next time."
        confirmLabel="Reset two-step sign-in"
        confirmDisabled={reason.trim().length < 10}
        onConfirm={() =>
          run("reset", () => resetAdminMfa(resetting!.id, reason.trim()), { success: "Two-step sign-in reset" }).then((ok) => {
            setResetting(null);
            setReason("");
            state.reload();
            return ok;
          })
        }
        onCancel={() => setResetting(null)}
      >
        <label htmlFor="adm-mfa-reset-reason" style={{ display: "block", fontSize: 13, fontWeight: 600, margin: "12px 0 4px" }}>
          How you confirmed it's them <span aria-hidden="true">*</span>
        </label>
        <textarea id="adm-mfa-reset-reason" className="adm-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: "100%", resize: "vertical" }} />
      </ConfirmDialog>
    </Box>
  );
}
