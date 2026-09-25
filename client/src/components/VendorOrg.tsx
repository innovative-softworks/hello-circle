import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { useGoogleSignIn } from "../googleSignIn";
import { getMediaUrl } from "../media";
import {
  bookingsReportCsvUrl,
  changePassword,
  deactivateVendorAccount,
  fetchOrgProfile,
  fetchParticipants,
  fetchVendorInsights,
  fetchVendorPayments,
  inviteStaff,
  linkVendorGoogleAccount,
  requestManageLink,
  revokeInvite,
  updateOrgPolicies,
  updateOrgProfile,
  updateVendorLogo,
  uploadMedia,
  releaseMedia,
} from "../api";
import { PLATFORM_ROLES, PLATFORM_ROLE_LABELS } from "../types";
import type { OrgProfile, Participant, VendorInsights, VendorPayments } from "../types";
import { CameraIcon, CloseIcon, GoogleIcon, PlusIcon, SearchIcon, TrashIcon, TrendUpIcon, UsersIcon } from "./icons";
import { Button, ManageCard as Card, ConfirmDialog, EmptyState, PageSpinner, Tabs, inputStyle, labelStyle, tableStyle, tdStyle, thStyle } from "./ui";
import { formatDate } from "../vendorFormat";
import { colors, fonts, radius } from "../theme";

// Organisation entity + Staff + RBAC (Phase C — Gate 2 from the plan doc).
// Sub-tabbed within one "Organisation" top-level tab rather than five
// separate top-level tabs — the plan doc's grouped-sidebar idea, done
// within the existing flat-tab pattern rather than a full nav redesign.

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Vendor Experience Polish — PaymentsPanel's transactions now span all four
// Vendor-ownable listing types (previously booking/registration only), so a
// visible Type column is needed to tell them apart.
const PAYMENT_KIND_LABELS: Record<VendorPayments["transactions"][number]["kind"], string> = {
  booking: "Centre",
  registration: "Club",
  program: "Program",
  experience: "Experience",
};

/** Friendly label for a possibly-null/possibly-stale platform_role string —
 * falls back to the raw value (space-swapped) for safety rather than
 * throwing if a future role value isn't in the lookup yet. */
function roleLabel(role: string | null | undefined): string {
  if (!role) return "Owner";
  return (PLATFORM_ROLE_LABELS as Record<string, string>)[role] ?? role.replace(/_/g, " ");
}

