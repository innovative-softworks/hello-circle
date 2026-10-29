import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, downloadFormAnswers, fetchFormAnswers, type FormRef } from "../../api";
import { LoadErrorState, PageSpinner } from "../ui";
import { colors, radius } from "../../theme";
import type { StoredAnswer } from "../../types";
import { answerLabel } from "./attendeeSlots";

// Phase H — the answers people gave on a club, programme or hall form, per
// registration / enrolment / booking, as they saw the question (wording and
// version are kept with each answer). Only the listing's managers can read
// them; anyone else in the organisation sees why, not an error.

const SOURCE = { club: "registration", program: "program", centre: "booking" } as const;

type Order = { ref: string; name: string; at: string; cancelled: boolean; answers: StoredAnswer[]; missing: string[] };
type Filter = "all" | "missing" | "complete" | "cancelled";

const when = (at: string) => {
  const d = new Date(at.length <= 16 ? at.replace(" ", "T") : at);
  return Number.isNaN(d.getTime()) ? at : d.toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
};

export function FormAnswersPanel({ listing }: { listing: Exclude<FormRef, string> }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [state, setState] = useState<"ok" | "error" | "forbidden">("ok");
  // Phase J — find a registration by name or reference, and narrow by what it needs.
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const load = () => {
    setState("ok");
    setOrders(null);
    fetchFormAnswers(listing)
      .then((r) => setOrders(r.orders))
      .catch((e) => setState(e instanceof ApiError && e.status === 403 ? "forbidden" : "error"));
  };
  useEffect(load, [listing.listingType, listing.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const noun = listing.listingType === "club" ? "registration" : listing.listingType === "program" ? "enrolment" : "booking";
  const shown = (orders ?? []).filter((o) => {
    if (q.trim() && !`${o.name} ${o.ref}`.toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (filter === "missing") return !o.cancelled && o.missing.length > 0;
    if (filter === "complete") return !o.cancelled && o.missing.length === 0;
    if (filter === "cancelled") return o.cancelled;
    return true;
  });
  const waiting = (orders ?? []).filter((o) => !o.cancelled && o.missing.length > 0).length;
  return (
    <section aria-labelledby={`answers-${listing.id}`} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 id={`answers-${listing.id}`} style={{ fontSize: 16, margin: 0 }}>Registrations and answers{waiting ? ` · ${waiting} waiting for answers` : ""}</h2>
        {/* Phase L — exportable answers only, under the platform's field policy; audited. */}
        {state === "ok" && orders && orders.length > 0 && (
          <button type="button" className="adm-btn adm-btn--sm" onClick={() => void downloadFormAnswers(listing).catch(() => setState("error"))}>Download answers (CSV)</button>
        )}
      </div>
      {state === "forbidden" ? (
        <p style={{ margin: 0, color: colors.muted, fontSize: 14 }}>Only the managers of this listing can see people's answers.</p>
      ) : state === "error" ? (
        <LoadErrorState title="Couldn't load the answers" onRetry={load} />
      ) : !orders ? (
        <PageSpinner />
      ) : orders.length === 0 ? (
        <p style={{ margin: 0, color: colors.muted, fontSize: 14 }}>No {noun}s yet. Each one appears here with its answers.</p>
      ) : (
        <>
        <div role="search" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, flex: "1 1 220px" }}>
            Search by name or reference
            <input type="search" className="adm-input" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            Show
            <select className="adm-select" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="all">All</option>
              <option value="missing">Waiting for answers</option>
              <option value="complete">Complete</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
        </div>
        {shown.length === 0 && <p style={{ margin: 0, color: colors.muted, fontSize: 14 }}>Nothing matches.</p>}
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {shown.map((o) => (
            <li key={o.ref} style={{ border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: 12, background: colors.surface }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 14 }}>
                <Link to={`/vendor/orders/${SOURCE[listing.listingType]}/${encodeURIComponent(o.ref)}`} style={{ fontWeight: 700, color: "inherit" }}>{o.name}</Link>
                <span style={{ color: colors.muted }}>{o.ref} · {when(o.at)}{o.cancelled ? " · cancelled" : ""}</span>
              </div>
              {o.missing.length > 0 && <p style={{ margin: "6px 0 0", fontSize: 13, color: colors.orangeDark, fontWeight: 600 }}>Waiting for: {o.missing.join("; ")}</p>}
              {o.answers.length === 0 && o.missing.length === 0 && <p style={{ margin: "6px 0 0", fontSize: 13, color: colors.muted }}>No answers given.</p>}
              <dl style={{ margin: "8px 0 0", display: "grid", gap: 4, fontSize: 14 }}>
                {o.answers.map((a) => (
                  <div key={`${a.attendeeNo}-${a.key}`}>
                    <dt style={{ display: "inline", color: colors.muted }}>{answerLabel(a.label)}</dt>
                    <dd style={{ display: "inline", margin: 0 }}>{a.display ?? a.value}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
        </>
      )}
    </section>
  );
}
