import { Link } from "react-router-dom";
import { signInHref } from "../authRedirect";
import { PassportView } from "../components/MyLifeEngage";
import { PageSpinner } from "../components/ui";
import { useExperienceFeatures } from "../circleFeatures";
import { useGuest } from "../GuestContext";
import { usePageTitle } from "../pageTitle";
import "./myLife.css";

// Experience 3.0 — Activity Passport (experience.activity_passport). A
// private record of things you actually took part in: an organiser's
// check-in or register, your own "I went" on an activity, and Circles you
// joined. Private only (owner decision D3): no share button, no counts
// compared with anyone, no streaks. Milestones are real first dates.
// Redesigned 2026-10-26 in the My Life style; the same PassportView is the
// My Life Passport tab.

export function ActivityPassport() {
  usePageTitle("Activity Passport");
  const { resident, loading: guestLoading } = useGuest();
  const on = useExperienceFeatures()["experience.activity_passport"];

  if (guestLoading) return <PageSpinner />;
  return (
    <div className="mlx" style={{ paddingBottom: 90 }}>
      <header className="mlx-head">
        <div style={{ minWidth: 0 }}>
          <p className="mlx-label"><Link to="/bookings" className="mlx-crumb">My Life</Link> · Passport</p>
          <h1 className="mlx-title">Activity Passport</h1>
          <p className="mlx-summary">Things you've actually done. Only you can see this page.</p>
        </div>
      </header>
      {!resident ? (
        <div className="mlx-nothing">
          <h2 className="mlx-nothing-title">Sign in to see your Passport.</h2>
          <div><Link className="mlx-btn" to={signInHref()}>Sign in</Link></div>
        </div>
      ) : !on ? (
        <div className="mlx-nothing">
          <h2 className="mlx-nothing-title">The Activity Passport isn't switched on yet.</h2>
          <div><Link className="mlx-btn" to="/bookings">Back to My Life</Link></div>
        </div>
      ) : (
        <PassportView showTitle={false} />
      )}
    </div>
  );
}
