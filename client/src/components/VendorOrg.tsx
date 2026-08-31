import { useEffect, useState } from "react";
import {
  bookingsReportCsvUrl,
  fetchOrgProfile,
  fetchParticipants,
  fetchVendorInsights,
  fetchVendorPayments,
  inviteStaff,
  revokeInvite,
  updateOrgPolicies,
  updateOrgProfile,
  updateVendorLogo,
  uploadImage,
} from "../api";
import { PLATFORM_ROLES } from "../types";
import type { OrgProfile, Participant, VendorInsights, VendorPayments } from "../types";
import { CameraIcon, CloseIcon, PlusIcon, SearchIcon, TrashIcon, TrendUpIcon, UsersIcon } from "./icons";
import { Button, ManageCard as Card, ConfirmDialog, EmptyState, PageSpinner, Tabs, inputStyle, labelStyle, tableStyle, tdStyle, thStyle } from "./ui";
import { colors, fonts, radius } from "../theme";

// Organisation entity + Staff + RBAC (Phase C — Gate 2 from the plan doc).
// Sub-tabbed within one "Organisation" top-level tab rather than five
// separate top-level tabs — the plan doc's grouped-sidebar idea, done
// within the existing flat-tab pattern rather than a full nav redesign.

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Public profile logo — shown on the provider's public profile page hero
// (ProviderProfile.tsx). Its own small Card + own save flow (upload happens
// immediately on file select, same as MultiImageUpload's pattern) rather
// than folding into SettingsPanel's name/cancellation-hours save button,
// since there's nothing to "save" here beyond the upload itself.
function LogoPanel({ profile, reload }: { profile: OrgProfile; reload: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { url } = await uploadImage(file);
      await updateVendorLogo(url);
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
              <img src={profile.logo} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
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
  const [cancellationHours, setCancellationHours] = useState(profile.policies.cancellationHours);
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
      await updateOrgProfile({ name });
      await updateOrgPolicies({ cancellationHours });
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
        <label htmlFor="org-settings-cancellation-hours" style={labelStyle}>Cancellation window (hours before start)</label>
        <input id="org-settings-cancellation-hours" type="number" value={cancellationHours} onChange={(e) => { setCancellationHours(Number(e.target.value)); clearFeedback(); }} disabled={!profile.isOwner} aria-describedby="org-settings-cancellation-hint" style={{ ...inputStyle, marginBottom: 6, width: 120 }} />
        <p id="org-settings-cancellation-hint" style={{ fontSize: 12, color: colors.faint, margin: "0 0 14px" }}>Enforced on every hall booking cancellation/reschedule across your organisation's centres.</p>
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
    </div>
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
                  <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
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
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{s.platformRole ? s.platformRole.replace(/_/g, " ") : "Owner"}</td>
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
                  <span>{i.email} · {i.platformRole.replace(/_/g, " ")}</span>
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

function PaymentsPanel() {
  const [data, setData] = useState<VendorPayments | "forbidden" | null>(null);
  useEffect(() => {
    fetchVendorPayments()
      .then(setData)
      .catch(() => setData("forbidden"));
  }, []);

  if (data === null) return <PageSpinner />;
  if (data === "forbidden") {
    return <EmptyState icon={<UsersIcon size={22} />} title="Finance access required" subtitle="This tab is restricted to the organisation owner or staff with the finance role." />;
  }

  return (
    <Card>
      <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 22, marginBottom: 4 }}>€{(data.totalPaidCents / 100).toFixed(2)}</div>
      <div style={{ fontSize: 12.5, color: colors.mutedLight, marginBottom: 18 }}>Total paid, last 200 transactions</div>
      {data.transactions.length === 0 ? (
        <EmptyState icon={<UsersIcon size={22} />} title="No transactions yet" />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Listing</th>
                <th style={thStyle}>Ref</th>
                <th style={thStyle}>Amount</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.map((t) => (
                <tr key={t.ref}>
                  <td style={tdStyle}>{t.listingName}</td>
                  <td style={{ ...tdStyle, fontFamily: "monospace" }}>{t.ref}</td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>€{(t.totalCents / 100).toFixed(2)}</td>
                  <td style={{ ...tdStyle, color: colors.mutedLight }}>{t.paymentStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function VendorOrgTab() {
  const [profile, setProfile] = useState<OrgProfile | null>(null);
  const [subTab, setSubTab] = useState<"settings" | "staff" | "participants" | "insights" | "payments">("settings");

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
            { key: "payments", label: "Payments" },
          ]}
        />
      </div>
      {subTab === "settings" && <SettingsPanel profile={profile} reload={load} />}
      {subTab === "staff" && <StaffPanel profile={profile} reload={load} />}
      {subTab === "participants" && <ParticipantsPanel />}
      {subTab === "insights" && <InsightsPanel />}
      {subTab === "payments" && <PaymentsPanel />}
    </div>
  );
}
