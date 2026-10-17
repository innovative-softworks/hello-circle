import { useAdminCan } from "./adminPermissions";
import { useState } from "react";
import { ChartColumn, Ticket } from "lucide-react";
import { CouponsUsageSection } from "../AdminFinance";
import { useUrlParam } from "../../useUrlTab";
import { archiveAdminCoupon, createAdminCoupon, fetchAdminCoupons, setAdminCouponActive, type AdminCoupon } from "../../api";
import { ConfirmDialog } from "../ui";
import { AdminButton, Box, EmptyMessage, FormField, Loaded, OverflowMenu, Pager, SearchField, StatusTag, Toolbar, ViewTabs, Visibility, errorMessage, matches, useAdminAction, useAdminData, usePaged, AdminModal, IconTabs } from "./adminUi";

// Coupons (admin redesign 2026-10-14). Same create / pause / resume /
// archive calls; every change still requires a reason (≥5 characters,
// audited server-side). Finance-role only — the server enforces it.

const EMPTY = { code: "", kind: "percent" as "percent" | "fixed", amount: "", maxUses: "", expiresAt: "", funding: "platform" as "platform" | "split", sharePct: "50", minSpend: "", maxDiscount: "", perCustomer: "", startsAt: "", reason: "" };
const euroToCents = (v: string) => (v.trim() === "" ? null : Math.round(Number(v) * 100));
const intOrNull = (v: string) => (v.trim() === "" ? null : Number(v));
const euro = (cents: number) => `€${(cents / 100).toFixed(2)}`;

function fundingLabel(c: AdminCoupon): string {
  if (c.createdByVendorId || c.createdByResidentId || c.funding === "partner") return c.createdByResidentId ? "Host-funded" : "Partner-funded";
  if (c.funding === "split") return `Split · HelloCircle ${(c.platformShareBps / 100).toFixed(0)}%`;
  return "HelloCircle-funded";
}

type FormErrors = Partial<Record<"code" | "amount" | "sharePct" | "expiresAt" | "reason", string>>;

function validate(f: typeof EMPTY): FormErrors {
  const e: FormErrors = {};
  if (!f.code.trim()) e.code = "Enter a code.";
  const amount = Number(f.amount);
  if (!f.amount.trim()) e.amount = "Enter an amount.";
  else if (!(amount > 0)) e.amount = "Must be more than 0.";
  else if (f.kind === "percent" && amount > 100) e.amount = "A percentage can't be more than 100.";
  if (f.funding === "split") {
    const share = Number(f.sharePct);
    if (!(share >= 1 && share <= 99)) e.sharePct = "Enter a share between 1 and 99.";
  }
  if (f.startsAt && f.expiresAt && f.expiresAt < f.startsAt) e.expiresAt = "Must be on or after the start date.";
  if (f.reason.trim().length < 5) e.reason = "Give a reason of at least 5 characters.";
  return e;
}

/** Coupons (2026-10-16): codes and their usage & cost on one page, as tabs. */
export function AdminCouponsPage() {
  const can = useAdminCan();
  // "coupons" is the old Finance section name for usage, kept for old links.
  const [sectionParam, setSection] = useUrlParam<string>("section", "codes");
  const section = sectionParam === "usage" || sectionParam === "coupons" ? "usage" : "codes";
  const canUsage = can("finance.operate");
  return (
    <div className="adm-stack">
      <IconTabs
        label="Coupon sections"
        value={section}
        onChange={(k) => setSection(k)}
        items={[
          { key: "codes" as const, label: "Codes", icon: Ticket },
          ...(canUsage ? [{ key: "usage" as const, label: "Usage & cost", icon: ChartColumn }] : []),
        ]}
      />
      {section === "usage" && canUsage ? <CouponsUsageSection onEditCoupons={() => setSection("codes")} /> : <CouponCodes onViewUsage={canUsage ? () => setSection("usage") : undefined} />}
    </div>
  );
}

