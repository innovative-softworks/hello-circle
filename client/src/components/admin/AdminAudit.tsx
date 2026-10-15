import { useMemo, useState } from "react";
import { ScrollText } from "lucide-react";
import { fetchAuditLog } from "../../api";
import type { AuditEntry } from "../../types";
import { describeAuditAction, describeObject, shortValue } from "./auditFormat";
import { Box, EmptyMessage, ErrorMessage, Loaded, Pager, SearchField, SelectField, Toolbar, formatDate, matches, useAdminData, usePaged } from "./adminUi";

// Audit log (admin redesign 2026-10-14): readable headline per entry, with
// the raw action code, object, IDs and stored values one click away in
// "Technical details" (audit finding 9). The server returns the latest 200.

function AuditRow({ e }: { e: AuditEntry }) {
  const prev = shortValue(e.previousValue);
  const next = shortValue(e.newValue);
  return (
    <li>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span>
          <strong>{describeAuditAction(e.action)}</strong>
          {prev && next ? (
            <>
              {" "}
              · {prev} → {next}
            </>
          ) : next ? (
            <> · {next}</>
          ) : null}
        </span>
        <time dateTime={e.createdAt}>{formatDate(e.createdAt, true)}</time>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--color-muted)", marginTop: 2 }}>
        {e.actorEmail ? `By ${e.actorEmail}` : "By the system"} · {describeObject(e.objectType)}
        {e.reason ? <> · Reason: “{e.reason}”</> : null}
      </div>
      <details className="adm-tech">
        <summary>Technical details</summary>
        <dl>
          <dt>Action code</dt>
          <dd className="adm-mono">{e.action}</dd>
          <dt>Object</dt>
          <dd className="adm-mono">
            {e.objectType} · {e.objectId}
          </dd>
          {e.actorUserId && (
            <>
              <dt>Actor ID</dt>
              <dd className="adm-mono">{e.actorUserId}</dd>
            </>
          )}
          {e.previousValue && (
            <>
              <dt>Before</dt>
              <dd className="adm-mono">{e.previousValue}</dd>
            </>
          )}
          {e.newValue && (
            <>
              <dt>After</dt>
              <dd className="adm-mono">{e.newValue}</dd>
            </>
          )}
          <dt>Entry</dt>
          <dd className="adm-mono">#{e.id}</dd>
        </dl>
      </details>
    </li>
  );
}

export function AuditList({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) return <EmptyMessage icon={<ScrollText size={22} strokeWidth={1.9} aria-hidden="true" />} title="No activity recorded yet" detail="Admin actions are logged from here on." />;
  return (
    <ul className="adm-activity">
      {entries.map((e) => (
        <AuditRow key={e.id} e={e} />
      ))}
    </ul>
  );
}

export function AdminAuditPage() {
  const state = useAdminData(fetchAuditLog);
  const [q, setQ] = useState("");
  const [area, setArea] = useState("all");
  const [actor, setActor] = useState("all");
  const entries = state.data ?? [];
  const areas = useMemo(() => Array.from(new Set(entries.map((e) => e.objectType))).sort(), [entries]);
  const actors = useMemo(() => Array.from(new Set(entries.map((e) => e.actorEmail ?? "system"))).sort(), [entries]);
  const rows = entries.filter(
    (e) => (area === "all" || e.objectType === area) && (actor === "all" || (e.actorEmail ?? "system") === actor) && matches(q, describeAuditAction(e.action), e.action, e.objectId, e.actorEmail, e.reason)
  );
  const paged = usePaged(rows, 25, `${q}|${area}|${actor}`);

  return (
    <Box flush title="Activity" subtitle="The most recent 200 entries. Some decisions (listing approvals, claims, review hiding) aren't recorded by the server yet.">
      <Toolbar label="Filter audit log">
        <SearchField label="Search activity" value={q} onChange={setQ} placeholder="Action, object ID, person or reason" />
        <SelectField label="Area" value={area} onChange={setArea} options={[{ value: "all", label: "All areas" }, ...areas.map((a) => ({ value: a, label: describeObject(a) }))]} />
        <SelectField label="Done by" value={actor} onChange={setActor} options={[{ value: "all", label: "Anyone" }, ...actors.map((a) => ({ value: a, label: a === "system" ? "The system" : a }))]} />
      </Toolbar>
      <Loaded state={state}>
        {() =>
          rows.length === 0 && entries.length > 0 ? (
            <EmptyMessage title="No entries match" detail="Try a different search or filter." />
          ) : (
            <>
              <AuditList entries={paged.slice} />
              <Pager {...paged} noun="entries" />
            </>
          )
        }
      </Loaded>
    </Box>
  );
}

/** Activity for one record inside a detail panel: the audit entries whose
 * object is this record, from the latest 200 the server returns. `note`
 * states what the server doesn't log, so an empty list isn't misread. */
export function ObjectActivity({ objectIds, note }: { objectIds: string[]; note?: string }) {
  const state = useAdminData(fetchAuditLog);
  if (state.error) return <ErrorMessage error={state.error} onRetry={state.reload} title="Couldn't load activity" />;
  if (state.data === null) return <p className="adm-note" role="status">Loading activity…</p>;
  const rows = state.data.filter((e) => objectIds.includes(e.objectId)).slice(0, 10);
  return (
    <>
      {rows.length === 0 ? (
        <p className="adm-note">No recorded activity for this record in the latest 200 audit entries.</p>
      ) : (
        <div style={{ border: "1px solid var(--adm-line)", background: "var(--adm-panel)" }}>
          <AuditList entries={rows} />
        </div>
      )}
      {note && <p className="adm-note" style={{ marginTop: 8 }}>{note}</p>}
    </>
  );
}
