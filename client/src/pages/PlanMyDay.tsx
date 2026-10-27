import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { deleteDayPlan, fetchSavedPlans, planMyDay, saveDayPlan, type DayPlanSuggestion, type DayStop, type SavedDayPlan } from "../api";
import { signInHref } from "../authRedirect";
import { BackLink } from "../components/BackLink";
import { FieldLabel } from "../components/form";
import { CalendarIcon, PinIcon } from "../components/icons";
import { PageTitle } from "../components/PageTitle";
import { Button, EmptyState, LoadErrorState, PageSpinner, Skeleton, inputStyle } from "../components/ui";
import { useConfirm } from "../components/ConfirmProvider";
import { useExperienceFeatures } from "../circleFeatures";
import { dateLabel, euro } from "../euro";
import { useGuest } from "../GuestContext";
import { addDays, irelandToday } from "../irelandDate";
import { IRISH_COUNTY_COORDS } from "../irishCounties";
import { usePageTitle } from "../pageTitle";
import { colors, fonts } from "../theme";
import "../components/circle/circleExperience.css";

// Experience 3.0 — Plan My Day (experience.plan_my_day, owner decision D1).
// A form on the left, the suggested day on the right: real listings with a
// stated length, in an order you could actually do them, with *rough*
// travel estimates between confirmed places. Each stop is joined or booked on
// its own page — nothing here reserves or pays for anything, and a saved plan
// re-checks every stop each time you open it.

const MOODS = [
  { value: "any", label: "Anything" },
  { value: "active", label: "Play" },
  { value: "move", label: "Move" },
  { value: "chill", label: "Chill" },
  { value: "social", label: "Social" },
  { value: "creative", label: "Creative" },
  { value: "learn", label: "Learn" },
];
const BUDGETS = [
  { value: "", label: "No limit" },
  { value: "0", label: "Free only" },
  { value: "2000", label: "Up to €20" },
  { value: "5000", label: "Up to €50" },
  { value: "10000", label: "Up to €100" },
];
const COUNTIES = Object.keys(IRISH_COUNTY_COORDS).sort();
const CURRENT: Record<SavedDayPlan["items"][number]["current"], string> = {
  listed: "Still listed",
  full: "Now full",
  changed: "Time changed",
  gone: "No longer listed",
  past: "In the past",
};