// Public profile logo — shown on the provider's public profile page hero
// (ProviderProfile.tsx). Its own small Card + own save flow (upload happens
// immediately on file select, same as MultiImageUpload's pattern) rather
// than folding into SettingsPanel's name/cancellation-hours save button,
// since there's nothing to "save" here beyond the upload itself.
function LogoPanel({ profile, reload }: { profile: OrgProfile; reload: () => void }) {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !user?.orgId) return;
    setUploading(true);
    setError(null);
    try {
      const previous = profile.logo;
      const { url } = await uploadMedia(file, "org-logo", user.orgId);
      await updateVendorLogo(url);
      if (previous) releaseMedia("org-logo", user.orgId, previous);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    setError(null);
    await updateVendorLogo(null);
    if (profile.logo && user?.orgId) releaseMedia("org-logo", user.orgId, profile.logo);
    reload();
  };

  if (!profile.isOwner) return null;

  return (
    <Card>
      <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Public profile logo</h4>
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>
        Shown on your public provider profile page. JPEG, PNG, WebP or GIF, up to 8MB.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {profile.logo ? (
          <div style={{ position: "relative", width: 72, height: 72, flex: "none" }}>
            <div style={{ width: "100%", height: "100%", borderRadius: radius.control, border: `1px solid ${colors.border}`, background: colors.bg, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <img src={getMediaUrl(profile.logo, "card")} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            </div>
            <button
              onClick={remove}
              aria-label="Remove logo"
              style={{ position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: "50%", border: "none", background: "rgba(20,22,20,.7)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              <CloseIcon size={12} />
            </button>
          </div>
        ) : (
          <label
            className="image-drop"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              width: 72,
              height: 72,
              flex: "none",
              border: `1.5px dashed ${colors.borderStrong}`,
              borderRadius: radius.control,
              background: colors.bg,
              color: colors.mutedLight,
              fontSize: 11,
              cursor: uploading ? "default" : "pointer",
              textAlign: "center",
            }}
          >
            {uploading ? <CameraIcon size={16} /> : <PlusIcon size={16} />}
            {uploading ? "Uploading…" : "Add logo"}
            <input type="file" accept="image/*" onChange={(e) => onFile(e.target.files)} disabled={uploading} style={{ display: "none" }} />
          </label>
        )}
      </div>
      {error && <p style={{ color: colors.danger, fontSize: 12, margin: "10px 0 0" }}>{error}</p>}
    </Card>
  );
}

function SettingsPanel({ profile, reload }: { profile: OrgProfile; reload: () => void }) {
  const [name, setName] = useState(profile.org?.name ?? "");
  // Host Manage spec §26 — bio/website/socials, alongside name. `description`
  // is a real bug fix: it was only ever settable once, at signup, with no
  // edit route anywhere despite being shown on the public provider profile.
  const [description, setDescription] = useState(profile.description ?? "");
  const [website, setWebsite] = useState(profile.website ?? "");
  const [instagram, setInstagram] = useState(profile.socials.instagram ?? "");
  const [facebook, setFacebook] = useState(profile.socials.facebook ?? "");
  const [xHandle, setXHandle] = useState(profile.socials.x ?? "");
  const [cancellationHours, setCancellationHours] = useState(profile.policies.cancellationHours);
  // Host Manage spec §20 — refund policy copy + tax/business registration,
  // alongside the existing cancellation-hours field. Notification
  // preferences and a "Privacy" toggle are deliberately not here — no
  // per-vendor-user preference infrastructure exists (residents have one,
  // vendors don't), and there's no concrete privacy setting to attach a
  // toggle to; both would be new features, not a settings-form addition.
  const [refundPolicyText, setRefundPolicyText] = useState(profile.policies.refundPolicyText ?? "");
  const [taxNumber, setTaxNumber] = useState(profile.policies.taxNumber ?? "");
  const [businessRegistrationNumber, setBusinessRegistrationNumber] = useState(profile.policies.businessRegistrationNumber ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearFeedback = () => {
    setSaved(false);
    setError(null);
  };

  const save = async () => {
    if (!name.trim()) {
      setError("Organisation name is required");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateOrgProfile({ name, description, website, socials: { instagram, facebook, x: xHandle } });
      await updateOrgPolicies({ cancellationHours, refundPolicyText, taxNumber, businessRegistrationNumber });
      setSaved(true);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 14px" }}>Organisation profile</h4>
        {!profile.isOwner && <p style={{ fontSize: 12.5, color: colors.orangeDark, marginBottom: 12 }}>Only the organisation owner can edit these settings.</p>}
        <label htmlFor="org-settings-name" style={labelStyle}>Name</label>
        <input id="org-settings-name" value={name} onChange={(e) => { setName(e.target.value); clearFeedback(); }} disabled={!profile.isOwner} style={{ ...inputStyle, marginBottom: 14 }} />
        <label htmlFor="org-settings-description" style={labelStyle}>Bio</label>
        <textarea
          id="org-settings-description"
          value={description}
          onChange={(e) => { setDescription(e.target.value); clearFeedback(); }}
          disabled={!profile.isOwner}
          rows={3}
          style={{ ...inputStyle, resize: "vertical", marginBottom: 14 }}
          placeholder="Shown on your public provider profile — who you are and what you offer."
        />
        <label htmlFor="org-settings-website" style={labelStyle}>Website</label>
        <input id="org-settings-website" value={website} onChange={(e) => { setWebsite(e.target.value); clearFeedback(); }} disabled={!profile.isOwner} style={{ ...inputStyle, marginBottom: 14 }} placeholder="https://…" />
        <label style={labelStyle}>Social links</label>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <input value={instagram} onChange={(e) => { setInstagram(e.target.value); clearFeedback(); }} disabled={!profile.isOwner} style={{ ...inputStyle, flex: "1 1 160px" }} placeholder="Instagram URL" />
          <input value={facebook} onChange={(e) => { setFacebook(e.target.value); clearFeedback(); }} disabled={!profile.isOwner} style={{ ...inputStyle, flex: "1 1 160px" }} placeholder="Facebook URL" />
          <input value={xHandle} onChange={(e) => { setXHandle(e.target.value); clearFeedback(); }} disabled={!profile.isOwner} style={{ ...inputStyle, flex: "1 1 160px" }} placeholder="X (Twitter) URL" />
        </div>
        <label htmlFor="org-settings-cancellation-hours" style={labelStyle}>Cancellation window (hours before start)</label>
        <input id="org-settings-cancellation-hours" type="number" value={cancellationHours} onChange={(e) => { setCancellationHours(Number(e.target.value)); clearFeedback(); }} disabled={!profile.isOwner} aria-describedby="org-settings-cancellation-hint" style={{ ...inputStyle, marginBottom: 6, width: 120 }} />
        <p id="org-settings-cancellation-hint" style={{ fontSize: 12, color: colors.faint, margin: "0 0 14px" }}>Enforced on every hall booking cancellation/reschedule across your organisation's centres.</p>
        <label htmlFor="org-settings-refund-policy" style={labelStyle}>Refund policy</label>
        <textarea id="org-settings-refund-policy" value={refundPolicyText} onChange={(e) => { setRefundPolicyText(e.target.value); clearFeedback(); }} disabled={!profile.isOwner} rows={3} style={{ ...inputStyle, resize: "vertical", marginBottom: 14 }} placeholder="Shown to guests alongside your cancellation window — e.g. how refunds work for cancelled sessions." />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <div style={{ flex: "1 1 180px" }}>
            <label htmlFor="org-settings-tax-number" style={labelStyle}>Tax number</label>
            <input id="org-settings-tax-number" value={taxNumber} onChange={(e) => { setTaxNumber(e.target.value); clearFeedback(); }} disabled={!profile.isOwner} style={inputStyle} />
          </div>
          <div style={{ flex: "1 1 180px" }}>
            <label htmlFor="org-settings-business-reg" style={labelStyle}>Business registration number</label>
            <input id="org-settings-business-reg" value={businessRegistrationNumber} onChange={(e) => { setBusinessRegistrationNumber(e.target.value); clearFeedback(); }} disabled={!profile.isOwner} style={inputStyle} />
          </div>
        </div>
        {error && <p role="alert" className="pop-in" style={{ color: colors.danger, fontSize: 13, margin: "0 0 12px", background: colors.dangerBg, padding: "9px 12px", borderRadius: radius.control }}>{error}</p>}
        {profile.isOwner && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {saved && <span style={{ fontSize: 13, color: colors.greenText, fontWeight: 600 }}>Saved</span>}
          </div>
        )}
      </Card>
      <LogoPanel profile={profile} reload={reload} />
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 14px" }}>Locations</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {profile.locations.map((l) => (
            <div key={`${l.type}:${l.id}`} style={{ fontSize: 13.5, background: colors.bg, borderRadius: radius.control, padding: "8px 12px" }}>
              {l.name} <span style={{ color: colors.faint }}>· {l.type}</span>
            </div>
          ))}
          {profile.locations.length === 0 && <span style={{ fontSize: 13, color: colors.faint }}>No listings yet.</span>}
        </div>
      </Card>
      <AccountSettingsPanel />
    </div>
  );
}

