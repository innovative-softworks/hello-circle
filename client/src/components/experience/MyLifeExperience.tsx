import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPassport, fetchSavedPlans, type Passport, type SavedDayPlan } from "../../api";
import { useExperienceFeatures } from "../../circleFeatures";
import { dateLabel } from "../../euro";
import { irelandToday } from "../../irelandDate";
import { colors } from "../../theme";
import { SavedPlans } from "../../pages/PlanMyDay";
import "../circle/circleExperience.css";

// Experience 3.0 — two My Life sections: "My plans" (saved Plan My Day
// plans for today onwards, re-checked) and the Activity Passport teaser.
// Each appears only while its switch is on; nothing is padded.

// My Life's minimal section head (pages/myLife.css): small label + link.
function Head({ eyebrow, to, link }: { eyebrow: string; title: string; to: string; link: string }) {
  return (
    <div className="mlx-section-head">
      <h2 className="mlx-label">{eyebrow}</h2>
      <Link to={to} className="mlx-link">
        {link}
      </Link>
    </div>
  );
}

export function MyLifePlans() {
  const on = useExperienceFeatures()["experience.plan_my_day"];
  const [plans, setPlans] = useState<SavedDayPlan[] | null>(null);
  useEffect(() => {
    if (!on) return;
    fetchSavedPlans()
      .then((rows) => setPlans(rows.filter((p) => p.date >= irelandToday())))
      .catch(() => setPlans([]));
  }, [on]);
  // Hidden while empty (owner 2026-10-25); "Plan a day" is in My Life's "More for you".
  if (!on || !plans || plans.length === 0) return null;
  return (
    <section className="mlx-section">
      <Head eyebrow="Your day plans" title="My plans" to="/plan-my-day" link="Plan a day" />
      <SavedPlans plans={plans.slice(0, 3)} />
    </section>
  );
}

export function MyLifePassport() {
  const on = useExperienceFeatures()["experience.activity_passport"];
  const [data, setData] = useState<Passport | null>(null);
  useEffect(() => {
    if (!on) return;
    fetchPassport()
      .then(setData)
      .catch(() => setData(null));
  }, [on]);
  if (!on || !data) return null;
  const recent = data.entries.filter((e) => e.kind !== "circle").slice(0, 3);
  // Hidden while empty (owner 2026-10-25); "Your Passport" is in "More for you".
  if (recent.length === 0) return null;
  return (
    <section className="mlx-section">
      <Head eyebrow="Activity Passport" title="Activity Passport" to="/my-life/passport" link="See your Passport" />
      {(
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {recent.map((e, i) => (
            <li key={i} style={{ display: "flex", gap: 14, padding: "8px 0", borderTop: i ? `1px solid ${colors.border}` : 0, fontSize: 14 }}>
              <span style={{ color: colors.mutedLight, minWidth: 92 }}>{dateLabel(e.date)}</span>
              <span style={{ fontWeight: 700 }}>{e.title}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
