import { useState } from "react";
import { FileText } from "lucide-react";
import { downloadVendorStatement, fetchVendorStatement } from "../api";
import { irelandToday } from "../irelandDate";
import { AdminButton, Box, Facts, Loaded, SelectField, errorMessage, useAdminData } from "./admin/adminUi";
import { useToast } from "./Toast";

// OG-25 — a monthly statement: orders taken, refunds made, the fees and
// partner share recorded on each payment (blank where none was recorded),
// and the bank payouts Stripe reported. Not a VAT invoice (D-04 is open);
// plain sums only, nothing netted.

const euro = (cents: number) => `€${(cents / 100).toFixed(2)}`;

function lastMonths(n: number): { value: string; label: string }[] {
  const [y, m] = irelandToday().split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const value = d.toISOString().slice(0, 7);
    return { value, label: d.toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "UTC" }) };
  });
}

export function VendorStatementCard() {
  const toast = useToast();
  const months = lastMonths(12);
  const [month, setMonth] = useState(months[0].value);
  const state = useAdminData(() => fetchVendorStatement(month), [month]);
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      await downloadVendorStatement(month);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't download the statement"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ marginTop: 16 }}>
      <Box icon={FileText} title="Monthly statement" subtitle="Orders, refunds, recorded fees and bank payouts for one month, as recorded. Not a VAT invoice.">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14 }}>
          <SelectField label="Month" value={month} onChange={setMonth} options={months} />
          <AdminButton onClick={download} disabled={busy}>
            {busy ? "Preparing…" : "Download CSV"}
          </AdminButton>
        </div>
        <Loaded state={state} rows={2} title="Couldn't load this statement">
          {(s) => (
            <Facts
              rows={[
                ["Orders taken", `${s.totals.orders} · ${euro(s.totals.orderTotalCents)}`],
                ["Refunds made", `${s.totals.refunds} · ${euro(s.totals.refundedCents)}`],
                ["Fees recorded on payments", s.lines.some((l) => l.customerFeeCents !== null) ? euro(s.totals.recordedFeeCents) : "None recorded this month"],
                ["Your share recorded", s.lines.some((l) => l.partnerShareCents !== null) ? euro(s.totals.recordedPartnerShareCents) : "None recorded this month"],
                ["Bank payouts", `${s.totals.payouts} paid · ${euro(s.totals.paidOutCents)}${s.payouts.length > s.totals.payouts ? ` (${s.payouts.length - s.totals.payouts} not paid)` : ""}`],
              ]}
            />
          )}
        </Loaded>
      </Box>
    </div>
  );
}
