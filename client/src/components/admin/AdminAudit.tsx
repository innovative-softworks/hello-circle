import { useMemo } from "react";
import { ScrollText } from "lucide-react";
import { fetchAdminListings, fetchAdminVendors, fetchAuditPage } from "../../api";
import { flattenListings, rowKey } from "./AdminListings";
import type { AdminTab } from "./adminNav";
import { useAdminCan } from "./adminPermissions";
import type { AuditEntry } from "../../types";
import { describeAuditAction, describeObject, shortValue } from "./auditFormat";
import { Box, EmptyMessage, ErrorMessage, LoadingRows, SearchField, SelectField, Toolbar, formatDate, useAdminData, useDebounced, useServerPage } from "./adminUi";
import { LoadMoreControl } from "../ui";
import { useUrlParam } from "../../useUrlTab";

// Audit log (admin redesign 2026-10-14): readable headline per entry, with
// the raw action code, object, IDs and stored values one click away in
// "Technical details" (audit finding 9). The server returns the latest 200.

/** Optional name + link for an entry's record, supplied by the page (the
 * audit API only stores the object's type and id). */
export type AuditSubject = { name: string; onOpen?: () => void };

/** Two-letter marker for who did it (timeline variant). */
export function actorInitials(email: string | null): string {
  if (!email) return "SY";
  const local = email.split("@")[0].replace(/[^a-z0-9]/gi, " ").trim();
  const parts = local.split(/\s+/).filter(Boolean);
  return ((parts.length > 1 ? parts[0][0] + parts[1][0] : local.slice(0, 2)) || "?").toUpperCase();
}

function AuditRow({ e, subject, timeline }: { e: AuditEntry; subject?: AuditSubject | null; timeline?: boolean }) {
  const prev = shortValue(e.previousValue);
  const next = shortValue(e.newValue);
  return (
    <li className={timeline ? "adm-tl-item" : undefined}>
      {timeline && (
        <span className="adm-tl-mark" aria-hidden="true" title={e.actorEmail ?? "The system"}>
          {actorInitials(e.actorEmail)}
        </span>
      )}
      <div className={timeline ? "adm-tl-body" : undefined}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span>
          <strong>{describeAuditAction(e.action)}</strong>
          {subject && (
            <>
              {": "}
              {subject.onOpen ? (
                <button type="button" className="adm-linkish" onClick={subject.onOpen}>
                  {subject.name}
                </button>
              ) : (
                subject.name
              )}
            </>
          )}
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
        {e.actorEmail ? `By ${e.actorEmail}` : "By the system"}
        {timeline ? null : <> · {describeObject(e.objectType)}</>}
        {e.reason ? <> · Reason: “{e.reason}”</> : null}
      </div>
      {!timeline && (
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
      )}
      </div>
    </li>
  );
}

export function AuditList({ entries, resolve, variant }: { entries: AuditEntry[]; resolve?: (e: AuditEntry) => AuditSubject | null; variant?: "timeline" }) {
  if (entries.length === 0) return <EmptyMessage icon={<ScrollText size={22} strokeWidth={1.9} aria-hidden="true" />} title="No activity recorded yet" detail="Admin actions are logged from here on." />;
  return (
    <ul className={variant === "timeline" ? "adm-activity adm-tl" : "adm-activity"}>
      {entries.map((e) => (
        <AuditRow key={e.id} e={e} subject={resolve?.(e)} timeline={variant === "timeline"} />
      ))}
    </ul>
  );
}