export function PlanMyDay() {
  usePageTitle("Plan My Day");
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { resident } = useGuest();
  const on = useExperienceFeatures()["experience.plan_my_day"];
  const [date, setDate] = useState(irelandToday());
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("18:00");
  const [budget, setBudget] = useState("");
  const [mood, setMood] = useState("any");
  const [county, setCounty] = useState("");
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [plan, setPlan] = useState<DayPlanSuggestion | null>(null);
  const [stops, setStops] = useState<DayStop[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedDayPlan[] | null>(null);
  const [savedFailed, setSavedFailed] = useState(false);
  const [saveState, setSaveState] = useState<string | null>(null);
  const shown = useRef<string[]>([]);

  const loadSaved = () => {
    if (!resident) return;
    setSavedFailed(false);
    fetchSavedPlans()
      .then(setSaved)
      .catch(() => setSavedFailed(true));
  };
  useEffect(() => {
    if (on) loadSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, resident]);

  const run = async (another = false) => {
    setBusy(true);
    setError(null);
    setSaveState(null);
    if (!another) shown.current = [];
    try {
      const p = await planMyDay({ date, startTime, endTime, maxPriceCents: budget === "" ? null : Number(budget), county: county || undefined, mood, origin, exclude: another ? shown.current : [] });
      shown.current = [...shown.current, ...p.stops.map((s) => s.id)];
      setPlan(p);
      setStops(p.stops);
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't plan that. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const locate = () => {
    if (!navigator.geolocation) return setError("Location isn't available in this browser.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setError("Couldn't get your location — plans start at the first stop instead.");
        setLocating(false);
      },
      { timeout: 8000 }
    );
  };
  const save = async () => {
    if (!resident) return navigate(signInHref());
    if (stops.length === 0) return;
    setSaveState("Saving…");
    try {
      await saveDayPlan({ title: `${dateLabel(date)} plan`, date, items: stops });
      setSaveState("Saved. You'll find it below and in My Life.");
      loadSaved();
    } catch (e) {
      setSaveState(e instanceof Error ? e.message : "That didn't save.");
    }
  };

  if (!on) {
    return (
      <section className="section-pad" style={{ maxWidth: 720, margin: "0 auto", padding: "60px 24px" }}>
        <EmptyState icon={<CalendarIcon size={20} />} title="Plan My Day isn't switched on yet" action={<Link className="ce-link" to="/free-time">Try Free Time Mode</Link>} />
      </section>
    );
  }

  return (
    <section className="section-pad" style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px 90px" }}>
      <BackLink onClick={() => navigate(-1)}>Back</BackLink>
      <PageTitle>Plan My Day</PageTitle>
      <p style={{ margin: "6px 0 24px", fontSize: 15, color: colors.mutedLight, maxWidth: 640, lineHeight: 1.5 }}>
        Tell us your day and we'll line up real things you could do, in an order that works. You book or join each one yourself.
      </p>
      <div className="ce-layout">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div className="ce-fields">
            <div>
              <FieldLabel htmlFor="pmd-date" required>
                Day
              </FieldLabel>
              <input id="pmd-date" type="date" min={irelandToday()} max={addDays(irelandToday(), 30)} value={date} onChange={(e) => setDate(e.target.value)} required style={inputStyle} />
            </div>
            <div>
              <FieldLabel htmlFor="pmd-county" optional>
                County
              </FieldLabel>
              <select id="pmd-county" value={county} onChange={(e) => setCounty(e.target.value)} style={inputStyle}>
                <option value="">Anywhere</option>
                {COUNTIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel htmlFor="pmd-start" required>
                From
              </FieldLabel>
              <input id="pmd-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <FieldLabel htmlFor="pmd-end" required>
                Until
              </FieldLabel>
              <input id="pmd-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <FieldLabel htmlFor="pmd-budget" optional>
                Budget for the day
              </FieldLabel>
              <select id="pmd-budget" value={budget} onChange={(e) => setBudget(e.target.value)} style={inputStyle}>
                {BUDGETS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel htmlFor="pmd-mood" optional>
                In the mood for
              </FieldLabel>
              <select id="pmd-mood" value={mood} onChange={(e) => setMood(e.target.value)} style={inputStyle}>
                {MOODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="ce-full">
              <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: colors.muted, marginBottom: 6 }}>
                Start point <span style={{ fontWeight: 400, color: colors.mutedLight }}>(optional)</span>
              </span>
              {origin ? (
                <span style={{ fontSize: 14 }}>
                  Using your current location ·{" "}
                  <button type="button" className="ce-link" onClick={() => setOrigin(null)}>
                    Don't use it
                  </button>
                </span>
              ) : (
                <Button variant="ghost" onClick={locate} disabled={locating}>
                  {locating ? "Finding you…" : "Use my location"}
                </Button>
              )}
              <p className="ce-field-help">Used once to estimate getting to your first stop. Not stored.</p>
            </div>
          </div>
          {error && (
            <p role="alert" style={{ color: colors.danger, fontSize: 13.5, margin: "14px 0 0" }}>
              {error}
            </p>
          )}
          <div className="ce-form-actions" style={{ marginTop: 18 }}>
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? "Planning…" : "Plan my day"}
            </Button>
          </div>
        </form>

        <aside className="ce-aside" aria-label="Your day" aria-live="polite">
          {busy && !plan ? (
            <Skeleton height={260} />
          ) : !plan ? (
            <div className="ce-guide" style={{ marginTop: 0 }}>
              <p style={{ margin: 0, fontSize: 14 }}>Your day appears here.</p>
            </div>
          ) : stops.length === 0 ? (
            <EmptyState
              icon={<CalendarIcon size={20} />}
              title="Nothing fits that day yet"
              subtitle="Try a longer window, a higher budget, another county, or another day."
            />
          ) : (
            <div className="ce-guide" style={{ marginTop: 0 }}>
              <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20, margin: "0 0 4px" }}>{dateLabel(plan.date)}</h2>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: colors.mutedLight }}>
                {stops.length} {stops.length === 1 ? "stop" : "stops"} · {stops.reduce((n, s) => n + (s.priceCents ?? 0), 0) ? euro(stops.reduce((n, s) => n + (s.priceCents ?? 0), 0) / 100) : "Free"} per person
              </p>
              <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {stops.map((s, i) => (
                  <li key={`${s.kind}-${s.id}`} style={{ borderTop: i ? `1px solid ${colors.border}` : 0, padding: "12px 0" }}>
                    {s.travelMinutes != null && <p style={{ margin: "0 0 6px", fontSize: 12, color: colors.mutedLight }}>Allow about {s.travelMinutes} min to get here (rough estimate)</p>}
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: colors.mutedLight }}>
                      {s.start}–{s.end}
                    </div>
                    <Link to={s.href} style={{ fontWeight: 700, fontSize: 15.5, color: colors.text }}>
                      {s.title}
                    </Link>
                    <div className="ce-row-meta">
                      {s.place && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <PinIcon size={12} /> {s.place}
                        </span>
                      )}
                      <span>{s.priceCents ? euro(s.priceCents / 100) : "Free"}</span>
                      {s.spotsLeft != null && <span>{s.spotsLeft} places left now</span>}
                    </div>
                    <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                      <Link to={s.href} className="ce-link">
                        View and book
                      </Link>
                      <button type="button" className="ce-link" onClick={() => setStops((list) => list.filter((x) => x !== s))}>
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
              <p style={{ margin: "8px 0 12px", fontSize: 12, color: colors.mutedLight, lineHeight: 1.5 }}>
                {plan.assumptions.travel} Nothing is reserved: places and prices are confirmed only when you book each one.
                {plan.assumptions.skippedUnknownLength > 0 && ` ${plan.assumptions.skippedUnknownLength} listing${plan.assumptions.skippedUnknownLength === 1 ? " was" : "s were"} left out because ${plan.assumptions.skippedUnknownLength === 1 ? "it doesn't" : "they don't"} say how long they take.`}
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button onClick={save}>{resident ? "Save this plan" : "Sign in to save"}</Button>
                <Button variant="ghost" onClick={() => run(true)} disabled={busy}>
                  Try a different plan
                </Button>
              </div>
              {saveState && (
                <p role="status" style={{ margin: "8px 0 0", fontSize: 13 }}>
                  {saveState}
                </p>
              )}
            </div>
          )}
        </aside>
      </div>

      {resident && (
        <section className="ce-section" style={{ marginTop: 32 }} aria-labelledby="pmd-saved">
          <div className="ce-section-head">
            <div>
              <h2 id="pmd-saved">My plans</h2>
              <p>Each stop is checked again every time you look.</p>
            </div>
          </div>
          {savedFailed ? (
            <LoadErrorState title="We couldn't load your saved plans." onRetry={loadSaved} />
          ) : !saved ? (
            <PageSpinner />
          ) : saved.length === 0 ? (
            <p style={{ fontSize: 14, color: colors.mutedLight }}>No saved plans yet.</p>
          ) : (
            <SavedPlans
              plans={saved}
              onDelete={async (p) => {
                if (!(await confirm({ title: "Delete this plan?", message: "Only the plan is deleted — nothing you've booked is affected.", confirmLabel: "Delete", tone: "danger" }))) return;
                await deleteDayPlan(p.id).catch(() => undefined);
                loadSaved();
              }}
            />
          )}
        </section>
      )}
    </section>
  );
}

export function SavedPlans({ plans, onDelete }: { plans: SavedDayPlan[]; onDelete?: (p: SavedDayPlan) => void }) {
  return (
    <ul className="ce-rows" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {plans.map((p) => (
        <li key={p.id} className="ce-row" style={{ alignItems: "flex-start" }}>
          <div className="ce-row-main">
            <p className="ce-row-title">{p.title}</p>
            <ol style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13.5 }}>
              {p.items.map((i) => (
                <li key={`${i.kind}-${i.id}`} style={{ marginBottom: 4 }}>
                  {i.time} · <Link to={i.href}>{i.title}</Link>{" "}
                  <span className={`ce-pill ${i.current === "listed" ? "ce-pill--green" : i.current === "past" ? "ce-pill--muted" : "ce-pill--orange"}`}>
                    {CURRENT[i.current]}
                    {i.current === "changed" && i.currentTime ? ` to ${i.currentTime}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          {onDelete && (
            <div className="ce-row-actions">
              <button type="button" className="ce-link" onClick={() => onDelete(p)}>
                Delete
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
