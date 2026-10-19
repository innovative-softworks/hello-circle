import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../AuthContext";
import { Link } from "react-router-dom";
import { fetchVendorObligations } from "../api";
import type { VendorObligations } from "../types";
import { DecisionExplanation } from "./DecisionExplanation";
import { BanIcon } from "./icons";
import { ManageCard as Card, LoadErrorState } from "./ui";
import { colors, fonts } from "../theme";

// D-01 — what a member of a suspended organisation sees in the Partner
// workspace: why (the reason category and explanation, never the internal
// note), the organisation's existing obligations, read-only, and how to get
// in touch or ask for the decision to be looked at again. Nothing else in
// the workspace is available until the organisation is reinstated (the
// server refuses every other partner API).
//
// Detail follows the member's existing access: the owner, managers and
// finance (who see bookings in the workspace today) get per-booking rows;
// other roles get the schedule-level summary everyone already has.

const KIND_LABEL: Record<string, string> = { booking: "Venue booking", registration: "Club registration", enrolment: "Programme enrolment", experience: "Experience booking" };

export function OrgSuspendedView() {
  const [data, setData] = useState<VendorObligations | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = () => {
    setError(null);
    fetchVendorObligations().then(setData).catch(setError);
  };
  useEffect(load, []);

  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth: 860, margin: "0 auto", padding: "48px 24px" }}>
        <Card style={{ padding: 28 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span style={{ color: colors.muted, flex: "none", marginTop: 2 }}>
              <BanIcon size={28} />
            </span>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 24, margin: "0 0 6px" }}>Your organisation is suspended</h1>
              <p style={{ color: colors.muted, fontSize: 15, lineHeight: 1.5, margin: 0 }}>
                HelloCircle has suspended your organisation. Its listings are hidden and can't take new bookings, and the Partner workspace is read-only. Existing bookings
                haven't been cancelled or refunded — the ones still to come are listed below so you can honour them or contact the customers' booking support.
              </p>
              {data && <DecisionExplanation decision={data.decision} />}
              <p style={{ fontSize: 14, margin: "12px 0 0" }}>
                <Link to="/contact">Contact HelloCircle</Link> · <Link to="/complaints">Ask for the decision to be looked at again</Link>
              </p>
            </div>
          </div>
        </Card>

        <h2 style={{ fontFamily: fonts.display, fontSize: 18, margin: "28px 0 10px" }}>Upcoming obligations</h2>
        {error ? (
          <LoadErrorState title="Couldn't load your obligations" onRetry={load} />
        ) : !data ? (
          <p style={{ color: colors.mutedLight }} role="status">
            Loading…
          </p>
        ) : data.summary.length === 0 ? (
          <p style={{ color: colors.mutedLight }}>No upcoming bookings, registrations or enrolments.</p>
        ) : data.detail ? (
          <div style={{ overflowX: "auto" }}>
            <table className="hc-stack-table" aria-label="Upcoming obligations" style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  {["Date", "Listing", "Type", "Customer", "Reference", "Payment"].map((h) => (
                    <th key={h} scope="col" style={{ textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${colors.border}` }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((o) => (
                  <tr key={`${o.kind}:${o.ref}`}>
                    <td data-label="Date" style={{ padding: "8px 10px" }}>{o.date ? `${o.date}${o.time ? ` · ${o.time}` : ""}` : "Ongoing"}</td>
                    <td data-label="Listing" style={{ padding: "8px 10px" }}>{o.listing}</td>
                    <td data-label="Type" style={{ padding: "8px 10px" }}>{KIND_LABEL[o.kind]}</td>
                    <td data-label="Customer" style={{ padding: "8px 10px" }}>{o.customerFirstName || "—"}</td>
                    <td data-label="Reference" style={{ padding: "8px 10px" }}><span style={{ fontFamily: "monospace" }}>{o.ref}</span></td>
                    <td data-label="Payment" style={{ padding: "8px 10px" }}>{o.paymentState === "paid" ? "Paid" : "Awaiting payment"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <p style={{ color: colors.mutedLight, fontSize: 13.5 }}>Your role shows the schedule only; the organisation owner, managers and finance can see the bookings themselves.</p>
            <ul style={{ paddingLeft: 18 }}>
              {data.summary.map((s) => (
                <li key={`${s.date}|${s.listing}`}>
                  {s.date ?? "Ongoing"} — {s.listing}: {s.count} {s.count === 1 ? "booking" : "bookings"}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

/** D-08 — a staff member removed from their organisation. */
export function RemovedFromOrgView() {
  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "64px 24px" }}>
        <Card style={{ textAlign: "center", padding: 32 }}>
          <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 22, margin: "0 0 8px" }}>You're no longer part of an organisation</h1>
          <p style={{ color: colors.muted, fontSize: 15, lineHeight: 1.5 }}>
            The organisation you worked with removed you from its team, so its Partner workspace isn't available to you. Your HelloCircle account still exists. If you think this is a mistake, ask the organisation's owner.
          </p>
          <Link to="/">Go to HelloCircle</Link>
        </Card>
      </section>
    </div>
  );
}

/** D-01 / D-08 — wraps partner pages reached by direct link (editors, Pro,
 * rewards): a suspended organisation's member or a removed member sees the
 * matching read-only page instead of a page whose every request is refused. */
export function PartnerOrgGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role === "vendor" && user.orgStatus === "suspended") return <OrgSuspendedView />;
  if (user?.role === "vendor" && user.invitedStaff && !user.orgId) return <RemovedFromOrgView />;
  return <>{children}</>;
}
