import { useState, type ReactNode } from "react";
import { AlertTriangle, Award, Receipt, Ticket, UserRound, UsersRound } from "lucide-react";
import {
  cancelActivityAsAdmin,
  fetchActivitiesPage,
  fetchAdminActivity,
  fetchAdminCirclesPage,
  fetchHostsPage,
  fetchOperationalExceptions,
  fetchOrdersPage,
  fetchPeoplePage,
} from "../../api";
import { useUrlParam, useRecordParam } from "../../useUrlTab";
import { ConfirmDialog, LoadMoreControl } from "../ui";
import { RecordState, RecordView } from "../workspace/RecordView";
import type { AdminTab } from "./adminNav";
import { useAdminCan } from "./adminPermissions";
import {
  AdminButton,
  Badge,
  Box,
  EmptyMessage,
  ErrorMessage,
  Facts,
  LoadingRows,
  SearchField,
  SectionLabel,
  SelectField,
  StatusTag,
  Toolbar,
  formatDate,
  useAdminAction,
  useAdminData,
  useDebounced,
  useServerPage,
} from "./adminUi";
import { DecisionReasonFields, emptyReason, reasonComplete, toReasonInput, type ReasonDraft } from "./DecisionReason";
import { ObjectActivity } from "./AdminAudit";

// OG-14 / OG-15 / OG-24 — admin Operations: one inbox of open money
// exceptions and server-paged directories of people, orders, activities,
// Circles and hosts. Rows open the existing record pages (Support's person
// and order pages, Finance's records), or this file's activity record. Every
// action is checked by its own server route; buttons only show with the
// matching permission.

type Nav = (tab: AdminTab, extra?: Record<string, string>) => void;
const euro = (minor: number | null | undefined) => (minor === null || minor === undefined ? "—" : `€${(Number(minor) / 100).toFixed(2)}`);

interface Column<T> {
  label: string;
  num?: boolean;
  cell: (row: T) => ReactNode;
}

