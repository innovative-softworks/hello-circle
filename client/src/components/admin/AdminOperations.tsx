import { useState, type ReactNode } from "react";
import { AlertTriangle, Award, Receipt, Ticket, UserRound, UsersRound } from "lucide-react";
import {
  cancelActivityAsAdmin,
  fetchActivitiesPage,
  fetchAdminActivity,
  fetchAdminCirclesPage,
  fetchAdminCirclePlanning,
  adminRemoveCircleWish,
  adminRemoveCirclePlan,
  adminDeleteCirclePoll,
  adminSetCircleOpen,
  adminRemoveCircleLink,
  fetchHostsPage,
  fetchOperationalExceptions,
  fetchOrdersPage,
  fetchPeoplePage,
} from "../../api";
import { useUrlParam, useRecordParam } from "../../useUrlTab";
import { ConfirmDialog, LoadMoreControl } from "../ui";
import { RecordState, RecordView } from "../workspace/RecordView";
import { ContextSection, CopyValue, DetailFacts, DetailSection, DetailStats } from "../workspace/DetailParts";
import type { AdminTab } from "./adminNav";
import { useAdminCan } from "./adminPermissions";
import {
  RowMenu,
  OverflowMenu,
  statusLabel,
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
  copy,
  rowName,
}: {
  caption: string;
  list: ReturnType<typeof useServerPage<T>>;
  columns: Column<T>[];
  rowKey: (r: T) => string;
  onOpen?: (r: T) => void;
  openLabel?: (r: T) => string;
  emptyTitle: string;
  filtered: boolean;
  /** What "Copy reference" copies (defaults to the row key). */
  copy?: { label: string; value: (r: T) => string };
  rowName?: (r: T) => string;
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
              <th scope="col">
                <span className="adm-visually-hidden">Actions</span>
              </th>
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
                <td data-label="">
                  <div className="adm-cell-actions">
                    {onOpen && (
                      <AdminButton size="sm" onClick={() => onOpen(r)} aria-label={openLabel?.(r)}>
                        Open
                      </AdminButton>
                    )}
                    <RowMenu
                      name={rowName?.(r) ?? rowKey(r)}
                      items={onOpen ? [{ label: "Open", onSelect: () => onOpen(r) }] : []}
                      copy={{ label: copy?.label ?? "Copy reference", value: copy ? copy.value(r) : rowKey(r) }}
                    />
                  </div>
                </td>
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
        copy={{ label: "Copy email", value: (r) => r.email }}
        rowName={(r) => r.name || r.email}
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
        copy={{ label: "Copy order reference", value: (r) => r.ref }}
        rowName={(r) => r.ref}
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
        rowName={(r) => r.activityLabel}
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
      reference={a.place ? String(a.place) : "No place given"}
      backLabel="Activities"
      onBack={onBack}
      statuses={<StatusTag status={a.status} />}
      actions={
        <>
          <AdminButton onClick={() => window.open(`/games/${a.id}`, "_blank", "noopener")}>View public page</AdminButton>
          {live && can("activities.moderate") && <OverflowMenu label={`More actions for ${a.activityLabel}`} actions={[{ label: "Cancel activity…", danger: true, onSelect: () => setCancelling(true) }]} />}
        </>
      }
      stats={
        <DetailStats
          items={[
            { label: "Going", value: `${joined.length} / ${a.capacity}`, sub: `${Math.max(0, Number(a.capacity) - joined.length)} places left` },
            { label: "Price", value: a.priceCents ? euro(Number(a.priceCents)) : "Free", sub: paidOnline ? `${paidOnline} paid online` : "per place" },
            { label: "When", value: formatDate(a.date), sub: a.time },
            { label: "Reports", value: String(reports.length), sub: reports.length ? "See the panel" : "None" },
          ]}
        />
      }
      asideLabel="Host and activity details"
      aside={
        <>
          <ContextSection title="Host">
            <div className="wd-ctx-name">{a.hostName ?? "Unknown host"}</div>
            {a.hostEmail && (
              <a className="wd-ctx-sub" href={`mailto:${a.hostEmail}`}>
                {a.hostEmail}
              </a>
            )}
          </ContextSection>
          <ContextSection title="Activity details">
            <DetailFacts
              columns={1}
              rows={[
                ["Activity ID", <CopyValue value={a.id} label="activity ID" />],
                ["Visibility", a.visibility ? String(a.visibility) : null],
                ["Created", formatDate(String(a.createdAt), true)],
              ]}
            />
          </ContextSection>
          <ContextSection title={`Reports (${reports.length})`}>
            {reports.length === 0 ? (
              <p className="adm-note">No reports.</p>
            ) : (
              <ul className="wd-rows">
                {reports.map((r) => (
                  <li key={r.id}>
                    <span className="wd-rows-main">
                      {r.reason}
                      <span className="wd-ctx-sub">{formatDate(r.createdAt)}</span>
                    </span>
                    <StatusTag status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </ContextSection>
        </>
      }
    >
      <DetailSection title="Place">
        <DetailFacts
          rows={[
            ["Where", a.place ? String(a.place) : "No place given"],
            ["Venue booking", a.bookingRef ? <span className="adm-mono">{String(a.bookingRef)}</span> : "None"],
          ]}
        />
      </DetailSection>
      <DetailSection title={`Participants (${participants.length})`}>
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
      </DetailSection>
      <DetailSection title="Activity">
        <ObjectActivity objectIds={[a.id]} />
      </DetailSection>
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
  const [record, openRecord, closeRecord] = useRecordParam();
  const [q, setQ] = useUrlParam<string>("q", "");
  const [status, setStatus] = useUrlParam<string>("status", "all");
  const query = useDebounced(q.trim());
  const list = useServerPage((cursor) => fetchAdminCirclesPage({ q: query || undefined, status: status === "all" ? undefined : status, cursor }), [query, status]);
  if (record?.startsWith("circle:")) return <AdminCircleRecord id={record.slice(7)} onBack={closeRecord} />;
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
        copy={{ label: "Copy Circle link", value: (r) => `${window.location.origin}/circles/${r.slug ?? r.id}` }}
        rowName={(r) => r.name}
        onOpen={(r) => openRecord(`circle:${r.id}`)}
        openLabel={(r) => `Open ${r.name}`}
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

type CircleRemoval =
  | { kind: "wish"; label: string; weekStart: string; interestKey: string }
  | { kind: "plan"; label: string; id: string }
  | { kind: "poll"; label: string; id: string }
  | { kind: "close"; label: string }
  | { kind: "link"; label: string; id: string }
  | { kind: "reopen"; label: string };

const REMOVAL_COPY: Record<CircleRemoval["kind"], { title: string; message: string; confirm: string }> = {
  wish: { title: "Remove this wish?", message: "Everyone's wish for it this week goes. The people who added it are told it was taken down by HelloCircle, with your reason.", confirm: "Remove wish" },
  plan: { title: "Remove this plan?", message: "It's kept as cancelled and every member is told, with your reason. A plan that's already an activity is cancelled from the activity instead.", confirm: "Remove plan" },
  poll: { title: "Delete this poll?", message: "The poll and its votes are deleted for everyone. Your reason is recorded in the audit log.", confirm: "Delete poll" },
  link: { title: "Remove this linked listing?", message: "It stops showing in the Circle. The listing, its bookings and any other Circles it's in aren't affected. Organisers are told, with your reason.", confirm: "Remove link" },
  close: { title: "Close this Circle?", message: "It drops out of browsing and becomes read-only: no joins, plans, polls or invitations, and its chat becomes history. Bookings members made aren't touched. Organisers are told, with your reason. Only HelloCircle can reopen it.", confirm: "Close Circle" },
  reopen: { title: "Reopen this Circle?", message: "It becomes active and listed again. Organisers are told, with your reason.", confirm: "Reopen Circle" },
};

// Circle planning moderation (owner, 2026-10-24): wishes (totals only — never
// who), plans and polls, each removable by staff with reports.moderate and a
// recorded reason.
function AdminCircleRecord({ id, onBack }: { id: string; onBack: () => void }) {
  const can = useAdminCan();
  const state = useAdminData(() => fetchAdminCirclePlanning(id), [id]);
  const [removing, setRemoving] = useState<CircleRemoval | null>(null);
  const [reason, setReason] = useState("");
  const { run } = useAdminAction();
  if (state.error) return <RecordState state={(state.error as { status?: number }).status === 404 ? "missing" : "error"} backLabel="Circles" onBack={onBack} onRetry={state.reload} />;
  if (!state.data) return <RecordState state="loading" backLabel="Circles" onBack={onBack} />;
  const { circle, wishes, plans, polls } = state.data;
  const links = state.data.links ?? [];
  const canRemove = can("reports.moderate");
  const ask = (r: CircleRemoval) => {
    setReason("");
    setRemoving(r);
  };
  const livePlans = plans.filter((p) => p.status === "idea" || p.status === "confirmed");
  return (
    <RecordView
      title={circle.name}
      reference={circle.activityLabel}
      backLabel="Circles"
      onBack={onBack}
      statuses={<StatusTag status={circle.status} />}
      actions={
        <>
          <AdminButton onClick={() => window.open(`/circles/${circle.slug ?? circle.id}`, "_blank", "noopener")}>View public page</AdminButton>
          {canRemove && circle.status === "active" && <AdminButton variant="danger" onClick={() => ask({ kind: "close", label: circle.name })}>Close Circle</AdminButton>}
          {canRemove && circle.status === "closed" && circle.closedBy === "helloCircle" && <AdminButton onClick={() => ask({ kind: "reopen", label: circle.name })}>Reopen Circle</AdminButton>}
        </>
      }
      stats={
        <DetailStats
          items={[
            { label: "Wishes", value: String(wishes.length), sub: "open this week and next" },
            { label: "Plans", value: String(livePlans.length), sub: `${plans.length} in total` },
            { label: "Polls", value: String(polls.filter((p) => p.status === "open").length), sub: `${polls.length} in total` },
          ]}
        />
      }
      asideLabel="Circle details"
      aside={
        <ContextSection title="Circle">
          <DetailFacts columns={1} rows={[["Circle ID", <CopyValue value={circle.id} label="Circle ID" />]]} />
          <p className="adm-note">Members see wishes as totals only, so this page never shows who wished for what.</p>
        </ContextSection>
      }
    >
      <DetailSection title={`Wishes (${wishes.length})`}>
        {wishes.length === 0 ? (
          <p className="adm-note">No open wishes.</p>
        ) : (
          <ul className="wd-rows">
            {wishes.map((w) => (
              <li key={`${w.weekStart}|${w.interestKey}`}>
                <span className="wd-rows-main">
                  {w.interest}
                  <span className="wd-ctx-sub">
                    Week of {formatDate(w.weekStart)} · {w.count} {w.count === 1 ? "person" : "people"}
                  </span>
                </span>
                {canRemove && <AdminButton onClick={() => ask({ kind: "wish", label: w.interest, weekStart: w.weekStart, interestKey: w.interestKey })}>Remove</AdminButton>}
              </li>
            ))}
          </ul>
        )}
      </DetailSection>
      <DetailSection title={`Plans (${plans.length})`}>
        {plans.length === 0 ? (
          <p className="adm-note">No plans.</p>
        ) : (
          <ul className="wd-rows">
            {plans.map((p) => (
              <li key={p.id}>
                <span className="wd-rows-main">
                  {p.title}
                  <span className="wd-ctx-sub">
                    {p.listingType ? `About a ${p.listingType === "game" ? "activity" : p.listingType === "program" ? "programme" : p.listingType} listing · ` : ""}
                    {p.proposedDate ? `Proposed ${formatDate(p.proposedDate)}` : "No date"} · suggested by {p.createdByName ?? "a member"} · {formatDate(p.createdAt)}
                  </span>
                </span>
                <StatusTag status={p.status} />
                {canRemove && (p.status === "idea" || p.status === "confirmed") && <AdminButton onClick={() => ask({ kind: "plan", label: p.title, id: p.id })}>Remove</AdminButton>}
              </li>
            ))}
          </ul>
        )}
      </DetailSection>
      <DetailSection title={`Polls (${polls.length})`}>
        {polls.length === 0 ? (
          <p className="adm-note">No polls.</p>
        ) : (
          <ul className="wd-rows">
            {polls.map((p) => (
              <li key={p.id}>
                <span className="wd-rows-main">
                  {p.question}
                  <span className="wd-ctx-sub">
                    {p.voters} {p.voters === 1 ? "person" : "people"} voted · {formatDate(p.createdAt)}
                  </span>
                </span>
                <StatusTag status={p.status} />
                {canRemove && <AdminButton onClick={() => ask({ kind: "poll", label: p.question, id: p.id })}>Delete</AdminButton>}
              </li>
            ))}
          </ul>
        )}
      </DetailSection>
      <DetailSection title={`Linked listings (${links.length})`}>
        {links.length === 0 ? (
          <p className="adm-note">Nothing linked.</p>
        ) : (
          <ul className="wd-rows">
            {links.map((l) => (
              <li key={l.id}>
                <span className="wd-rows-main">
                  {l.title}
                  <span className="wd-ctx-sub">
                    {l.listingType === "game" ? "Activity" : l.listingType === "program" ? "Programme" : l.listingType === "experience" ? "Experience" : "Place"} · {l.relationship === "created_for" ? "made for the Circle" : "linked"} by {l.linkedByName ?? "a member"} · {formatDate(l.createdAt)}
                  </span>
                </span>
                <StatusTag status={l.status} />
                {canRemove && (l.status === "approved" || l.status === "pending") && <AdminButton onClick={() => ask({ kind: "link", label: l.title, id: l.id })}>Remove</AdminButton>}
              </li>
            ))}
          </ul>
        )}
      </DetailSection>
      <DetailSection title="Activity">
        <ObjectActivity objectIds={[circle.id]} />
      </DetailSection>
      <ConfirmDialog
        open={!!removing}
        title={removing ? REMOVAL_COPY[removing.kind].title : ""}
        message={removing ? `"${removing.label}". ${REMOVAL_COPY[removing.kind].message}` : ""}
        confirmLabel={removing ? REMOVAL_COPY[removing.kind].confirm : ""}
        tone={removing?.kind === "reopen" ? "neutral" : "danger"}
        confirmDisabled={reason.trim().length < 10}
        onConfirm={() => {
          const r = removing!;
          const why = reason.trim();
          return run(
            "remove",
            () =>
              r.kind === "wish"
                ? adminRemoveCircleWish(circle.id, { weekStart: r.weekStart, interestKey: r.interestKey }, why)
                : r.kind === "plan"
                  ? adminRemoveCirclePlan(circle.id, r.id, why)
                  : r.kind === "close" || r.kind === "reopen"
                    ? adminSetCircleOpen(circle.id, r.kind, why)
                    : r.kind === "link"
                    ? adminRemoveCircleLink(circle.id, r.id, why)
                    : adminDeleteCirclePoll(circle.id, r.id, why),
            { success: r.kind === "link" ? "Link removed" : r.kind === "poll" ? "Poll deleted" : r.kind === "plan" ? "Plan removed" : r.kind === "close" ? "Circle closed" : r.kind === "reopen" ? "Circle reopened" : "Wish removed" }
          ).then((ok) => {
            if (ok) {
              setRemoving(null);
              state.reload();
            }
            return ok;
          });
        }}
        onCancel={() => setRemoving(null)}
      >
        <div className="adm-field">
          <label htmlFor="adm-circle-removal-reason">
            Reason <span aria-hidden="true">*</span>
          </label>
          <textarea id="adm-circle-removal-reason" className="adm-input" rows={3} maxLength={500} aria-describedby="adm-circle-removal-hint" value={reason} onChange={(e) => setReason(e.target.value)} />
          <p id="adm-circle-removal-hint" className="adm-note">At least 10 characters. {removing?.kind === "close" || removing?.kind === "reopen" || removing?.kind === "link" ? "Organisers see it" : "Members see it for wishes and plans"}; it's always recorded.</p>
        </div>
      </ConfirmDialog>
    </RecordView>
  );
}

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
        copy={{ label: "Copy email", value: (r) => r.email }}
        rowName={(r) => r.name || r.email}
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
                    <div className="adm-cell-actions">
                      {can("finance.operate") || can("finance.payment_state.view") ? (
                        <a className="adm-btn adm-btn--sm" href={`/admin${e.link}`}>
                          Open
                        </a>
                      ) : null}
                      <RowMenu
                        name={e.title}
                        items={can("finance.operate") || can("finance.payment_state.view") ? [{ label: "Open in Finance", onSelect: () => window.location.assign(`/admin${e.link}`) }] : []}
                        copy={{ value: e.id }}
                      />
                    </div>
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