function CouponCodes({ onViewUsage }: { onViewUsage?: () => void }) {
  // D-02: archiving (DELETE) is super-only; finance can create, pause and resume.
  const canArchive = useAdminCan()("coupons.delete");
  const state = useAdminData(fetchAdminCoupons);
  const { run, busy } = useAdminAction();
  const [form, setForm] = useState(EMPTY);
  const [createError, setCreateError] = useState<string | null>(null);
  const [action, setAction] = useState<{ coupon: AdminCoupon; kind: "pause" | "resume" | "archive" } | null>(null);
  const [reason, setReason] = useState("");
  const [q, setQ] = useState("");
  const [view, setView] = useState<"all" | "active" | "paused">("all");
  // The list is the everyday view; the form opens on demand (2026-10-16).
  const [showForm, setShowForm] = useState(false);
  const closeForm = () => {
    setShowForm(false);
    setSubmitted(false);
    setCreateError(null);
  };
  const set = (patch: Partial<typeof EMPTY>) => setForm((f) => ({ ...f, ...patch }));

  // Errors show beside each field after the first submit attempt, then live.
  const [submitted, setSubmitted] = useState(false);
  const errors = submitted ? validate(form) : {};
  const create = async () => {
    setSubmitted(true);
    setCreateError(null);
    if (Object.keys(validate(form)).length) return;
    const ok = await run(
      "create",
      () =>
        createAdminCoupon({
          code: form.code.trim(),
          kind: form.kind,
          amount: form.kind === "fixed" ? Math.round(Number(form.amount) * 100) : Number(form.amount),
          maxUses: intOrNull(form.maxUses),
          expiresAt: form.expiresAt || null,
          funding: form.funding,
          platformShareBps: form.funding === "split" ? Math.round(Number(form.sharePct) * 100) : undefined,
          minSpendCents: euroToCents(form.minSpend),
          maxDiscountCents: euroToCents(form.maxDiscount),
          perCustomerLimit: intOrNull(form.perCustomer),
          startsAt: form.startsAt ? new Date(`${form.startsAt}T00:00:00`).toISOString() : null,
          reason: form.reason,
        }).catch((e) => {
          setCreateError(errorMessage(e, "Couldn't create that coupon"));
          throw e;
        }),
      { success: `Coupon ${form.code.trim().toUpperCase()} created` }
    );
    if (ok) {
      setForm(EMPTY);
      setSubmitted(false);
      setShowForm(false);
      state.reload();
    }
  };

  const runAction = () => {
    if (!action) return;
    const { coupon, kind } = action;
    setAction(null);
    run(kind, () => (kind === "archive" ? archiveAdminCoupon(coupon.id, reason) : setAdminCouponActive(coupon.id, kind === "resume", reason)), {
      success: `${coupon.code} ${kind === "archive" ? "archived" : kind === "pause" ? "paused" : "resumed"}`,
    }).then((ok) => ok && state.reload());
    setReason("");
  };

  const visible = (state.data ?? []).filter((c) => !c.archivedAt);
  const base = visible.filter((c) => matches(q, c.code));
  const rows = base.filter((c) => view === "all" || (view === "active" ? c.active : !c.active));
  const paged = usePaged(rows, 20, `${q}|${view}`);

  return (
    <div className="adm-stack">
      <AdminModal
        open={showForm}
        onClose={closeForm}
        wide
        dirty={JSON.stringify(form) !== JSON.stringify(EMPTY)}
        title="New coupon"
        subtitle="Applies to the pre-VAT/fee subtotal. HelloCircle-funded discounts are paid back to the partner, so partners keep their full price."
        footer={
          <>
            <AdminButton variant="quiet" onClick={closeForm}>
              Cancel
            </AdminButton>
            <AdminButton type="submit" form="adm-new-coupon" variant="primary" disabled={busy === "create"}>
              {busy === "create" ? "Creating…" : "Create coupon"}
            </AdminButton>
          </>
        }
      >
        <form
          id="adm-new-coupon"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <p className="adm-note" style={{ marginBottom: 16 }}>
            Fields marked <span className="adm-req" aria-hidden="true">*</span>
            <span className="adm-visually-hidden">with an asterisk</span> are required.
          </p>
          <div className="adm-dlg-grid">
            <FormField label="Code" required error={errors.code}>
              {(p) => <input {...p} className="adm-input" placeholder="WELCOME10" value={form.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} style={{ textTransform: "uppercase" }} />}
            </FormField>
            <FormField label="Type">
              {(p) => (
                <select {...p} className="adm-select" value={form.kind} onChange={(e) => set({ kind: e.target.value as "percent" | "fixed" })}>
                  <option value="percent">% off</option>
                  <option value="fixed">€ off</option>
                </select>
              )}
            </FormField>
            <FormField label={form.kind === "percent" ? "Amount (%)" : "Amount (€)"} required error={errors.amount}>
              {(p) => <input {...p} type="number" min={0} className="adm-input" placeholder={form.kind === "percent" ? "10" : "5.00"} value={form.amount} onChange={(e) => set({ amount: e.target.value })} />}
            </FormField>
            <FormField label="Funded by">
              {(p) => (
                <select {...p} className="adm-select" value={form.funding} onChange={(e) => set({ funding: e.target.value as "platform" | "split" })}>
                  <option value="platform">HelloCircle</option>
                  <option value="split">Split with partner</option>
                </select>
              )}
            </FormField>
            {form.funding === "split" && (
              <FormField label="HelloCircle share (%)" required error={errors.sharePct}>
                {(p) => <input {...p} type="number" min={1} max={99} className="adm-input" value={form.sharePct} onChange={(e) => set({ sharePct: e.target.value })} />}
              </FormField>
            )}
            <FormField label="Max uses">{(p) => <input {...p} type="number" min={0} className="adm-input" placeholder="Unlimited" value={form.maxUses} onChange={(e) => set({ maxUses: e.target.value })} />}</FormField>
            <FormField label="Uses per customer">{(p) => <input {...p} type="number" min={0} className="adm-input" placeholder="Unlimited" value={form.perCustomer} onChange={(e) => set({ perCustomer: e.target.value })} />}</FormField>
            <FormField label="Minimum spend (€)">{(p) => <input {...p} type="number" min={0} className="adm-input" placeholder="None" value={form.minSpend} onChange={(e) => set({ minSpend: e.target.value })} />}</FormField>
            <FormField label="Maximum discount (€)">{(p) => <input {...p} type="number" min={0} className="adm-input" placeholder="None" value={form.maxDiscount} onChange={(e) => set({ maxDiscount: e.target.value })} />}</FormField>
            <FormField label="Starts">{(p) => <input {...p} type="date" className="adm-input" value={form.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />}</FormField>
            <FormField label="Expires" error={errors.expiresAt}>{(p) => <input {...p} type="date" className="adm-input" value={form.expiresAt} onChange={(e) => set({ expiresAt: e.target.value })} />}</FormField>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginTop: 16, flexWrap: "wrap" }}>
            <FormField label="Reason" required error={errors.reason} hint={<Visibility who="internal" />} style={{ flex: "1 1 280px" }}>
              {(p) => <input {...p} className="adm-input" style={{ width: "100%" }} placeholder="e.g. Autumn launch campaign" value={form.reason} onChange={(e) => set({ reason: e.target.value })} />}
            </FormField>
          </div>
        </form>
        {createError && (
          <div className="adm-callout" data-tone="error" role="alert" style={{ marginTop: 12 }}>
            {createError}
          </div>
        )}
      </AdminModal>

      <Box
        icon={Ticket}
        title="Coupons"
        subtitle={
          onViewUsage ? (
            <>
              Uses, returns and discount given are under{" "}
              <button type="button" className="adm-metric-link" style={{ margin: 0 }} onClick={onViewUsage}>
                Usage &amp; cost
              </button>
              .
            </>
          ) : undefined
        }
        actions={<AdminButton variant="primary" onClick={() => setShowForm(true)}>New coupon</AdminButton>}
        flush
      >
        <ViewTabs
          label="Coupon state"
          value={view}
          onChange={setView}
          views={[
            { key: "all", label: "All", count: state.data ? base.length : undefined },
            { key: "active", label: "Active", count: state.data ? base.filter((c) => c.active).length : undefined },
            { key: "paused", label: "Paused", count: state.data ? base.filter((c) => !c.active).length : undefined },
          ]}
        />
        <Toolbar label="Search coupons">
          <SearchField label="Search coupons" value={q} onChange={setQ} placeholder="Code" />
        </Toolbar>
        <Loaded state={state}>
          {() =>
            rows.length === 0 ? (
              <EmptyMessage icon={<Ticket size={22} strokeWidth={1.9} aria-hidden="true" />} title={visible.length ? "No coupons match" : "No coupons yet"} detail={visible.length ? undefined : "Use New coupon to create the first code."} />
            ) : (
              <>
                <div className="adm-table-wrap">
                  <table className="adm-table adm-table--stack">
                    <caption className="adm-visually-hidden">Coupons</caption>
                    <thead>
                      <tr>
                        <th scope="col">Code</th>
                        <th scope="col" className="adm-num">Discount</th>
                        <th scope="col">Funding</th>
                        <th scope="col">Usage &amp; limits</th>
                        <th scope="col">State</th>
                        <th scope="col">
                          <span className="adm-visually-hidden">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {paged.slice.map((c) => (
                        <tr key={c.id}>
                          <td data-label="Code" className="adm-mono" style={{ fontWeight: 700, fontSize: 13 }}>
                            {c.code}
                          </td>
                          <td data-label="Discount" className="adm-num">{c.kind === "percent" ? `${c.amount}% off` : `${euro(c.amount)} off`}</td>
                          <td data-label="Funding">
                            {fundingLabel(c)}
                            {!!c.platformFundedMinor && <div className="adm-cell-sub">HelloCircle has funded {euro(c.platformFundedMinor)}</div>}
                          </td>
                          <td data-label="Usage & limits">
                            Used {c.usedCount}
                            {c.maxUses ? ` of ${c.maxUses}` : ""}
                            <div className="adm-cell-sub">
                              {[
                                c.perCustomerLimit ? `${c.perCustomerLimit} per customer` : null,
                                c.minSpendCents ? `min spend ${euro(c.minSpendCents)}` : null,
                                c.maxDiscountCents ? `max ${euro(c.maxDiscountCents)} off` : null,
                                c.startsAt ? `from ${c.startsAt.slice(0, 10)}` : null,
                                c.expiresAt ? `expires ${c.expiresAt.slice(0, 10)}` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "No other limits"}
                            </div>
                          </td>
                          <td data-label="State">
                            <StatusTag status={c.active ? "active" : "paused"} />
                          </td>
                          <td>
                            <div className="adm-cell-actions">
                              <AdminButton size="sm" disabled={!!busy} onClick={() => { setReason(""); setAction({ coupon: c, kind: c.active ? "pause" : "resume" }); }}>
                                {c.active ? "Pause" : "Resume"}
                              </AdminButton>
                              {canArchive && <OverflowMenu label={`More actions for ${c.code}`} actions={[{ label: "Archive coupon…", danger: true, disabled: !!busy, onSelect: () => { setReason(""); setAction({ coupon: c, kind: "archive" }); } }]} />}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager {...paged} noun="coupons" />
              </>
            )
          }
        </Loaded>
      </Box>

      <ConfirmDialog
        open={!!action}
        title={action ? `${action.kind === "archive" ? "Archive" : action.kind === "pause" ? "Pause" : "Resume"} ${action.coupon.code}?` : ""}
        message={action?.kind === "archive" ? "The code stops working and is hidden here; past orders keep their record." : action?.kind === "pause" ? "The code stops working until you resume it." : "The code works again from now."}
        confirmLabel={action?.kind === "archive" ? "Archive" : action?.kind === "pause" ? "Pause" : "Resume"}
        tone={action?.kind === "archive" ? "danger" : "neutral"}
        confirmDisabled={reason.trim().length < 5}
        onConfirm={runAction}
        onCancel={() => setAction(null)}
      >
        <label htmlFor="adm-coupon-reason" style={{ display: "block", fontSize: 13, fontWeight: 600, margin: "4px 0 6px" }}>
          Reason (required — at least 5 characters)
        </label>
        <div style={{ marginBottom: 6 }}>
          <Visibility who="internal" />
        </div>
        <textarea id="adm-coupon-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: "100%", resize: "vertical", padding: 8, border: "1px solid var(--color-input-border)", font: "inherit" }} />
      </ConfirmDialog>
    </div>
  );
}