function DirectoryTable<T>({
  caption,
  list,
  columns,
  rowKey,
  onOpen,
  openLabel,
  emptyTitle,
  filtered,
}: {
  caption: string;
  list: ReturnType<typeof useServerPage<T>>;
  columns: Column<T>[];
  rowKey: (r: T) => string;
  onOpen?: (r: T) => void;
  openLabel?: (r: T) => string;
  emptyTitle: string;
  filtered: boolean;
}) {
  if (list.error) return <ErrorMessage error={list.error} onRetry={list.reload} title={`Couldn't load ${caption.toLowerCase()}`} />;
  if (list.loading) return <LoadingRows rows={6} />;
  if (list.items.length === 0) return <EmptyMessage title={filtered ? "Nothing matches" : emptyTitle} detail={filtered ? "Try a different search or filter." : undefined} />;
  return (
    <>
      <div className="adm-table-wrap">
        <table className="adm-table adm-table--stack">
          <caption className="adm-visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.label} scope="col" className={c.num ? "adm-num" : undefined}>
                  {c.label}
                </th>
              ))}
              {onOpen && (
                <th scope="col">
                  <span className="adm-visually-hidden">Open</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {list.items.map((r) => (
              <tr key={rowKey(r)}>
                {columns.map((c) => (
                  <td key={c.label} data-label={c.label} className={c.num ? "adm-num" : undefined}>
                    {c.cell(r)}
                  </td>
                ))}
                {onOpen && (
                  <td data-label="">
                    <AdminButton size="sm" onClick={() => onOpen(r)} aria-label={openLabel?.(r)}>
                      Open
                    </AdminButton>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.hasMore && (
        <div style={{ padding: "14px 0 18px" }}>
          <LoadMoreControl loadingMore={list.loadingMore} failed={list.moreFailed} onLoadMore={list.loadMore} />
        </div>
      )}
    </>
  );
}

// --- People ---------------------------------------------------------------------

export function AdminPeoplePage({ onNavigate }: { onNavigate: Nav }) {
  const [q, setQ] = useUrlParam<string>("q", "");
  const [filter, setFilter] = useUrlParam<string>("filter", "all");
  const query = useDebounced(q.trim());
  const list = useServerPage((cursor) => fetchPeoplePage({ q: query || undefined, filter: filter === "all" ? undefined : filter, cursor }), [query, filter]);
  return (
    <Box flush icon={UserRound} title="People" subtitle="Everyone with a personal HelloCircle account, newest first. Open a person to see all their orders.">
      <Toolbar label="Filter people">
        <SearchField label="Search people" value={q} onChange={setQ} placeholder="Name or email" />
        <SelectField
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "Everyone" },
            { value: "host", label: "Has hosted" },
            { value: "verified_host", label: "Verified Hosts" },
            { value: "deactivated", label: "Deactivated" },
          ]}
        />
      </Toolbar>
      <DirectoryTable
        caption="People"
        list={list}
        filtered={!!query || filter !== "all"}
        emptyTitle="No accounts yet"
        rowKey={(r) => r.id}
        onOpen={(r) => onNavigate("support", { record: `person:${r.email}` })}
        openLabel={(r) => `Open ${r.name || r.email}`}
        columns={[
          { label: "Name", cell: (r) => <strong>{r.name || "—"}</strong> },
          { label: "Email", cell: (r) => r.email },
          { label: "County", cell: (r) => r.county || "—" },
          { label: "Host", cell: (r) => (r.hostStatus === "verified" ? <Badge tone="good">Verified Host</Badge> : r.hostStatus === "pending" ? <Badge tone="warn">Applied</Badge> : "—") },
          { label: "Account", cell: (r) => (r.deactivated ? <Badge tone="neutral">Deactivated</Badge> : "Active") },
          { label: "Joined", cell: (r) => formatDate(r.createdAt) },
        ]}
      />
    </Box>
  );
}

// --- Orders -----------------------------------------------------------------------

const KIND_LABEL: Record<string, string> = { booking: "Hall booking", registration: "Club registration", program: "Programme", game: "Activity place", experience: "Experience", pass: "Pass" };

export function AdminOrdersPage({ onNavigate }: { onNavigate: Nav }) {
  const [q, setQ] = useUrlParam<string>("q", "");
  const [kind, setKind] = useUrlParam<string>("kind", "all");
  const [payment, setPayment] = useUrlParam<string>("payment", "all");
  const [from, setFrom] = useUrlParam<string>("from", "");
  const [to, setTo] = useUrlParam<string>("to", "");
  const query = useDebounced(q.trim());
  const list = useServerPage(
    (cursor) => fetchOrdersPage({ q: query || undefined, kind: kind === "all" ? undefined : kind, paymentStatus: payment === "all" ? undefined : payment, from: from || undefined, to: to || undefined, cursor }),
    [query, kind, payment, from, to]
  );
  return (
    <Box flush icon={Receipt} title="Orders" subtitle="Every booking, registration, enrolment, activity place, experience booking and pass, newest first.">
      <Toolbar label="Filter orders">
        <SearchField label="Search orders" value={q} onChange={setQ} placeholder="Reference, email, name or listing" />
        <SelectField label="Type" value={kind} onChange={setKind} options={[{ value: "all", label: "All types" }, ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))]} />
        <SelectField
          label="Payment"
          value={payment}
          onChange={setPayment}
          options={[
            { value: "all", label: "Any" },
            { value: "paid", label: "Paid" },
            { value: "pending", label: "Pending" },
            { value: "refunded", label: "Refunded" },
            { value: "failed", label: "Failed" },
          ]}
        />
        <div className="adm-field">
          <label htmlFor="orders-from">Placed from</label>
          <input id="orders-from" type="date" className="adm-input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="adm-field">
          <label htmlFor="orders-to">to</label>
          <input id="orders-to" type="date" className="adm-input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </Toolbar>
      <DirectoryTable
        caption="Orders"
        list={list}
        filtered={!!query || kind !== "all" || payment !== "all" || !!from || !!to}
        emptyTitle="No orders yet"
        rowKey={(r) => `${r.kind}:${r.ref}`}
        onOpen={(r) => onNavigate("support", { record: `order:${r.kind}:${r.ref}` })}
        openLabel={(r) => `Open order ${r.ref}`}
        columns={[
          { label: "Reference", cell: (r) => <span className="adm-mono">{r.ref}</span> },
          { label: "Type", cell: (r) => KIND_LABEL[r.kind] ?? r.kind },
          { label: "For", cell: (r) => r.listingName ?? "—" },
          { label: "Customer", cell: (r) => r.name || r.email || "—" },
          { label: "When", cell: (r) => r.whenText ?? "—" },
          { label: "Amount", num: true, cell: (r) => euro(r.amountCents) },
          { label: "Status", cell: (r) => (r.paymentStatus ? <StatusTag status={r.status === "cancelled" ? "cancelled" : r.paymentStatus} /> : "—") },
          { label: "Placed", cell: (r) => formatDate(r.createdAt) },
        ]}
      />
    </Box>
  );
}

// --- Activities -------------------------------------------------------------------

