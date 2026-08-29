import { useEffect, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { fetchResidentFull } from "../api";
import { readAuthIntentContext, safeReturnTo } from "../authRedirect";
import { SignupForm } from "../components/AuthForms";
import { AuthContextCard, AuthPhotoPanel, AuthShell } from "../components/AuthShell";
import { useGuest } from "../GuestContext";
import { colors } from "../theme";

// Dedicated resident CREATE ACCOUNT screen — sibling of SignIn.tsx
// (/signin) and EmailLinkSignIn.tsx (/signin/email-link). Same shell,
// different headline/photo per screen so the trio feels like one journey
// without looking identical. See SignIn.tsx for the fuller rationale.

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

  const handleSuccess = async () => {
    ownSuccessRef.current = true;
    await refresh();
    const full = await fetchResidentFull().catch(() => null);
    navigate(full?.resident && !full.resident.onboardingCompleted ? "/onboarding" : destination);
  };

  const siblingSearch = window.location.search;

  return (
    <AuthShell
      photo={
        <AuthPhotoPanel
          imageSeed="hellocircle-signin-signup"
          heading={<>Be active.<br />Meet people.<br />Do more together.</>}
          avatarCaption="Your next thing to do is around the corner."
          avatarSeedPrefix="hc-signup-avatar"
        />
      }
    >
      {intentContext && <AuthContextCard context={intentContext} />}
      <h1 style={{ fontWeight: 800, fontSize: "clamp(26px,3vw,32px)", margin: "0 0 8px", letterSpacing: "-.02em" }}>
        Create your account
      </h1>
      <p style={{ color: colors.mutedLight, fontSize: 15, margin: "0 0 28px" }}>
        {intentContext ? "Create an account to continue." : "Find things to do, join local Circles and meet people around you."}
      </p>
      <SignupForm onSuccess={handleSuccess} />

      <p style={{ margin: "20px 0 0", fontSize: 14 }}>
        Already have an account?{" "}
        <Link to={`/signin${siblingSearch}`} style={{ color: colors.green, fontWeight: 700, textDecoration: "none" }}>Log in</Link>
      </p>
    </AuthShell>
  );
}
