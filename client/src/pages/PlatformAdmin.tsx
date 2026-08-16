import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchAuditLog,
  fetchFeatureFlags,
  fetchModerationReports,
  fetchPlatformDashboard,
  fetchPlatformUsers,
  fetchSystemStatus,
  fetchTenants,
  resolveReport,
  setFeatureFlag,
  supportSearch,
} from "../api";
import { useAuth } from "../AuthContext";
import { BuildingIcon, CheckIcon, ClipboardIcon, IdCardIcon, SearchIcon, TrendUpIcon, UsersIcon } from "../components/icons";
import { Button, Card, EmptyState, PageSpinner, StatRow, StatTile, Tabs, inputStyle } from "../components/ui";
import { colors, fonts, maxWidth } from "../theme";
import type { AuditEntry, FeatureFlag, ModerationReport, PlatformDashboardStats, TenantSummary } from "../types";

// Platform Admin (Phase D, best-effort — see the gap-analysis plan doc's
// "decisions" section). Reuses the existing admin role rather than a
// separate platform-staff identity: there is exactly one real tenant
// today, so there's no real distinction yet between "runs this
// organisation" and "runs the platform" worth enforcing separately.
// Built anyway at the requester's direction rather than skipped — every
// screen below is real and working, none of it is load-bearing.

function DashboardPanel() {
  const [stats, setStats] = useState<PlatformDashboardStats | null>(null);
  useEffect(() => {
    fetchPlatformDashboard().then(setStats);
  }, []);
  if (!stats) return <PageSpinner />;
  return (
    <StatRow>
      <StatTile icon={<BuildingIcon size={19} />} iconBg={colors.greenBg} iconColor={colors.green} value={stats.tenants} label="Tenants" sublabel="Organisations" sublabelColor={colors.greenText} />
      <StatTile icon={<ClipboardIcon size={19} />} iconBg={colors.orangeBg} iconColor={colors.orange} value={stats.activeListings} label="Active listings" sublabel="Platform-wide" sublabelColor={colors.orangeDark} />
      <StatTile icon={<CheckIcon size={19} />} iconBg="#E9F0FC" iconColor="#3B5FCC" value={stats.bookingsToday} label="Bookings today" sublabel="All types" sublabelColor="#3B5FCC" />
      <StatTile icon={<IdCardIcon size={19} />} iconBg="#F6E3E3" iconColor="#b00020" value={stats.paymentFailures} label="Payment failures" sublabel="All time" sublabelColor="#b00020" />
      <StatTile icon={<UsersIcon size={19} />} iconBg={colors.panel} iconColor={colors.muted} value={stats.openReports} label="Open reports" sublabel="Moderation queue" sublabelColor={colors.mutedLight} />
    </StatRow>
  );
}

