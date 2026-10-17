import { useEffect, useId, useState, type ReactNode } from "react";
import { Building2, CalendarRange, CircleDot, Compass, Search, Ticket, Trophy, UserRound, Users, type LucideIcon, ShoppingBag, Undo2 } from "lucide-react";
import { cancelOrderAsAdmin, proposeBookingChangeAsAdmin, fetchSupportOrder, fetchSupportPerson, supportSearch, type SupportOrder, type SupportOrderKind, type SupportPerson } from "../../api";
import { ConfirmDialog } from "../ui";
import { ObjectActivity } from "./AdminAudit";
import { ProposeChangeDialog } from "../workspace/BookingChangeParts";
import { useRecordParam, useUrlParam } from "../../useUrlTab";
import { RecordState, RecordView } from "../workspace/RecordView";
import type { AdminTab } from "./adminNav";
import { useAdminCan } from "./adminPermissions";
import { AdminButton, Badge, Box, EmptyMessage, ErrorMessage, Facts, LoadingRows, SectionLabel, StatusTag, formatDate, useAdminAction, useAdminData } from "./adminUi";

// Support (2026-10-16). One search across every kind of order, the people
// behind them (resident email sign-ins and partner/admin logins, one row per
// email), games and circles. Every person and order opens as its own page
// (`?record=person:<email>` / `?record=order:<kind>:<ref>`), read-only. The
// search text is in the URL, so Back from a record returns to the results.

const KIND: Record<SupportOrderKind, { label: string; icon: LucideIcon }> = {
  booking: { label: "Hall booking", icon: Building2 },
  registration: { label: "Club registration", icon: Trophy },
  program: { label: "Programme enrolment", icon: CalendarRange },
  game: { label: "Game place", icon: Users },
  experience: { label: "Experience booking", icon: Compass },
  pass: { label: "Pass", icon: Ticket },
};
const ICON = { size: 18, strokeWidth: 1.9, "aria-hidden": true } as const;

const euro = (cents: number | null) => (cents === null ? "" : (cents / 100).toLocaleString("en-IE", { style: "currency", currency: "EUR" }));

export function PaymentTag({ status }: { status: string | null }) {
  if (!status) return null;
  const map: Record<string, [string, "good" | "warn" | "bad" | "neutral"]> = {
    paid: ["Paid", "good"],
    free: ["Free", "neutral"],
    pending: ["Payment pending", "warn"],
    failed: ["Payment failed", "bad"],
    refunded: ["Refunded", "neutral"],
    partially_refunded: ["Part refunded", "neutral"],
    cash: ["Pay on the day", "neutral"],
  };
  const [label, tone] = map[status] ?? [status.replace(/_/g, " "), "neutral" as const];
  return <Badge tone={tone}>{label}</Badge>;
}

function OrderRow({ o, onOpen }: { o: SupportOrder; onOpen: () => void }) {
  const k = KIND[o.kind];
  const Icon = k.icon;
  return (
    <li className="adm-ov-row">
      <span className="adm-ov-tile">
        <Icon {...ICON} />
      </span>
      <div className="adm-ov-main">
        <div className="adm-ov-title">{o.listingName || k.label}</div>
        <div className="adm-ov-detail">
          {[o.name, o.email].filter(Boolean).join(" · ") || "No customer details"} · <span className="adm-mono">{o.ref}</span>
        </div>
      </div>
      <div className="adm-ov-kind">
        {k.label}
        {o.whenText && <div>{o.whenText}</div>}
      </div>
      <div className="adm-ov-when">
        <strong style={{ color: "var(--adm-text)" }}>{euro(o.amountCents)}</strong>
        <span style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <PaymentTag status={o.paymentStatus} />
          {o.status && o.status !== "confirmed" && o.status !== "joined" && <StatusTag status={o.status} />}
        </span>
      </div>
      <AdminButton size="sm" onClick={onOpen} aria-label={`Open ${k.label.toLowerCase()} ${o.ref}`}>
        Open
      </AdminButton>
    </li>
  );
}