// Host Manage spec §28 — change-password (only the unauthenticated
// forgot-password email flow existed before) and account deactivation
// (same soft, self-reversing pattern as residents.ts's own). Payout
// account/2FA are deliberately not here — no Stripe Connect concept exists
// anywhere in this codebase, and 2FA is separate new auth infrastructure.
function AccountSettingsPanel() {
  const navigate = useNavigate();
  const { user, refresh } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaved, setPwSaved] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  // Platform Pre-Launch Polish — Changeset 1. requestManageLink() already
  // existed with zero callers anywhere in the client — the vendor side of
  // account linking had no UI at all, not just the confirm-page fix the
  // audit found. Slotted in here since Account Settings is the natural,
  // already-existing home for "link your accounts" alongside password/
  // deactivate, and this is the vendor-authenticated step that kicks off
  // the flow /manage/link-confirm completes.
  const [linkEmail, setLinkEmail] = useState("");
  const [linkSending, setLinkSending] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSent, setLinkSent] = useState(false);
  // Account-linking audit follow-up: linking a Google identity onto this
  // account now only ever happens from here — an authenticated session —
  // never inferred from a matching email during sign-in (see the doc
  // comment on POST /auth/google in server/src/routes/auth.ts).
  const [googleLinked, setGoogleLinked] = useState(false);
  const { busy: googleLinking, error: googleLinkError, trigger: linkGoogle } = useGoogleSignIn(async (idToken) => {
    await linkVendorGoogleAccount(idToken);
    setGoogleLinked(true);
  });

  const sendLinkRequest = async () => {
    setLinkError(null);
    setLinkSent(false);
    if (!linkEmail.trim()) {
      setLinkError("Enter the email of the HelloCircle account to link");
      return;
    }
    setLinkSending(true);
    try {
      await requestManageLink(linkEmail.trim());
      setLinkSent(true);
      setLinkEmail("");
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : "Couldn't send that link");
    } finally {
      setLinkSending(false);
    }
  };

  const savePassword = async () => {
    setPwError(null);
    setPwSaved(false);
    if (!currentPassword || !newPassword) {
      setPwError("Both fields are required");
      return;
    }
    setPwSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setPwSaved(true);
    } catch (e) {
      setPwError(e instanceof Error ? e.message : "Couldn't change your password");
    } finally {
      setPwSaving(false);
    }
  };

  const deactivate = async () => {
    setDeactivating(true);
    try {
      await deactivateVendorAccount();
      await refresh();
      navigate("/");
    } finally {
      setDeactivating(false);
      setConfirmingDeactivate(false);
    }
  };

  return (
    <Card>
      <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 14px" }}>Account</h4>
      <label htmlFor="vendor-current-password" style={labelStyle}>Current password</label>
      <input id="vendor-current-password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }} />
      <label htmlFor="vendor-new-password" style={labelStyle}>New password</label>
      <input id="vendor-new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }} />
      {pwError && <p style={{ color: colors.danger, fontSize: 12.5, margin: "0 0 10px" }}>{pwError}</p>}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
        <Button onClick={savePassword} disabled={pwSaving}>{pwSaving ? "Saving…" : "Change password"}</Button>
        {pwSaved && <span style={{ fontSize: 13, color: colors.greenText, fontWeight: 600 }}>Saved</span>}
      </div>
      <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 18, marginBottom: 22 }}>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 8px" }}>Google sign-in</h4>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 10px" }}>
          Link your Google account so you can log in with it instead of your password.
        </p>
        <button
          type="button"
          onClick={linkGoogle}
          disabled={googleLinking || googleLinked}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 14px", border: `1px solid ${colors.inputBorder}`, borderRadius: 10, background: colors.surface, fontSize: 13.5, fontWeight: 700, color: colors.text, cursor: googleLinking || googleLinked ? "default" : "pointer", opacity: googleLinking ? 0.7 : 1 }}
        >
          <GoogleIcon size={16} /> {googleLinked ? "Linked ✓" : googleLinking ? "Linking…" : "Link Google account"}
        </button>
        {googleLinkError && <p style={{ color: colors.danger, fontSize: 12.5, margin: "8px 0 0" }}>{googleLinkError}</p>}
      </div>
      <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 18, marginBottom: 22 }}>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 8px" }}>Linked HelloCircle account</h4>
        {user?.residentId ? (
          <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: 0 }}>
            This vendor login is linked to a personal HelloCircle account — switch between them any time from the account menu.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 10px" }}>
              Link this vendor login to your own HelloCircle (resident) account so you can switch between them without signing in twice. We'll email a confirmation link to that account to prove it's really yours.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                type="email"
                value={linkEmail}
                onChange={(e) => setLinkEmail(e.target.value)}
                placeholder="you@example.com"
                style={{ ...inputStyle, flex: "1 1 220px" }}
              />
              <Button onClick={sendLinkRequest} disabled={linkSending}>{linkSending ? "Sending…" : "Send link"}</Button>
            </div>
            {linkError && <p style={{ color: colors.danger, fontSize: 12.5, margin: "8px 0 0" }}>{linkError}</p>}
            {linkSent && <p style={{ color: colors.greenText, fontSize: 12.5, fontWeight: 600, margin: "8px 0 0" }}>Confirmation link sent — check that account's inbox.</p>}
          </>
        )}
      </div>
      <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 18 }}>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 10px" }}>
          Deactivating signs you out immediately — signing back in reactivates your account, same as before.
        </p>
        <Button variant="danger" onClick={() => setConfirmingDeactivate(true)}>Deactivate account</Button>
      </div>
      <ConfirmDialog
        open={confirmingDeactivate}
        title="Deactivate your account?"
        message="You'll be signed out right away. Log back in any time to reactivate."
        confirmLabel={deactivating ? "Deactivating…" : "Deactivate"}
        busy={deactivating}
        onConfirm={deactivate}
        onCancel={() => setConfirmingDeactivate(false)}
      />
    </Card>
  );
}