function TenantsPanel() {
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);

  useEffect(() => {
    fetchTenants().then(setTenants);
  }, []);

  useEffect(() => {
    if (selected) fetchFeatureFlags(selected).then(setFlags);
  }, [selected]);

  const toggleFlag = async (flagKey: string, enabled: boolean) => {
    if (!selected) return;
    await setFeatureFlag(selected, flagKey, enabled);
    setFlags((f) => f.map((fl) => (fl.flagKey === flagKey ? { ...fl, enabled } : fl)));
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 1fr" : "1fr", gap: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {tenants.map((t) => (
          <Card key={t.id} hover onClick={() => setSelected(t.id)} style={{ padding: 15, display: "flex", justifyContent: "space-between", alignItems: "center", border: selected === t.id ? `1px solid ${colors.green}` : undefined }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{t.name}</div>
              <div style={{ fontSize: 12, color: colors.mutedLight }}>{t.kind} · {t.userCount} users · {t.listingCount} listings</div>
            </div>
          </Card>
        ))}
        {tenants.length === 0 && <EmptyState icon={<BuildingIcon size={26} />} title="No organisations yet" />}
      </div>
      {selected && (
        <Card>
          <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Feature flags</h4>
          <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>Per-organisation — nothing in the app reads these yet outside this toggle.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {flags.map((f) => (
              <label key={f.flagKey} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14, background: colors.bg, borderRadius: 10, padding: "10px 12px" }}>
                {f.flagKey.replace(/_/g, " ")}
                <input type="checkbox" checked={f.enabled} onChange={(e) => toggleFlag(f.flagKey, e.target.checked)} style={{ accentColor: colors.green }} />
              </label>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function UsersPanel() {
  const [users, setUsers] = useState<{ id: string; email: string; name: string; role: string; status: string; orgId: string | null; platformRole: string | null; createdAt: string }[]>([]);
  useEffect(() => {
    fetchPlatformUsers().then(setUsers);
  }, []);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {users.map((u) => (
        <Card key={u.id} style={{ padding: 13, display: "flex", justifyContent: "space-between", fontSize: 13.5 }}>
          <span>{u.name || u.email} · {u.email}</span>
          <span style={{ color: colors.mutedLight }}>{u.role}{u.platformRole ? ` · ${u.platformRole.replace(/_/g, " ")}` : ""} · {u.status}</span>
        </Card>
      ))}
      {users.length === 0 && <EmptyState icon={<UsersIcon size={26} />} title="No users" />}
    </div>
  );
}

function ModerationPanel() {
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const load = () => fetchModerationReports().then(setReports);
  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {reports.map((r) => (
        <Card key={r.id} style={{ padding: 15 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{r.targetType} · {r.targetId}</div>
              <div style={{ fontSize: 13, color: colors.mutedLight, marginTop: 2 }}>{r.reason}</div>
            </div>
            <div style={{ display: "flex", gap: 8, flex: "none" }}>
              <Button variant="ghost" onClick={() => resolveReport(r.id, "dismissed").then(load)}>Dismiss</Button>
              <Button variant="danger" onClick={() => resolveReport(r.id, "actioned").then(load)}>Action</Button>
            </div>
          </div>
        </Card>
      ))}
      {reports.length === 0 && <EmptyState icon={<IdCardIcon size={26} />} title="Nothing pending" subtitle="No reports waiting on review." />}
    </div>
  );
}

function AuditPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  useEffect(() => {
    fetchAuditLog().then(setEntries);
  }, []);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {entries.map((e) => (
        <Card key={e.id} style={{ padding: 12, fontSize: 13 }}>
          <strong>{e.action}</strong> on {e.objectType} <code>{e.objectId}</code> by {e.actorEmail ?? "system"}
          <div style={{ color: colors.faint, fontSize: 11.5, marginTop: 2 }}>{new Date(e.createdAt).toLocaleString()}</div>
        </Card>
      ))}
      {entries.length === 0 && <EmptyState icon={<ClipboardIcon size={26} />} title="No audit entries yet" subtitle="Actions taken from here on are logged." />}
    </div>
  );
}

function SupportPanel() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ bookings: any[]; registrations: any[]; users: any[] } | null>(null);

  const run = () => {
    if (!q.trim()) return;
    supportSearch(q.trim()).then(setResults);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} placeholder="Booking ref or email" style={inputStyle} />
        <Button onClick={run}><SearchIcon size={14} /> Search</Button>
      </div>
      {results && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {(["bookings", "registrations", "users"] as const).map((k) => (
            <div key={k}>
              <h4 style={{ fontSize: 12, fontWeight: 700, color: colors.muted, margin: "0 0 8px", textTransform: "uppercase" }}>{k}</h4>
              {results[k].length === 0 ? (
                <span style={{ fontSize: 13, color: colors.faint }}>No matches.</span>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {results[k].map((r: any, i: number) => (
                    <div key={i} style={{ fontSize: 13, background: colors.bg, borderRadius: 8, padding: "8px 12px" }}>{JSON.stringify(r)}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPanel() {
  const [status, setStatus] = useState<{ database: string; stripeConfigured: boolean; smtpConfigured: boolean } | null>(null);
  useEffect(() => {
    fetchSystemStatus().then(setStatus);
  }, []);
  if (!status) return <PageSpinner />;
  const rows: [string, boolean][] = [
    ["Database", status.database === "ok"],
    ["Stripe configured", status.stripeConfigured],
    ["Email (SMTP) configured", status.smtpConfigured],
  ];
  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map(([label, ok]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
            {label}
            <span style={{ fontWeight: 700, color: ok ? colors.greenText : colors.orangeDark }}>{ok ? "OK" : "Not configured"}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function PlatformAdmin() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"dashboard" | "tenants" | "users" | "moderation" | "audit" | "support" | "status">("dashboard");

  if (loading) return <PageSpinner />;
  if (!user || user.role !== "admin") {
    navigate("/login");
    return null;
  }

  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "40px 24px 90px" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 27, margin: "0 0 6px" }}>Platform Admin</h1>
        <p style={{ color: colors.mutedLight, fontSize: 13.5, margin: "0 0 22px" }}>
          HelloCircle-internal — not visible to organisations. Best-effort scaffolding; see the plan doc for what's genuinely load-bearing here today (nothing yet).
        </p>
        <div style={{ marginBottom: 24 }}>
          <Tabs
            value={tab}
            onChange={setTab}
            options={[
              { key: "dashboard", label: "Dashboard" },
              { key: "tenants", label: "Tenants" },
              { key: "users", label: "Platform users" },
              { key: "moderation", label: "Moderation" },
              { key: "audit", label: "Audit" },
              { key: "support", label: "Support" },
              { key: "status", label: "Status" },
            ]}
          />
        </div>
        {tab === "dashboard" && <DashboardPanel />}
        {tab === "tenants" && <TenantsPanel />}
        {tab === "users" && <UsersPanel />}
        {tab === "moderation" && <ModerationPanel />}
        {tab === "audit" && <AuditPanel />}
        {tab === "support" && <SupportPanel />}
        {tab === "status" && <StatusPanel />}
      </section>
    </div>
  );
}