export function AdminActivitiesPage() {
  const [record, openRecord, closeRecord] = useRecordParam();
  const [q, setQ] = useUrlParam<string>("q", "");
  const [status, setStatus] = useUrlParam<string>("status", "all");
  const [when, setWhen] = useUrlParam<string>("when", "upcoming");
  const query = useDebounced(q.trim());
  const list = useServerPage((cursor) => fetchActivitiesPage({ q: query || undefined, status: status === "all" ? undefined : status, when: when === "all" ? undefined : when, cursor }), [query, status, when]);
  if (record?.startsWith("activity:")) return <AdminActivityRecord id={record.slice(9)} onBack={closeRecord} onChanged={list.reload} />;
  return (
    <Box flush icon={Ticket} title="Activities" subtitle="Activities hosted by residents, newest first.">
      <Toolbar label="Filter activities">
        <SearchField label="Search activities" value={q} onChange={setQ} placeholder="Activity, host name or email" />
        <SelectField label="When" value={when} onChange={setWhen} options={[{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }, { value: "all", label: "Any time" }]} />
        <SelectField
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "Any status" },
            { value: "open", label: "Open" },
            { value: "full", label: "Full" },
            { value: "pending_participants", label: "Needs players" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
      </Toolbar>
      <DirectoryTable
        caption="Activities"
        list={list}
        filtered={!!query || status !== "all" || when !== "all"}
        emptyTitle="No activities"
        rowKey={(r) => r.id}
        onOpen={(r) => openRecord(`activity:${r.id}`)}
        openLabel={(r) => `Open ${r.activityLabel}`}
        columns={[
          { label: "Activity", cell: (r) => <strong>{r.activityLabel}</strong> },
          { label: "When", cell: (r) => `${formatDate(r.date)} · ${r.time}` },
          { label: "Host", cell: (r) => r.hostName ?? "—" },
          { label: "Where", cell: (r) => r.place || "—" },
          { label: "Going", num: true, cell: (r) => `${r.joined}/${r.capacity}` },
          { label: "Price", num: true, cell: (r) => (r.priceCents ? euro(r.priceCents) : "Free") },
          { label: "Status", cell: (r) => <StatusTag status={r.status} /> },
          { label: "Reports", num: true, cell: (r) => (r.reports ? <Badge tone="warn">{r.reports}</Badge> : "0") },
        ]}
      />
    </Box>
  );
}

