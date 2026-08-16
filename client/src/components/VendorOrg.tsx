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
} from "../api";
import { PLATFORM_ROLES } from "../types";
import type { OrgProfile, Participant, VendorInsights, VendorPayments } from "../types";
import { SearchIcon, TrashIcon, TrendUpIcon, UsersIcon } from "./icons";
import { Button, Card, EmptyState, PageSpinner, Tabs, inputStyle, labelStyle } from "./ui";
import { colors, fonts } from "../theme";

// Organisation entity + Staff + RBAC (Phase C — Gate 2 from the plan doc).
// Sub-tabbed within one "Organisation" top-level tab rather than five
// separate top-level tabs — the plan doc's grouped-sidebar idea, done
// within the existing flat-tab pattern rather than a full nav redesign.

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function SettingsPanel({ profile, reload }: { profile: OrgProfile; reload: () => void }) {
  const [name, setName] = useState(profile.org?.name ?? "");
  const [cancellationHours, setCancellationHours] = useState(profile.policies.cancellationHours);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateOrgProfile({ name });
      await updateOrgPolicies({ cancellationHours });
      reload();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 14px" }}>Organisation profile</h4>
        {!profile.isOwner && <p style={{ fontSize: 12.5, color: colors.orangeDark, marginBottom: 12 }}>Only the organisation owner can edit these settings.</p>}
        <label style={labelStyle}>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={!profile.isOwner} style={{ ...inputStyle, marginBottom: 14 }} />
        <label style={labelStyle}>Cancellation window (hours before start)</label>
        <input type="number" value={cancellationHours} onChange={(e) => setCancellationHours(Number(e.target.value))} disabled={!profile.isOwner} style={{ ...inputStyle, marginBottom: 6, width: 120 }} />
        <p style={{ fontSize: 12, color: colors.faint, margin: "0 0 14px" }}>Stored for reference — hall bookings still enforce the platform's 48h cutoff today; this is the config a future release would read.</p>
        {profile.isOwner && (
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        )}
      </Card>
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 14px" }}>Locations</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {profile.locations.map((l) => (
            <div key={`${l.type}:${l.id}`} style={{ fontSize: 13.5, background: colors.bg, borderRadius: 10, padding: "8px 12px" }}>
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

  const invite = async () => {
    if (!email.trim()) return;
    setInviting(true);
    try {
      await inviteStaff(email.trim(), role);
      setEmail("");
      reload();
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
              <label style={labelStyle}>Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
                {PLATFORM_ROLES.map((r) => (
                  <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
            <Button onClick={invite} disabled={inviting || !email.trim()}>
              {inviting ? "Sending…" : "Send invite"}
            </Button>
          </div>
          <p style={{ fontSize: 12, color: colors.faint, margin: "10px 0 0" }}>
            RBAC is only actually enforced on the Payments tab today (finance role) — every other permission here is recorded, not yet checked.
          </p>
        </Card>
      )}
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 14px" }}>Team</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {profile.staff.map((s) => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, background: colors.bg, borderRadius: 10, padding: "8px 12px" }}>
              <span>{s.name || s.email} <span style={{ color: colors.faint }}>· {s.email}</span></span>
              <span style={{ fontWeight: 700 }}>{s.platformRole ? s.platformRole.replace(/_/g, " ") : "Owner"}</span>
            </div>
          ))}
        </div>
        {profile.pendingInvites.length > 0 && (
          <>
            <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 13, margin: "18px 0 10px", color: colors.muted }}>PENDING INVITES</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {profile.pendingInvites.map((i) => (
                <div key={i.token} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13.5, background: colors.orangeBg, borderRadius: 10, padding: "8px 12px" }}>
                  <span>{i.email} · {i.platformRole.replace(/_/g, " ")}</span>
                  {profile.isOwner && (
                    <button onClick={() => revokeInvite(i.token).then(reload)} style={{ background: "none", border: "none", cursor: "pointer", color: colors.faint }}>
                      <TrashIcon size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ fontSize: 13.5, background: colors.bg, borderRadius: 10, padding: "8px 12px", display: "flex", justifyContent: "space-between" }}>
              <span>{r.name} · {r.email}</span>
              <span style={{ color: colors.faint }}>{r.listingName}</span>
            </div>
          ))}
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
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {data.transactions.map((t) => (
          <div key={t.ref} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, background: colors.bg, borderRadius: 10, padding: "8px 12px" }}>
            <span>{t.listingName} · {t.ref}</span>
            <span style={{ fontWeight: 700 }}>€{(t.totalCents / 100).toFixed(2)} <span style={{ fontWeight: 400, color: colors.faint }}>({t.paymentStatus})</span></span>
          </div>
        ))}
      </div>
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
