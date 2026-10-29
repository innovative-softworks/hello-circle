import { useEffect, useState } from "react";
import { ApiError, fetchFormAnswers, type FormRef } from "../../api";
import { LoadErrorState, PageSpinner } from "../ui";
import { colors, radius } from "../../theme";
import type { StoredAnswer } from "../../types";
import { answerLabel } from "./attendeeSlots";

// Phase H — the answers people gave on a club, programme or hall form, per
// registration / enrolment / booking, as they saw the question (wording and
// version are kept with each answer). Only the listing's managers can read
// them; anyone else in the organisation sees why, not an error.

type Order = { ref: string; name: string; at: string; cancelled: boolean; answers: StoredAnswer[] };

const when = (at: string) => {
  const d = new Date(at.length <= 16 ? at.replace(" ", "T") : at);
  return Number.isNaN(d.getTime()) ? at : d.toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
};

export function FormAnswersPanel({ listing }: { listing: Exclude<FormRef, string> }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [state, setState] = useState<"ok" | "error" | "forbidden">("ok");
  const load = () => {
    setState("ok");
    setOrders(null);
    fetchFormAnswers(listing)
      .then((r) => setOrders(r.orders))
      .catch((e) => setState(e instanceof ApiError && e.status === 403 ? "forbidden" : "error"));
  };
  useEffect(load, [listing.listingType, listing.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const noun = listing.listingType === "club" ? "registration" : listing.listingType === "program" ? "enrolment" : "booking";
  return (
    <section aria-labelledby={`answers-${listing.id}`} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
      <h2 id={`answers-${listing.id}`} style={{ fontSize: 16, margin: 0 }}>Answers</h2>
      {state === "forbidden" ? (
        <p style={{ margin: 0, color: colors.muted, fontSize: 14 }}>Only the managers of this listing can see people's answers.</p>
      ) : state === "error" ? (
        <LoadErrorState title="Couldn't load the answers" onRetry={load} />
      ) : !orders ? (
        <PageSpinner />
      ) : orders.length === 0 ? (
        <p style={{ margin: 0, color: colors.muted, fontSize: 14 }}>No answers yet. They appear here with each {noun}.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {orders.map((o) => (
            <li key={o.ref} style={{ border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: 12, background: colors.surface }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 14 }}>
                <strong>{o.name}</strong>
                <span style={{ color: colors.muted }}>{o.ref} · {when(o.at)}{o.cancelled ? " · cancelled" : ""}</span>
              </div>
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
      )}
    </section>
  );
}
