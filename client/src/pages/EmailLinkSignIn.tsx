import { Link, useSearchParams } from "react-router-dom";
import { readAuthIntentContext } from "../authRedirect";
import { AuthEditorialHeader, AuthEditorialShell } from "../components/AuthEditorialShell";
import { EmailLinkForm } from "../components/AuthForms";
import { AuthContextCard } from "../components/AuthShell";
import { colors } from "../theme";

// Dedicated passwordless sign-in screen — sibling of SignIn.tsx (/signin)
// and SignUp.tsx (/signin/create), same AuthEditorialShell/green accent as
// both (Form System Audit follow-up). Deliberately minimal per the auth
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
    <AuthEditorialShell
      heroImage={{
        src: "https://images.unsplash.com/photo-1543269865-cbf427effbad?w=1920&q=75&auto=format&fit=crop",
        alt: "Friends meeting up over coffee",
      }}
      caption={{
        heading: <>No password.<br />No hassle.<br />Just a link.</>,
        avatarCaption: "Join thousands of people finding their thing, together.",
        avatarSeedPrefix: "hc-link-avatar",
      }}
    >
      {intentContext && <AuthContextCard context={intentContext} />}
      <AuthEditorialHeader
        eyebrow="Sign in"
        accent="green"
        headline={<>No password.<br /><span style={{ color: colors.green }}>Just a link.</span></>}
        subtitle="We'll email you a secure sign-in link — nothing to remember."
      />
      <EmailLinkForm />

      <p style={{ margin: "24px 0 0", fontSize: 14 }}>
        Prefer using a password?{" "}
        <Link to={`/signin${siblingSearch}`} style={{ color: colors.text, fontWeight: 700, textDecoration: "none" }}>Log in →</Link>
      </p>
      <p style={{ margin: "10px 0 0", fontSize: 14 }}>
        New to HelloCircle?{" "}
        <Link to={`/signin/create${siblingSearch}`} style={{ color: colors.green, fontWeight: 700, textDecoration: "none" }}>Create account →</Link>
      </p>
    </AuthEditorialShell>
  );
}
