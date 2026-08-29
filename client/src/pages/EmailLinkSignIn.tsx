import { Link, useSearchParams } from "react-router-dom";
import { readAuthIntentContext } from "../authRedirect";
import { EmailLinkForm } from "../components/AuthForms";
import { AuthContextCard, AuthPhotoPanel, AuthShell } from "../components/AuthShell";
import { colors } from "../theme";

// Dedicated passwordless sign-in screen — sibling of SignIn.tsx (/signin)
// and SignUp.tsx (/signin/create). Deliberately minimal per the auth
// redesign brief: no OAuth, no password field, nothing that competes with
// "enter email → receive link." Magic-link verification already IS this
// app's account confirmation step (there's no separate email-verification
// concept in the backend), so there's no extra "verify" screen after this
// one — clicking the emailed link signs the resident in directly.

export function EmailLinkSignIn() {
  const [searchParams] = useSearchParams();
  const siblingSearch = `?${searchParams.toString()}`;
  const intentContext = readAuthIntentContext(searchParams);

  return (
    <AuthShell
      photo={
        <AuthPhotoPanel
          imageSeed="hellocircle-signin-emaillink"
          heading={<>No password.<br />No hassle.<br />Just a link.</>}
          avatarCaption="Join thousands of people finding their thing, together."
          avatarSeedPrefix="hc-link-avatar"
        />
      }
    >
      {intentContext && <AuthContextCard context={intentContext} />}
      <h1 style={{ fontWeight: 800, fontSize: "clamp(26px,3vw,32px)", margin: "0 0 28px", letterSpacing: "-.02em" }}>
        Sign in without a password
      </h1>
      <EmailLinkForm />

      <p style={{ margin: "24px 0 0", fontSize: 14 }}>
        Prefer using a password?{" "}
        <Link to={`/signin${siblingSearch}`} style={{ color: colors.text, fontWeight: 700, textDecoration: "none" }}>Log in →</Link>
      </p>
      <p style={{ margin: "10px 0 0", fontSize: 14 }}>
        New to HelloCircle?{" "}
        <Link to={`/signin/create${siblingSearch}`} style={{ color: colors.green, fontWeight: 700, textDecoration: "none" }}>Create account →</Link>
      </p>
    </AuthShell>
  );
}
