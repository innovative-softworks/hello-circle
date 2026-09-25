import { useEffect, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnalyticsEvent, trackTypedEvent } from "../analyticsEvents";
import { readAuthIntentContext, safeReturnTo } from "../authRedirect";
import { AuthEditorialHeader, AuthEditorialShell } from "../components/AuthEditorialShell";
import { SignupForm } from "../components/AuthForms";
import { AuthContextCard } from "../components/AuthShell";
import { useGuest } from "../GuestContext";
import { colors } from "../theme";

// Dedicated resident CREATE ACCOUNT screen — sibling of SignIn.tsx
// (/signin) and EmailLinkSignIn.tsx (/signin/email-link), now sharing the
// same AuthEditorialShell as both (Form System Audit follow-up). Same
// green accent and hero photo as SignIn.tsx — one resident identity, not
// three different-looking screens.

export function SignUp() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { resident, loading, refresh } = useGuest();
  const destination = safeReturnTo(searchParams.get("returnTo"));
  const intentContext = readAuthIntentContext(searchParams);
  const ownSuccessRef = useRef(false);

  useEffect(() => {
    if (!loading && resident && !ownSuccessRef.current) navigate(destination, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, resident]);

  useEffect(() => {
    trackTypedEvent(AnalyticsEvent.ResidentSignupStarted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSuccess = async () => {
    ownSuccessRef.current = true;
    await refresh();
    navigate(destination); // onboarding, if due, opens as a popup over it (AccountSetupGate)
  };

  const siblingSearch = window.location.search;

  return (
    <AuthEditorialShell
      heroImage={{
        src: "https://images.unsplash.com/photo-1543269865-cbf427effbad?w=1920&q=75&auto=format&fit=crop",
        alt: "Friends meeting up over coffee",
      }}
      caption={{
        heading: <>Be active.<br />Meet people.<br />Do more together.</>,
        avatarCaption: "Your next thing to do is around the corner.",
        avatarSeedPrefix: "hc-signup-avatar",
      }}
    >
      {intentContext && <AuthContextCard context={intentContext} />}
      <AuthEditorialHeader
        eyebrow="Create account"
        accent="green"
        headline={<>Be active. Meet people.<br /><span style={{ color: colors.green }}>Do more together.</span></>}
        subtitle={intentContext ? "Create an account to continue." : "Find things to do, join local Circles and meet people around you."}
      />
      <SignupForm onSuccess={handleSuccess} />

      <p style={{ margin: "20px 0 0", fontSize: 14 }}>
        Already have an account?{" "}
        <Link to={`/signin${siblingSearch}`} style={{ color: colors.green, fontWeight: 700, textDecoration: "none" }}>Log in</Link>
      </p>
    </AuthEditorialShell>
  );
}
