import { useCallback, useEffect, useState } from "react";
import { fetchCirclePlanIdeas, fetchCircleRestrictions, liftCircleRestriction } from "../../api";
import { useCircleFeatures } from "../../circleFeatures";
import type { Circle, CirclePlanIdea, CircleRestriction } from "../../types";
import { useConfirm } from "../ConfirmProvider";
import { Card, LoadErrorState, PageSpinner } from "../ui";
import { CircleMakeItHappen } from "./CircleMakeItHappen";
import { CircleCollaborations } from "./CircleCollaborations";
import { CirclePulseSection, type SuggestPlanPrefill } from "./CirclePulseSection";
import "./circleExperience.css";

// Circle Experience 2.0 — organiser workspace additions (/manage/circles/:id).
//
// ManageCirclePlanning ("Pulse & proposals" tab): what members want to do
// (Circle Pulse totals + organiser notes) and every suggested plan with its
// interest, to confirm, decline or turn into an activity.
// RemovedMembersCard (Members tab): owner decision D5 — people removed from
// the Circle can't rejoin until an organiser lifts it here. Both audited
// server-side.

export function ManageCirclePlanning({ circle, residentId }: { circle: Circle; residentId: string }) {
  const features = useCircleFeatures();
  const [plans, setPlans] = useState<CirclePlanIdea[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [prefill, setPrefill] = useState<SuggestPlanPrefill | null>(null);
  const load = useCallback(() => {
    setFailed(false);
    fetchCirclePlanIdeas(circle.id)
      .then(setPlans)
      .catch(() => setFailed(true));
  }, [circle.id]);
  useEffect(load, [load]);
  const clearPrefill = useCallback(() => setPrefill(null), []);
  if (failed) return <LoadErrorState title="Couldn't load this Circle's plans" onRetry={load} />;
  if (!plans) return <PageSpinner />;
  const closed = circle.status === "closed";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {features["circles.pulse"] && (
        <section className="ce-section" style={{ borderTop: 0, paddingTop: 0 }}>
          <CirclePulseSection
            circleId={circle.id}
            closed={closed}
            isOrganiser
            refreshKey={plans.length}
            onSuggestPlan={setPrefill}
            onViewPlan={(id) => document.getElementById(`plan-${id}`)?.scrollIntoView({ block: "start" })}
          />
        </section>
      )}
      <section className="ce-section" style={features["circles.pulse"] ? undefined : { borderTop: 0, paddingTop: 0 }}>
        <CircleMakeItHappen
          circleId={circle.id}
          plans={plans}
          isOrganiser
          residentId={residentId}
          closed={closed}
          makeItHappen={features["circles.make_it_happen"]}
          prefill={prefill}
          onPrefillUsed={clearPrefill}
          onChanged={load}
        />
      </section>
      {features["circles.collaboration"] && (
        <section className="ce-section">
          <CircleCollaborations circle={circle} />
        </section>
      )}
    </div>
  );
}

export function RemovedMembersCard({ circleId, refreshKey }: { circleId: string; refreshKey: number }) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<CircleRestriction[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setFailed(false);
    fetchCircleRestrictions(circleId)
      .then(setRows)
      .catch(() => setFailed(true));
  }, [circleId]);
  useEffect(load, [load, refreshKey]);
  if (failed) return <LoadErrorState title="Couldn't load removed members" onRetry={load} />;
  if (!rows || rows.length === 0) return null;
  const lift = async (r: CircleRestriction) => {
    const ok = await confirm({
      title: `Let ${r.name} back in?`,
      message: "They'll be able to join or ask to join again, like anyone else. They aren't added automatically.",
      confirmLabel: "Lift",
    });
    if (!ok) return;
    setBusy(r.residentId);
    setError(null);
    try {
      await liftCircleRestriction(circleId, r.residentId);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card>
      <h2 style={{ fontWeight: 700, fontSize: 16, margin: "0 0 4px" }}>Removed members</h2>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-muted-light)" }}>They can't rejoin or ask to join until you lift it.</p>
      {error && (
        <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, margin: "0 0 10px" }}>
          {error}
        </p>
      )}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((r) => (
          <li key={r.residentId} style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", background: "var(--color-bg)", borderRadius: "var(--radius-control)", padding: "10px 14px" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{r.name}</div>
              <div style={{ fontSize: 12, color: "var(--color-muted-light)" }}>
                Removed {new Date(r.createdAt).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })} by {r.restrictedByName}
                {r.reason ? ` · ${r.reason}` : ""}
              </div>
            </div>
            <button type="button" className="ce-link" onClick={() => lift(r)} disabled={busy === r.residentId}>
              {busy === r.residentId ? "Lifting…" : "Lift"}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