function PersonRow({ p, onOpen }: { p: SupportPerson; onOpen: () => void }) {
  return (
    <li className="adm-ov-row">
      <span className="adm-ov-tile">
        <UserRound {...ICON} />
      </span>
      <div className="adm-ov-main">
        <div className="adm-ov-title">{p.name || p.email}</div>
        <div className="adm-ov-detail">{p.email}</div>
      </div>
      <div className="adm-ov-kind">{[p.resident ? "Resident" : null, p.account ? (p.account.role === "vendor" ? "Partner" : "Admin") : null].filter(Boolean).join(" + ") || "Guest (no account)"}</div>
      <div className="adm-ov-when">{p.account && p.account.status !== "approved" ? <StatusTag status={p.account.status} /> : <span>{p.resident || p.account ? "Since" : "Ordered"} {formatDate(p.createdAt)}</span>}</div>
      <AdminButton size="sm" onClick={onOpen} aria-label={`Open ${p.name || p.email}`}>
        Open
      </AdminButton>
    </li>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <>
      <h3 className="adm-ov-group">
        {title} <span>{count}</span>
      </h3>
      <ul className="adm-ov-list">{children}</ul>
    </>
  );
}

// --- person page --------------------------------------------------------------

function PersonRecord({ email, onBack, openOrder, onNavigate }: { email: string; onBack: () => void; openOrder: (o: SupportOrder) => void; onNavigate: (tab: AdminTab, extra?: Record<string, string>) => void }) {
  const state = useAdminData(() => fetchSupportPerson(email), [email]);
  if (state.error) return <RecordState state={(state.error as { status?: number }).status === 404 ? "missing" : "error"} backLabel="Support" onBack={onBack} onRetry={state.reload} />;
  if (!state.data) return <RecordState state="loading" backLabel="Support" onBack={onBack} />;
  const p = state.data;
  const paid = p.orders.filter((o) => o.paymentStatus === "paid").reduce((n, o) => n + (o.amountCents ?? 0), 0);
  const problems = p.orders.filter((o) => o.paymentStatus === "failed" || o.paymentStatus === "pending").length;
  const refunded = p.orders.filter((o) => o.paymentStatus === "refunded" || o.paymentStatus === "partially_refunded").length;
  return (
    <RecordView
      title={p.name || p.email}
      reference={p.email}
      backLabel="Support"
      onBack={onBack}
      statuses={
        <>
          <span className="adm-note">Resident account:</span> {p.resident ? <Badge tone="good">Yes</Badge> : <Badge tone="neutral">No</Badge>}
          {p.account && (
            <>
              <span className="adm-note">{p.account.role === "vendor" ? "Partner account:" : "Admin account:"}</span> <StatusTag status={p.account.status} label={p.account.status === "approved" ? "Approved" : undefined} />
            </>
          )}
        </>
      }
      actions={
        p.account?.role === "vendor" ? (
          <AdminButton onClick={() => onNavigate("vendors", { record: p.account!.id })}>Open partner account</AdminButton>
        ) : undefined
      }
    >
      <div className="adm-stack">
        <section aria-label="Order summary" className="adm-ov-totals">
          <div>
            <strong>{p.orders.length}</strong>
            {p.orders.length === 1 ? "order" : "orders"}
          </div>
          <div>
            <strong>{euro(paid)}</strong>paid in total
          </div>
          <div data-tone={problems ? "alert" : undefined}>
            <strong>{problems}</strong>pending or failed payments
          </div>
          <div>
            <strong>{refunded}</strong>refunded
          </div>
        </section>

        <Box icon={ShoppingBag} title="Orders" subtitle={p.orders.length ? "Newest first, every kind" : undefined} flush>
            {p.orders.length === 0 ? (
              <EmptyMessage title="No orders" detail="Nothing has been booked with this email or account." />
            ) : (
              <ul className="adm-ov-list">
                {p.orders.map((o) => (
                  <OrderRow key={`${o.kind}:${o.ref}`} o={o} onOpen={() => openOrder(o)} />
                ))}
              </ul>
            )}
        </Box>
        <Box icon={UserRound} title="Accounts">
            <SectionLabel>Resident (email sign-in)</SectionLabel>
            {p.resident ? (
              <Facts
                rows={[
                  ["Name", p.resident.name || null],
                  ["County", p.resident.county || null],
                  ["Joined", formatDate(p.resident.createdAt)],
                  ["Household", p.resident.householdMembers ? `${p.resident.householdMembers} member${p.resident.householdMembers === 1 ? "" : "s"}` : "None added"],
                ]}
              />
            ) : (
              <p className="adm-note">No resident account. Orders made without signing in are matched by email.</p>
            )}
            {p.account && (
              <>
                <SectionLabel>{p.account.role === "vendor" ? "Partner login" : "Admin login"}</SectionLabel>
                <Facts
                  rows={[
                    ["Name", p.account.name || null],
                    ["Status", <StatusTag status={p.account.status} label={p.account.status === "approved" ? "Approved" : undefined} />],
                    ["Created", formatDate(p.account.createdAt)],
                  ]}
                />
              </>
            )}
        </Box>
      </div>
    </RecordView>
  );
}