function StaffPanel({ profile, reload }: { profile: OrgProfile; reload: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>(PLATFORM_ROLES[0]);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invited, setInvited] = useState(false);
  const [confirmingToken, setConfirmingToken] = useState<string | null>(null);

  const invite = async () => {
    if (!email.trim()) return;
    setInviting(true);
    setInviteError(null);
    setInvited(false);
    try {
      await inviteStaff(email.trim(), role);
      setEmail("");
      setInvited(true);
      reload();
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Couldn't send that invite");
    } finally {
      setInviting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {profile.isOwner && (
        <Card>
          <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 14px" }}>Invite staff</h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 220px" }}>
              <label htmlFor="org-staff-invite-email" style={labelStyle}>Email</label>
              <input id="org-staff-invite-email" value={email} onChange={(e) => { setEmail(e.target.value); setInviteError(null); setInvited(false); }} style={inputStyle} />
            </div>
            <div>
              <label htmlFor="org-staff-invite-role" style={labelStyle}>Role</label>
              <select id="org-staff-invite-role" value={role} onChange={(e) => { setRole(e.target.value); setInviteError(null); setInvited(false); }} style={inputStyle}>
                {PLATFORM_ROLES.map((r) => (
                  <option key={r} value={r}>{PLATFORM_ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
            <Button onClick={invite} disabled={inviting || !email.trim()}>
              {inviting ? "Sending…" : "Send invite"}
            </Button>
            {invited && <span style={{ fontSize: 13, color: colors.greenText, fontWeight: 600 }}>Invite sent</span>}
          </div>
          {inviteError && <p role="alert" className="pop-in" style={{ color: colors.danger, fontSize: 13, margin: "10px 0 0", background: colors.dangerBg, padding: "9px 12px", borderRadius: radius.control }}>{inviteError}</p>}
          <p style={{ fontSize: 12, color: colors.faint, margin: "10px 0 0" }}>
            RBAC is enforced on: editing/deleting centres and programs on centres (centre manager), editing/deleting clubs, club sessions and programs on clubs (facility manager), check-in (whichever manager matches booking vs. registration), Payments and reports (finance), demand insights (finance/read-only analyst), and sending messages (communications). The org owner always has full access regardless of role.
          </p>
        </Card>
      )}
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 14px" }}>Team</h4>
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Role</th>
              </tr>
            </thead>
            <tbody>
              {profile.staff.map((s) => (
                <tr key={s.id}>
                  <td style={tdStyle}>{s.name || "—"}</td>
                  <td style={tdStyle}>{s.email}</td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{roleLabel(s.platformRole)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {profile.pendingInvites.length > 0 && (
          <>
            <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 13, margin: "18px 0 10px", color: colors.muted }}>PENDING INVITES</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {profile.pendingInvites.map((i) => (
                <div key={i.token} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13.5, background: colors.orangeBg, borderRadius: radius.control, padding: "8px 12px" }}>
                  <span>{i.email} · {roleLabel(i.platformRole)}</span>
                  {profile.isOwner && (
                    <button onClick={() => setConfirmingToken(i.token)} style={{ background: "none", border: "none", cursor: "pointer", color: colors.faint }}>
                      <TrashIcon size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <ConfirmDialog
        open={confirmingToken !== null}
        title="Revoke this invite?"
        message="They won't be able to accept it anymore. You can send a new invite to the same email at any time."
        confirmLabel="Revoke"
        onConfirm={() => { if (confirmingToken !== null) revokeInvite(confirmingToken).then(reload); setConfirmingToken(null); }}
        onCancel={() => setConfirmingToken(null)}
      />
    </div>
  );
}

function ParticipantsPanel() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);

  const load = (query: string) => {
    setLoading(true);
    fetchParticipants(query).then(setRows).finally(() => setLoading(false));
  };
  useEffect(() => load(""), []);

  return (
    <Card>
      <div style={{ position: "relative", marginBottom: 16 }}>
        <SearchIcon size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: colors.faint }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load(q)}
          placeholder="Search participants by name or email"
          style={{ ...inputStyle, paddingLeft: 36 }}
        />
      </div>
      {loading ? null : rows.length === 0 ? (
        <EmptyState icon={<UsersIcon size={22} />} title="No participants found" />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Listing</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={tdStyle}>{r.name}</td>
                  <td style={tdStyle}>{r.email}</td>
                  <td style={{ ...tdStyle, color: colors.faint }}>{r.listingName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function InsightsPanel() {
  const [insights, setInsights] = useState<VendorInsights | null>(null);
  useEffect(() => {
    fetchVendorInsights().then(setInsights);
  }, []);
  if (!insights) return <PageSpinner />;

  const { totals } = insights;
  const cancellationRate = totals.totalBookings > 0 ? Math.round((totals.cancelledBookings / totals.totalBookings) * 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {(insights.narrative || insights.trend.lastMonth > 0) && (
        <Card style={{ background: colors.greenBg, border: "none" }}>
          {insights.narrative && <p style={{ margin: insights.trend.lastMonth > 0 ? "0 0 8px" : 0, fontSize: 14, fontWeight: 700, color: colors.greenText }}>{insights.narrative}</p>}
          {insights.trend.lastMonth > 0 && (
            <p style={{ margin: 0, fontSize: 13, color: colors.greenText }}>
              {insights.trend.thisMonth} bookings/registrations this month
              {insights.trend.deltaPercent !== null && (
                <> — <strong>{insights.trend.deltaPercent >= 0 ? "+" : ""}{insights.trend.deltaPercent}%</strong> vs last month</>
              )}
            </p>
          )}
        </Card>
      )}
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 14px" }}>Participation</h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14 }}>
          {[
            { label: "Hall bookings", value: totals.totalBookings },
            { label: "Club registrations", value: totals.totalRegistrations },
            { label: "Unique bookers", value: totals.uniqueBookers },
            { label: "Cancellation rate", value: `${cancellationRate}%` },
          ].map((s) => (
            <div key={s.label}>
              <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 24 }}>{s.value}</div>
              <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{s.label}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Hall booking utilisation</h4>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>Paid bookings by day of week and starting hour.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {insights.utilisation.length === 0 ? (
            <span style={{ fontSize: 13, color: colors.faint }}>No bookings yet.</span>
          ) : (
            insights.utilisation.map((u, i) => (
              <span key={i} style={{ fontSize: 12, background: colors.greenBg, color: colors.greenText, borderRadius: 8, padding: "5px 9px", fontWeight: 700 }}>
                {DAY_NAMES[(u.dayOfWeek - 1) % 7]} {u.hour}:00 — {u.n}
              </span>
            ))
          )}
        </div>
      </Card>
      <Button variant="ghost" onClick={() => window.open(bookingsReportCsvUrl(), "_blank")}>
        Export bookings CSV
      </Button>
    </div>
  );
}

type PaymentsFilter = "all" | "paid" | "refunded";

// Host Manage spec §20/§21 — promoted to a top-level "Earnings" tab in
// VendorDashboard.tsx (still finance-gated, same component, just relocated
// out of the Organisation tab's sub-nav to match the spec's own IA). Vendor
// Experience Polish added the Paid/Refunded filter below — the brief's
// "Earnings > Overview / Transactions / Refunds" possible structure,
// implemented as a filter over the one existing transaction list rather
// than new sub-tabs/routes/queries, since it's the same data either way.
export function PaymentsPanel() {
  const [data, setData] = useState<VendorPayments | "forbidden" | null>(null);
  const [filter, setFilter] = useState<PaymentsFilter>("all");
  useEffect(() => {
    fetchVendorPayments()
      .then(setData)
      .catch(() => setData("forbidden"));
  }, []);

  if (data === null) return <PageSpinner />;
  if (data === "forbidden") {
    return <EmptyState icon={<UsersIcon size={22} />} title="Finance access required" subtitle="This tab is restricted to the organisation owner or staff with the finance role." />;
  }

  const filteredTransactions = data.transactions.filter((t) => filter === "all" || t.paymentStatus === filter);

  return (
    <Card>
      <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 22, marginBottom: 4 }}>€{(data.totalPaidCents / 100).toFixed(2)}</div>
      {/* Vendor Experience Polish — totalPaidCents is now a true SUM across
          every paid booking/registration/enrollment/experience-booking, not
          derived from the transactions list below (which stays capped for
          display) — the old "last 200 transactions" caption was actively
          misleading about what the total represented, so it's dropped. */}
      <div style={{ fontSize: 12.5, color: colors.mutedLight, marginBottom: 18 }}>Total paid, all time</div>
      {data.transactions.length === 0 ? (
        <EmptyState icon={<UsersIcon size={22} />} title="No transactions yet" />
      ) : (
        <>
          <div style={{ marginBottom: 14 }}>
            <Tabs
              value={filter}
              onChange={setFilter}
              options={[
                { key: "all", label: "All" },
                { key: "paid", label: "Paid" },
                { key: "refunded", label: "Refunded" },
              ]}
            />
          </div>
          {filteredTransactions.length === 0 ? (
            <EmptyState icon={<UsersIcon size={22} />} title="No transactions match this filter" />
          ) : (
            <>
              {/* Vendor Experience Polish — mobile card fallback, avoids
                  horizontal scrolling on a phone-width transaction table. */}
              <div className="mobile-cards">
                {filteredTransactions.map((t) => (
                  <Card key={t.ref}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontFamily: "monospace", fontSize: 12.5 }}>{t.ref}</span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: t.paymentStatus === "refunded" ? colors.muted : colors.greenText,
                          background: t.paymentStatus === "refunded" ? colors.panel : colors.greenBg,
                          borderRadius: radius.pill,
                          padding: "2px 8px",
                          textTransform: "capitalize",
                        }}
                      >
                        {t.paymentStatus}
                      </span>
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 2 }}>{t.listingName}</div>
                    <div style={{ fontSize: 12, color: colors.mutedLight, marginBottom: 8 }}>
                      {PAYMENT_KIND_LABELS[t.kind]} · {formatDate(t.createdAt)}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>€{(t.totalCents / 100).toFixed(2)}</div>
                  </Card>
                ))}
              </div>
              <div className="hide-mobile" style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Listing</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Ref</th>
                    <th style={thStyle}>Amount</th>
                    <th style={thStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((t) => (
                    <tr key={t.ref}>
                      <td style={tdStyle}>{t.listingName}</td>
                      <td style={{ ...tdStyle, color: colors.mutedLight }}>{PAYMENT_KIND_LABELS[t.kind]}</td>
                      <td style={{ ...tdStyle, fontFamily: "monospace" }}>{t.ref}</td>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>€{(t.totalCents / 100).toFixed(2)}</td>
                      <td style={{ ...tdStyle, color: colors.mutedLight }}>{t.paymentStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
}

export function VendorOrgTab() {
  const [profile, setProfile] = useState<OrgProfile | null>(null);
  const [subTab, setSubTab] = useState<"settings" | "staff" | "participants" | "insights">("settings");

  const load = () => fetchOrgProfile().then(setProfile);
  useEffect(() => {
    load();
  }, []);

  if (!profile) return <PageSpinner />;

  return (
    <div className="fade-panel">
      <div style={{ marginBottom: 20 }}>
        <Tabs
          value={subTab}
          onChange={setSubTab}
          options={[
            { key: "settings", label: "Settings" },
            { key: "staff", label: "Staff & roles" },
            { key: "participants", label: "Participants" },
            { key: "insights", label: "Insights", icon: <TrendUpIcon size={13} /> },
          ]}
        />
      </div>
      {subTab === "settings" && <SettingsPanel profile={profile} reload={load} />}
      {subTab === "staff" && <StaffPanel profile={profile} reload={load} />}
      {subTab === "participants" && <ParticipantsPanel />}
      {subTab === "insights" && <InsightsPanel />}
    </div>
  );
}