function AdminActivityRecord({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const can = useAdminCan();
  const state = useAdminData(() => fetchAdminActivity(id), [id]);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState<ReasonDraft>(emptyReason());
  const { run } = useAdminAction();
  if (state.error) return <RecordState state={(state.error as { status?: number }).status === 404 ? "missing" : "error"} backLabel="Activities" onBack={onBack} onRetry={state.reload} />;
  if (!state.data) return <RecordState state="loading" backLabel="Activities" onBack={onBack} />;
  const { activity: a, participants, reports } = state.data;
  const joined = participants.filter((p) => p.status === "joined");
  const paidOnline = joined.filter((p) => p.paymentStatus === "paid" && Number(p.totalCents) > 0).length;
  const live = a.status !== "cancelled";
  return (
    <RecordView
      title={a.activityLabel}
      reference={`${formatDate(a.date)} · ${a.time}`}
      backLabel="Activities"
      onBack={onBack}
      statuses={<StatusTag status={a.status} />}
      actions={
        <>
          <AdminButton onClick={() => window.open(`/games/${a.id}`, "_blank", "noopener")}>View public page</AdminButton>
          {live && can("activities.moderate") && (
            <AdminButton variant="danger" onClick={() => setCancelling(true)}>
              Cancel activity
            </AdminButton>
          )}
        </>
      }
    >
      <div className="adm-record-grid">
        <div>
          <SectionLabel>Activity</SectionLabel>
          <Facts
            rows={[
              ["Host", `${a.hostName ?? "—"}${a.hostEmail ? ` · ${a.hostEmail}` : ""}`],
              ["Where", String(a.place ?? "—")],
              ["Going", `${joined.length} of ${a.capacity}`],
              ["Price", a.priceCents ? euro(Number(a.priceCents)) : "Free"],
              ["Venue booking", a.bookingRef ? <span className="adm-mono">{String(a.bookingRef)}</span> : "None"],
              ["Visibility", String(a.visibility ?? "—")],
              ["Created", formatDate(String(a.createdAt), true)],
            ]}
          />
          <SectionLabel>Participants ({participants.length})</SectionLabel>
          {participants.length === 0 ? (
            <p className="adm-note">Nobody has joined.</p>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table adm-table--stack">
                <caption className="adm-visually-hidden">Participants</caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Status</th>
                    <th scope="col">Payment</th>
                    <th scope="col" className="adm-num">
                      Paid
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {participants.map((p) => (
                    <tr key={p.residentId}>
                      <td data-label="Name">{p.name ?? p.email ?? "—"}</td>
                      <td data-label="Status">
                        <StatusTag status={p.status} />
                      </td>
                      <td data-label="Payment">
                        <StatusTag status={p.paymentStatus} />
                      </td>
                      <td data-label="Paid" className="adm-num">
                        {euro(p.totalCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div>
          <SectionLabel>Reports ({reports.length})</SectionLabel>
          {reports.length === 0 ? (
            <p className="adm-note">No reports.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {reports.map((r) => (
                <li key={r.id}>
                  {r.reason} — {r.status} · {formatDate(r.createdAt)}
                </li>
              ))}
            </ul>
          )}
          <SectionLabel>Activity</SectionLabel>
          <ObjectActivity objectIds={[a.id]} />
        </div>
      </div>
      <ConfirmDialog
        open={cancelling}
        title="Cancel this activity?"
        message={`It's cancelled for everyone. ${joined.length} ${joined.length === 1 ? "person is" : "people are"} going${paidOnline ? `; ${paidOnline} paid and will be refunded in full` : ""}. Participants, anyone waiting and the host are told; the host sees the explanation.`}
        confirmLabel="Cancel activity"
        confirmDisabled={!reasonComplete(reason)}
        onConfirm={() =>
          run("cancel", () => cancelActivityAsAdmin(a.id, toReasonInput(reason)), { success: "Activity cancelled" }).then((ok) => {
            if (ok) {
              setCancelling(false);
              setReason(emptyReason());
              state.reload();
              onChanged();
            }
            return ok;
          })
        }
        onCancel={() => setCancelling(false)}
      >
        <DecisionReasonFields kind="suspension" value={reason} onChange={setReason} audience="applicant" />
      </ConfirmDialog>
    </RecordView>
  );
}

// --- Circles ------------------------------------------------------------------------

export function AdminCirclesPage({ onNavigate }: { onNavigate: Nav }) {
  const [q, setQ] = useUrlParam<string>("q", "");
  const [status, setStatus] = useUrlParam<string>("status", "all");
  const query = useDebounced(q.trim());
  const list = useServerPage((cursor) => fetchAdminCirclesPage({ q: query || undefined, status: status === "all" ? undefined : status, cursor }), [query, status]);
  return (
    <Box flush icon={UsersRound} title="Circles" subtitle="Every Circle, newest first. Reported Circles are reviewed in Reviews & reports.">
      <Toolbar label="Filter Circles">
        <SearchField label="Search Circles" value={q} onChange={setQ} placeholder="Name or activity" />
        <SelectField label="Status" value={status} onChange={setStatus} options={[{ value: "all", label: "Any status" }, { value: "active", label: "Active" }, { value: "closed", label: "Closed" }]} />
      </Toolbar>
      <DirectoryTable
        caption="Circles"
        list={list}
        filtered={!!query || status !== "all"}
        emptyTitle="No Circles yet"
        rowKey={(r) => r.id}
        onOpen={(r) => window.open(`/circles/${r.slug ?? r.id}`, "_blank", "noopener")}
        openLabel={(r) => `Open ${r.name} (new tab)`}
        columns={[
          { label: "Circle", cell: (r) => <strong>{r.name}</strong> },
          { label: "Activity", cell: (r) => r.activityLabel },
          { label: "County", cell: (r) => r.county || "—" },
          { label: "Organiser", cell: (r) => r.organiserName ?? "—" },
          { label: "Members", num: true, cell: (r) => r.members },
          { label: "Joining", cell: (r) => (r.joinMode === "approval" ? "Approval" : r.joinMode === "invite" ? "Invite only" : "Open") },
          { label: "Status", cell: (r) => <StatusTag status={r.status} /> },
          {
            label: "Reports",
            num: true,
            cell: (r) =>
              r.reports ? (
                <button type="button" className="adm-linkish" onClick={() => onNavigate("reviews", { reports: "all" })}>
                  {r.reports}
                </button>
              ) : (
                "0"
              ),
          },
        ]}
      />
    </Box>
  );
}

// --- Hosts --------------------------------------------------------------------------

export function AdminHostsPage({ onNavigate }: { onNavigate: Nav }) {
  const [q, setQ] = useUrlParam<string>("q", "");
  const [status, setStatus] = useUrlParam<string>("status", "all");
  const query = useDebounced(q.trim());
  const list = useServerPage((cursor) => fetchHostsPage({ q: query || undefined, status: status === "all" ? undefined : status, cursor }), [query, status]);
  return (
    <Box flush icon={Award} title="Hosts" subtitle="Residents who host activities or applied for the Verified Host badge.">
      <Toolbar label="Filter hosts">
        <SearchField label="Search hosts" value={q} onChange={setQ} placeholder="Name or email" />
        <SelectField
          label="Badge"
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "Anyone" },
            { value: "verified", label: "Verified Host" },
            { value: "pending", label: "Applied" },
            { value: "rejected", label: "Not approved" },
            { value: "none", label: "No badge" },
          ]}
        />
      </Toolbar>
      <DirectoryTable
        caption="Hosts"
        list={list}
        filtered={!!query || status !== "all"}
        emptyTitle="No hosts yet"
        rowKey={(r) => r.id}
        onOpen={(r) => onNavigate("support", { record: `person:${r.email}` })}
        openLabel={(r) => `Open ${r.name || r.email}`}
        columns={[
          { label: "Host", cell: (r) => <strong>{r.name || "—"}</strong> },
          { label: "Email", cell: (r) => r.email },
          { label: "Badge", cell: (r) => (r.hostStatus === "verified" ? <Badge tone="good">Verified</Badge> : r.hostStatus === "pending" ? <Badge tone="warn">Applied</Badge> : r.hostStatus === "rejected" ? "Not approved" : "—") },
          { label: "Hosted", num: true, cell: (r) => r.hosted },
          { label: "Upcoming", num: true, cell: (r) => r.upcoming },
          { label: "Paid activities", num: true, cell: (r) => r.paidActivities },
        ]}
      />
    </Box>
  );
}

// --- Exceptions ---------------------------------------------------------------------

const EXCEPTION_KIND: Record<string, string> = {
  payment_review: "Payment under review",
  dispute: "Card dispute",
  refund_pending: "Refund due",
  refund_stuck: "Refund not confirmed",
  webhook_failed: "Payment event failed",
  payout_failed: "Payout failed",
  subscription_past_due: "Pro payment failed",
  partner_debt: "Partner debt",
};

export function AdminExceptionsPage() {
  const can = useAdminCan();
  const [kind, setKind] = useUrlParam<string>("kind", "all");
  const state = useAdminData(fetchOperationalExceptions);
  const rows = (state.data ?? []).filter((e) => kind === "all" || e.kind === kind);
  return (
    <Box flush icon={AlertTriangle} title="Open exceptions" subtitle="Money problems that need a person, oldest and most urgent first. Each opens the Finance page where it's resolved.">
      <Toolbar label="Filter exceptions">
        <SelectField label="Type" value={kind} onChange={setKind} options={[{ value: "all", label: "All types" }, ...Object.entries(EXCEPTION_KIND).map(([value, label]) => ({ value, label }))]} />
      </Toolbar>
      {state.error ? (
        <ErrorMessage error={state.error} onRetry={state.reload} title="Couldn't load the exceptions" />
      ) : !state.data ? (
        <LoadingRows rows={5} />
      ) : rows.length === 0 ? (
        <EmptyMessage title={kind === "all" ? "Nothing needs attention" : "None of this type"} detail={kind === "all" ? "No failed payouts, refunds due, disputes or payments under review." : undefined} />
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table adm-table--stack">
            <caption className="adm-visually-hidden">Open exceptions</caption>
            <thead>
              <tr>
                <th scope="col">Severity</th>
                <th scope="col">What</th>
                <th scope="col">Who</th>
                <th scope="col" className="adm-num">
                  Amount
                </th>
                <th scope="col">Since</th>
                <th scope="col">
                  <span className="adm-visually-hidden">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td data-label="Severity">{e.severity === "high" ? <Badge tone="bad">Urgent</Badge> : <Badge tone="warn">Check</Badge>}</td>
                  <td data-label="What">
                    <strong>{e.title}</strong>
                    <div className="adm-note">
                      {EXCEPTION_KIND[e.kind]} · {e.detail}
                    </div>
                  </td>
                  <td data-label="Who">{e.party?.name ?? "—"}</td>
                  <td data-label="Amount" className="adm-num">
                    {euro(e.amountMinor)}
                  </td>
                  <td data-label="Since">{formatDate(e.createdAt, true)}</td>
                  <td data-label="">
                    {can("finance.operate") || can("finance.payment_state.view") ? (
                      <a className="adm-btn adm-btn--sm" href={`/admin${e.link}`}>
                        Open
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Box>
  );
}
