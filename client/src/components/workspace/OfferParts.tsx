import { ListFilterBar, NoMatches, useListFilters } from "./ListFilters";
import { useState } from "react";
import { Tag } from "lucide-react";
import { AdminButton, AdminModal, Box, FormField } from "../admin/adminUi";
import { EmptyState } from "../ui";
import { useUrlParam } from "../../useUrlTab";
import { WsListTable } from "./WsListTable";

// Offers (discount codes) for the partner and host workspaces, 2026-10-16:
// the create form is a popup opened from the page header ("New offer" sets
// `?create=1`), the codes are one table. Partner codes can cover any of their
// listings; host codes always name one priced session (games.ts POST /coupons).

export interface OfferRow {
  id: string | number;
  code: string;
  kind: "percent" | "fixed";
  /** Percent, or cents for a fixed amount. */
  amount: number;
  usedCount: number;
  maxUses?: number | null;
  active: boolean | number;
  expiresAt?: string | null;
}

export interface OfferInput {
  code: string;
  kind: "percent" | "fixed";
  /** Percent, or cents for a fixed amount. */
  amount: number;
  expiresAt?: string;
  target: string;
}

/** `?create=1` — shared by the header button and the page. */
export function useCreateParam(): [boolean, (open: boolean) => void] {
  const [v, set] = useUrlParam<string>("create", "");
  return [v === "1", (open) => set(open ? "1" : "")];
}

const EMPTY = { code: "", kind: "percent" as "percent" | "fixed", amount: "10", expiresAt: "" };

export function OfferDialog({
  targets,
  targetLabel,
  onCreate,
}: {
  targets: { value: string; label: string }[];
  targetLabel: string;
  onCreate: (input: OfferInput) => Promise<void>;
}) {
  const [open, setOpen] = useCreateParam();
  const [form, setForm] = useState(EMPTY);
  const [target, setTarget] = useState(targets[0]?.value ?? "");
  const [errors, setErrors] = useState<{ code?: string; amount?: string; save?: string }>({});
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof EMPTY>) => setForm((f) => ({ ...f, ...patch }));
  const close = () => {
    setForm(EMPTY);
    setErrors({});
    setOpen(false);
  };
  const submit = async () => {
    const amount = Number(form.amount);
    const next: typeof errors = {};
    if (!form.code.trim()) next.code = "Enter a code";
    if (!(amount > 0) || (form.kind === "percent" && amount > 100)) next.amount = form.kind === "percent" ? "Between 1 and 100" : "More than €0";
    setErrors(next);
    if (next.code || next.amount) return;
    setBusy(true);
    try {
      await onCreate({
        code: form.code.trim(),
        kind: form.kind,
        amount: form.kind === "fixed" ? Math.round(amount * 100) : amount,
        expiresAt: form.expiresAt || undefined,
        target: target || targets[0]?.value || "",
      });
      close();
    } catch (e) {
      setErrors({ save: e instanceof Error ? e.message : "Couldn't create that offer" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <AdminModal
      open={open}
      onClose={close}
      dirty={JSON.stringify(form) !== JSON.stringify(EMPTY)}
      title="New offer"
      subtitle="A discount code people enter at checkout. You fund the discount."
      footer={
        <>
          <AdminButton variant="quiet" onClick={close}>
            Cancel
          </AdminButton>
          <AdminButton type="submit" form="ws-new-offer" variant="primary" disabled={busy || targets.length === 0}>
            {busy ? "Creating…" : "Create offer"}
          </AdminButton>
        </>
      }
    >
      <form
        id="ws-new-offer"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="adm-dlg-grid">
          <FormField label="Code" required error={errors.code}>
            {(p) => <input {...p} className="adm-input" placeholder="SUMMER10" value={form.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} style={{ textTransform: "uppercase" }} />}
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
            {(p) => <input {...p} type="number" min={0} step={form.kind === "fixed" ? "0.01" : "1"} className="adm-input" value={form.amount} onChange={(e) => set({ amount: e.target.value })} />}
          </FormField>
          <FormField label="Expires (optional)">
            {(p) => <input {...p} type="date" className="adm-input" value={form.expiresAt} onChange={(e) => set({ expiresAt: e.target.value })} />}
          </FormField>
          <FormField label={targetLabel} style={{ gridColumn: "1 / -1" }}>
            {(p) => (
              <select {...p} className="adm-select" value={target} onChange={(e) => setTarget(e.target.value)}>
                {targets.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </div>
        {errors.save && (
          <p role="alert" className="adm-field-error" style={{ margin: "12px 0 0" }}>
            {errors.save}
          </p>
        )}
      </form>
    </AdminModal>
  );
}

export function OffersList({
  offers,
  appliesTo,
  appliesToLabel,
  onToggle,
  emptyHint,
}: {
  offers: OfferRow[];
  appliesTo: (o: OfferRow) => string;
  appliesToLabel: string;
  onToggle: (o: OfferRow) => void;
  emptyHint: string;
}) {
  const [, setCreate] = useCreateParam();
  const filters = useListFilters<OfferRow>({
    param: "oq",
    search: (o) => [o.code, appliesTo(o)],
    selects: [{ param: "ostatus", label: "Status", options: [{ value: "active", label: "Active" }, { value: "paused", label: "Paused" }], get: (o) => (o.active ? "active" : "paused") }],
  });
  const shown = filters.apply(offers);
  return (
    <Box flush>
      {offers.length > 5 && <ListFilterBar state={filters} searchLabel="Search offers" placeholder="Code or listing" />}
      {offers.length === 0 ? (
        <EmptyState
          icon={<Tag size={20} />}
          title="No offers yet"
          subtitle={emptyHint}
          action={
            <AdminButton variant="primary" onClick={() => setCreate(true)}>
              New offer
            </AdminButton>
          }
        />
      ) : shown.length === 0 ? (
        <NoMatches onClear={filters.clear} noun="offers" />
      ) : (
        <WsListTable
          caption="Your offers"
          columns={[{ label: "Code" }, { label: "Discount" }, { label: appliesToLabel }, { label: "Uses", num: true }, { label: "Status" }]}
          rows={shown.map((o) => ({
            key: String(o.id),
            name: o.code,
            title: <span style={{ fontFamily: "var(--adm-mono, ui-monospace, monospace)", letterSpacing: "0.02em" }}>{o.code}</span>,
            detail: o.expiresAt ? `Expires ${new Date(o.expiresAt).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })}` : "No expiry",
            cells: [
              o.kind === "percent" ? `${o.amount}% off` : `€${(o.amount / 100).toFixed(2)} off`,
              appliesTo(o),
              `${o.usedCount}${o.maxUses ? ` / ${o.maxUses}` : ""}`,
              <span className="adm-chip" data-tone={o.active ? "good" : undefined}>
                {o.active ? "Active" : "Paused"}
              </span>,
            ],
            menu: [{ label: o.active ? "Pause offer" : "Activate offer", onSelect: () => onToggle(o) }],
          }))}
        />
      )}
    </Box>
  );
}