/** Names and links for the records audit entries point at (listings and partner accounts). */
function useAuditSubjects(onNavigate?: (tab: AdminTab, extra?: Record<string, string>) => void) {
  const can = useAdminCan();
  const okListings = can("listings.view");
  const okPartners = can("partners.view");
  const listings = useAdminData(() => (okListings ? fetchAdminListings() : Promise.resolve(null)), [okListings]);
  const vendors = useAdminData(() => (okPartners ? fetchAdminVendors() : Promise.resolve(null)), [okPartners]);
  return useMemo(() => {
    const byId = new Map(listings.data ? flattenListings(listings.data).map((r) => [r.item.id, r] as const) : []);
    const vById = new Map((vendors.data ?? []).map((v) => [v.id, v] as const));
    return (e: AuditEntry): AuditSubject | null => {
      const l = byId.get(e.objectId);
      if (l && (e.objectType === "centre" || e.objectType === "club" || e.objectType === "experience"))
        return { name: l.item.name, onOpen: onNavigate ? () => onNavigate("listings", { record: rowKey(l) }) : undefined };
      const v = vById.get(e.objectId);
      if (v && e.objectType === "user") return { name: v.businessName || v.name || v.email, onOpen: onNavigate ? () => onNavigate("vendors", { record: v.id }) : undefined };
      return null;
    };
  }, [listings.data, vendors.data, onNavigate]);
}

export function AdminAuditPage({ onNavigate }: { onNavigate?: (tab: AdminTab, extra?: Record<string, string>) => void } = {}) {
  const resolve = useAuditSubjects(onNavigate);
  const [q, setQ] = useUrlParam<string>("q", "");
  const [area, setArea] = useUrlParam<string>("area", "all");
  const query = useDebounced(q.trim());
  // OG-24 — the whole history, searched and paged on the server.
  const list = useServerPage((cursor) => fetchAuditPage({ q: query || undefined, objectType: area === "all" ? undefined : area, cursor }), [query, area]);

  return (
    <Box flush icon={ScrollText} title="Activity" subtitle="Everything recorded, newest first.">
      <Toolbar label="Filter audit log">
        <SearchField label="Search activity" value={q} onChange={setQ} placeholder="Action, object ID, person's email or reason" />
        <SelectField label="Area" value={area} onChange={setArea} options={[{ value: "all", label: "All areas" }, ...AUDIT_AREAS.map((a) => ({ value: a, label: describeObject(a) }))]} />
      </Toolbar>
      {list.error ? (
        <ErrorMessage error={list.error} onRetry={list.reload} title="Couldn't load the audit log" />
      ) : list.loading ? (
        <LoadingRows rows={6} />
      ) : list.items.length === 0 ? (
        <EmptyMessage title={query || area !== "all" ? "No entries match" : "Nothing recorded yet"} detail={query || area !== "all" ? "Try a different search or area." : undefined} />
      ) : (
        <>
          <AuditList entries={list.items} resolve={resolve} />
          {list.hasMore && (
            <div style={{ padding: "14px 0 18px" }}>
              <LoadMoreControl loadingMore={list.loadingMore} failed={list.moreFailed} onLoadMore={list.loadMore} label="Show older entries" />
            </div>
          )}
        </>
      )}
    </Box>
  );
}

/** The record types the audit log is filtered by (object_type values). */
const AUDIT_AREAS = ["booking", "registration", "program_enrollment", "experience_booking", "game", "circle", "centre", "club", "experience", "user", "vendor", "organisation", "admin_invite", "coupon", "refund", "chat_message", "commerce_rule", "policy"];

/** Activity for one record inside a detail panel: the audit entries whose
 * object is this record, asked of the server by object id (OG-24 — not
 * limited to the latest entries). `note` states what the server doesn't log,
 * so an empty list isn't misread. */
export function ObjectActivity({ objectIds, note, limit = 10 }: { objectIds: string[]; note?: string; limit?: number }) {
  const key = objectIds.join("|");
  const state = useAdminData(async () => {
    const pages = await Promise.all(objectIds.map((objectId) => fetchAuditPage({ objectId })));
    return pages.flatMap((p) => p.items).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [key]);
  if (state.error) return <ErrorMessage error={state.error} onRetry={state.reload} title="Couldn't load activity" />;
  if (state.data === null) return <p className="adm-note" role="status">Loading activity…</p>;
  const rows = state.data.slice(0, limit);
  return (
    <>
      {rows.length === 0 ? (
        <p className="adm-note">No recorded activity for this record.</p>
      ) : (
        <div style={{ border: "1px solid var(--adm-line)", background: "var(--adm-panel)" }}>
          <AuditList entries={rows} />
        </div>
      )}
      {note && <p className="adm-note" style={{ marginTop: 8 }}>{note}</p>}
    </>
  );
}
