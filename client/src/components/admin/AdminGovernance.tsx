import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { fetchGovernance, type GovernanceSummary } from "../../api";
import { describeAuditAction } from "./auditFormat";
import { AdminButton, Box, ErrorMessage, LoadingRows, SelectField, Toolbar, formatDate, useAdminData } from "./adminUi";
import type { AdminTab } from "./adminNav";

// Phase L (docs/participation-expansion/23) — governance at a glance: the
// audit log grouped by theme (configuration, field policy, exports,
// permissions, privacy) with who/what/when and a link into the full audit
// log, indicators backed by evidence (heavy exporting, admin sign-in
// lockouts), retention counts (never the notes or answers themselves) and
// the privacy decisions engineering can't close. Read only.

const SEARCH_FOR: Record<string, string> = { configuration: "config.", fields: "fields.policy_changed", exports: "_exported", permissions: "role_changed", privacy: "privacy_request" };

export function AdminGovernancePage({ onNavigate }: { onNavigate?: (tab: AdminTab, extra?: Record<string, string>) => void }) {
  const [days, setDays] = useState("30");
  const g = useAdminData<GovernanceSummary>(() => fetchGovernance(Number(days)), [days]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Toolbar label="Period">
        <SelectField label="Period" value={days} onChange={setDays} options={[{ value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" }, { value: "365", label: "Last year" }]} />
      </Toolbar>
      {g.error ? (
        <ErrorMessage error={g.error} onRetry={g.reload} title="Couldn't load governance" />
      ) : !g.data ? (
        <LoadingRows rows={6} label="Loading governance" />
      ) : (
        <>
          <Box icon={ShieldCheck} title="Worth a look" subtitle="Only patterns the records show — heavy exporting by one account in a day, and admin sign-in lockouts.">
            {g.data.indicators.length === 0 ? <p className="adm-note" style={{ margin: 0 }}>Nothing stands out in this period.</p> : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>{g.data.indicators.map((i, n) => <li key={n}>{i.text}</li>)}</ul>
            )}
          </Box>
          {g.data.themes.map((t) => (
            <Box key={t.key} title={`${t.label} · ${t.count}`} actions={onNavigate ? <AdminButton size="sm" onClick={() => onNavigate("audit", { q: SEARCH_FOR[t.key] ?? "" })}>Open in audit log</AdminButton> : undefined} flush>
              {t.latest.length === 0 ? <p className="adm-note" style={{ padding: "12px 16px", margin: 0 }}>Nothing in this period.</p> : (
                <ul className="adm-ov-list">
                  {t.latest.map((e, i) => (
                    <li key={i} className="adm-ov-row">
                      <div className="adm-ov-main">
                        <div className="adm-ov-title">{describeAuditAction(e.action)}</div>
                        <div className="adm-ov-detail">{[e.actorEmail ?? (e.actorKind === "resident" ? "A resident" : "System"), `${e.objectType} ${e.objectId}`].join(" · ")}</div>
                      </div>
                      <span className="adm-ov-kind">{formatDate(e.at, true)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Box>
          ))}
          <Box title="Data retention" subtitle="Counts only — nothing is read out, and nothing is deleted automatically.">
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
              <li>
                Legacy medical notes on club registrations: {g.data.retention.medical.withNote} of {g.data.retention.medical.registrations} registrations
                {g.data.retention.medical.firstMonth ? ` (${g.data.retention.medical.firstMonth} to ${g.data.retention.medical.lastMonth})` : ""}. No new notes are collected.
              </li>
              <li>
                Registration answers past a retention period:{" "}
                {typeof g.data.retention.answersPastRetention === "string" ? "no retention period is set yet" : g.data.retention.answersPastRetention.map((r) => `${r.class} ${r.answers} (over ${r.retentionDays} days)`).join(", ") || "none"}.
              </li>
            </ul>
          </Box>
          <Box title="Privacy review" subtitle="Decisions engineering can't make (docs/participation-expansion/18).">
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
              {g.data.privacyReview.map((p) => <li key={p.key}><strong>{p.status}:</strong> {p.label}</li>)}
            </ul>
          </Box>
        </>
      )}
    </div>
  );
}