// --- order page ---------------------------------------------------------------

const EXTRA_LABEL: Record<string, string> = {
  phone: "Phone",
  guests: "Guests",
  durationHours: "Hours booked",
  eventType: "Event",
  roomName: "Room",
  notes: "Notes from the customer",
  participant: "Participant",
  team: "Team",
  trial: "Trial session",
  place: "Place",
  attended: "Attended",
  partySize: "Party size",
  creditsTotal: "Credits",
  creditsUsed: "Credits used",
  expiresAt: "Expires",
};

function OrderRecord({ kind, refId, onBack, openPerson, onNavigate }: { kind: string; refId: string; onBack: () => void; openPerson: (email: string) => void; onNavigate: (tab: AdminTab, extra?: Record<string, string>) => void }) {
  const can = useAdminCan();
  const state = useAdminData(() => fetchSupportOrder(kind, refId), [kind, refId]);
  // OG-10 — cancel on the provider's behalf (the same cancel path partners
  // use: the customer is told, a paid online order is refunded in full).
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [proposing, setProposing] = useState(false);
  const { run } = useAdminAction();
  if (state.error) return <RecordState state={(state.error as { status?: number }).status === 404 ? "missing" : "error"} backLabel="Support" onBack={onBack} onRetry={state.reload} />;
  if (!state.data) return <RecordState state="loading" backLabel="Support" onBack={onBack} />;
  const { order: o, extra, refunds, underReview } = state.data;
  const k = KIND[o.kind];
  const extraRows: [string, ReactNode][] = Object.entries(extra)
    .filter(([key, v]) => EXTRA_LABEL[key] && v !== null && v !== "" && !(key === "creditsUsed"))
    .map(([key, v]) => {
      if (key === "creditsTotal") return ["Credits", `${extra.creditsUsed ?? 0} of ${v} used`];
      if (key === "trial" || key === "attended") return [EXTRA_LABEL[key], v ? "Yes" : "No"];
      if (key === "expiresAt") return [EXTRA_LABEL[key], formatDate(String(v))];
      return [EXTRA_LABEL[key], String(v)];
    });
  return (
    <RecordView
      title={`${k.label} ${o.ref}`}
      reference={o.listingName ?? undefined}
      backLabel="Support"
      onBack={onBack}
      statuses={
        <>
          <span className="adm-note">Payment:</span> <PaymentTag status={o.paymentStatus} />
          {o.status && (
            <>
              <span className="adm-note">Order:</span> <StatusTag status={o.status} label={o.status === "confirmed" || o.status === "joined" ? "Confirmed" : undefined} />
            </>
          )}
          {underReview && <Badge tone="warn">Payment under review</Badge>}
        </>
      }
      actions={
        <>
          {o.email && <AdminButton onClick={() => openPerson(o.email!)}>View customer</AdminButton>}
          {o.email && (
            <a className="adm-btn" href={`mailto:${o.email}?subject=${encodeURIComponent(`Your HelloCircle order ${o.ref}`)}`}>
              Email customer
            </a>
          )}
          {o.kind === "booking" && o.status !== "cancelled" && o.paymentStatus === "paid" && o.whenText && can("orders.cancel") && (
            <AdminButton onClick={() => setProposing(true)}>Propose a new time…</AdminButton>
          )}
          {CANCELLABLE.includes(o.kind) && o.status !== "cancelled" && can("orders.cancel") && (
            <AdminButton variant="danger" onClick={() => setCancelling(true)}>
              Cancel on behalf…
            </AdminButton>
          )}
          {can("finance.operate") && (
            <AdminButton onClick={() => onNavigate("finance", { section: "refunds", record: `order:${o.kind}:${o.ref}` })}>
              View in Finance
            </AdminButton>
          )}
        </>
      }
    >
      {underReview && (
        <div className="adm-callout" style={{ marginBottom: 16 }}>
          Stripe received money for this order, but it couldn't be confirmed automatically. Finance is reviewing it. Don't tell the customer they're booked until it's resolved.
        </div>
      )}
      <div className="adm-grid-2">
        <Box icon={ShoppingBag} title="Order">
          <Facts
            rows={[
              ["What", o.listingName ?? k.label],
              ["Type", k.label],
              ["When", o.whenText],
              ...extraRows.filter(([label]) => label !== "Phone"),
              ["Amount", euro(o.amountCents) || null],
              ["Placed", formatDate(o.createdAt, true)],
              ["Reference", <span className="adm-mono">{o.ref}</span>],
            ]}
          />
        </Box>
        <Box icon={UserRound} title="Customer">
          <Facts
            rows={[
              ["Name", o.name],
              [
                "Email",
                o.email ? (
                  <button type="button" className="adm-linkish" onClick={() => openPerson(o.email!)}>
                    {o.email}
                  </button>
                ) : null,
              ],
              ["Phone", extra.phone ? String(extra.phone) : null],
              ["Signed in", o.residentId ? "Yes, with a resident account" : "No, booked as a guest"],
            ]}
          />
        </Box>
      </div>
      <div style={{ marginTop: 24 }}>
        <Box icon={Undo2} title="Refunds" flush>
          {refunds.length === 0 ? (
            <p className="adm-note" style={{ padding: "14px 24px", margin: 0 }}>
              No refunds on this order.
            </p>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table adm-table--stack">
                <thead>
                  <tr>
                    <th scope="col">Amount</th>
                    <th scope="col">Type</th>
                    <th scope="col">Status</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {refunds.map((r, i) => (
                    <tr key={i}>
                      <td data-label="Amount">{euro(r.amountMinor)}</td>
                      <td data-label="Type">{r.kind === "full" ? "Full" : r.kind === "partial" ? "Partial" : r.kind}</td>
                      <td data-label="Status">
                        <StatusTag status={r.status === "succeeded" ? "active" : r.status === "failed" ? "rejected" : "pending"} label={r.status.charAt(0).toUpperCase() + r.status.slice(1).replace(/_/g, " ")} />
                      </td>
                      <td data-label="Reason">{r.reason}</td>
                      <td data-label="Date">{formatDate(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Box>
      </div>
      <div style={{ marginTop: 24 }}>
        <SectionLabel>Activity</SectionLabel>
        <ObjectActivity objectIds={[o.ref]} note="Cancellations, refunds and payment changes on this order are recorded." />
      </div>
      {o.kind === "booking" && o.whenText && (
        <ProposeChangeDialog
          open={proposing}
          onClose={() => setProposing(false)}
          current={{ date: o.whenText.split(" ")[0], time: o.whenText.split(" ")[1] ?? "" }}
          messageRequired
          onPropose={(input) => proposeBookingChangeAsAdmin(o.ref, input)}
        />
      )}
      <ConfirmDialog
        open={cancelling}
        title={`Cancel ${k.label.toLowerCase()} ${o.ref}?`}
        message={
          o.paymentStatus === "paid" && (o.amountCents ?? 0) > 0
            ? `The customer is told it's cancelled by the provider. If ${euro(o.amountCents)} was paid online it's refunded in full; a pay-at-venue order has nothing to refund.`
            : "The customer is told it's cancelled by the provider."
        }
        confirmLabel="Cancel order"
        confirmDisabled={cancelReason.trim().length < 10}
        onConfirm={() =>
          run(
            "cancel",
            async () => {
              const r = await cancelOrderAsAdmin(o.kind, o.ref, cancelReason.trim());
              if (r.refund === "failed") throw new Error(`Cancelled, but the refund didn't go through (${r.refundError ?? "provider error"}). It's listed under Operations → Exceptions.`);
            },
            { success: "Order cancelled" }
          ).then((ok) => {
            setCancelling(false);
            setCancelReason("");
            state.reload();
            return ok;
          })
        }
        onCancel={() => setCancelling(false)}
      >
        <label htmlFor="adm-order-cancel-reason" style={{ display: "block", fontSize: 13, fontWeight: 600, margin: "12px 0 4px" }}>
          Reason <span aria-hidden="true">*</span>
        </label>
        <textarea id="adm-order-cancel-reason" className="adm-input" rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Venue closed for repairs; agreed with the partner on the phone" style={{ width: "100%", resize: "vertical" }} />
        <p className="adm-note" style={{ margin: "6px 0 0" }}>Recorded in the audit log. At least 10 characters.</p>
      </ConfirmDialog>
    </RecordView>
  );
}

const CANCELLABLE: string[] = ["booking", "registration", "program", "experience"];

// --- page -----------------------------------------------------------------------

export function AdminSupportPage({ onNavigate }: { onNavigate: (tab: AdminTab, extra?: Record<string, string>) => void }) {
  const inputId = useId();
  const [query, setQuery] = useUrlParam<string>("q", "");
  const [text, setText] = useState(query);
  useEffect(() => setText(query), [query]);
  const [record, openRecord, closeRecord] = useRecordParam();
  const results = useAdminData(() => supportSearch(query), [query]);

  const openOrder = (o: SupportOrder) => openRecord(`order:${o.kind}:${o.ref}`);
  const openPerson = (email: string) => openRecord(`person:${email}`);

  if (record?.startsWith("person:")) return <PersonRecord email={record.slice(7)} onBack={closeRecord} openOrder={openOrder} onNavigate={onNavigate} />;
  if (record?.startsWith("order:")) {
    const [, kind, ...rest] = record.split(":");
    return <OrderRecord kind={kind} refId={rest.join(":")} onBack={closeRecord} openPerson={openPerson} onNavigate={onNavigate} />;
  }
  if (record) return <RecordState state="missing" backLabel="Support" onBack={closeRecord} />;

  const d = results.data;
  const total = d ? d.people.length + d.orders.length + d.games.length + d.circles.length : 0;

  return (
    <div className="adm-stack">
      <Box flush>
        <form
          className="adm-toolbar"
          role="search"
          aria-label="Support lookup"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(text.trim());
          }}
        >
          <div className="adm-field adm-search" style={{ flex: "1 1 320px" }}>
            <label htmlFor={inputId}>Find a customer, order, game or circle</label>
            <div style={{ position: "relative" }}>
              <Search size={18} strokeWidth={1.9} aria-hidden="true" />
              <input id={inputId} type="search" className="adm-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Name, email or reference, e.g. HC-7Q2K" />
            </div>
          </div>
          <AdminButton type="submit" variant="primary">
            Search
          </AdminButton>
          {query && (
            <AdminButton
              onClick={() => {
                setText("");
                setQuery("");
              }}
            >
              Clear
            </AdminButton>
          )}
        </form>
        <p className="adm-note" style={{ padding: "0 24px 14px", margin: 0 }} aria-live="polite">
          {query ? (d ? `${total} result${total === 1 ? "" : "s"} for “${query}”` : `Searching for “${query}”…`) : "Searches every kind of order (hall bookings, club registrations, programmes, games, experiences, passes), resident and partner accounts, games and circles."}
        </p>
      </Box>

      {results.error ? (
        <Box>
          <ErrorMessage error={results.error} onRetry={results.reload} />
        </Box>
      ) : !d ? (
        <Box>
          <LoadingRows rows={4} label="Searching" />
        </Box>
      ) : !query ? (
        <Box icon={ShoppingBag} title="Recent orders" subtitle="The latest 20, every kind" flush>
          {d.orders.length === 0 ? (
            <EmptyMessage icon={<Search size={22} strokeWidth={1.9} aria-hidden="true" />} title="No orders yet" detail="Search by name or email to find a resident or partner." />
          ) : (
            <ul className="adm-ov-list">
              {d.orders.map((o) => (
                <OrderRow key={`${o.kind}:${o.ref}`} o={o} onOpen={() => openOrder(o)} />
              ))}
            </ul>
          )}
        </Box>
      ) : total === 0 ? (
        <Box>
          <EmptyMessage icon={<Search size={22} strokeWidth={1.9} aria-hidden="true" />} title={`Nothing found for “${query}”`} detail="Try part of the email, the last name, or the full reference." />
        </Box>
      ) : (
        <Box flush>
          {d.people.length > 0 && (
            <Group title="People" count={d.people.length}>
              {d.people.map((p) => (
                <PersonRow key={p.email} p={p} onOpen={() => openPerson(p.email)} />
              ))}
            </Group>
          )}
          {d.orders.length > 0 && (
            <Group title="Orders" count={d.orders.length}>
              {d.orders.map((o) => (
                <OrderRow key={`${o.kind}:${o.ref}`} o={o} onOpen={() => openOrder(o)} />
              ))}
            </Group>
          )}
          {d.games.length + d.circles.length > 0 && (
            <Group title="Games & circles" count={d.games.length + d.circles.length}>
              {d.games.map((g) => (
                <li key={`g:${g.id}`} className="adm-ov-row">
                  <span className="adm-ov-tile">
                    <Users {...ICON} />
                  </span>
                  <div className="adm-ov-main">
                    <div className="adm-ov-title">{g.activityLabel}</div>
                    <div className="adm-ov-detail">{[g.place, `${g.date} ${g.time}`].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="adm-ov-kind">Game</div>
                  <div className="adm-ov-when">
                    <StatusTag status={g.status} />
                  </div>
                  {g.bookingRef ? (
                    <AdminButton size="sm" onClick={() => openRecord(`order:booking:${g.bookingRef}`)} aria-label={`Open the hall booking behind ${g.activityLabel}`}>
                      Booking
                    </AdminButton>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
              {d.circles.map((c) => (
                <li key={`c:${c.id}`} className="adm-ov-row">
                  <span className="adm-ov-tile">
                    <CircleDot {...ICON} />
                  </span>
                  <div className="adm-ov-main">
                    <div className="adm-ov-title">{c.name}</div>
                    <div className="adm-ov-detail">{[c.activityLabel, c.county].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="adm-ov-kind">Circle</div>
                  <div className="adm-ov-when">
                    <span>
                      {c.memberCount} member{c.memberCount === 1 ? "" : "s"}
                    </span>
                    <StatusTag status={c.status} />
                  </div>
                  <span />
                </li>
              ))}
            </Group>
          )}
        </Box>
      )}
    </div>
  );
}
