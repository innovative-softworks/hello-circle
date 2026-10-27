import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { changeResidentPassword, linkGoogleAccount, resendVerificationEmail } from "../../api";
import { GoogleIcon } from "../../components/icons";
import { useToast } from "../../components/Toast";
import { Button, LoadErrorState, RowSkeleton, inputStyle } from "../../components/ui";
import { useGuest } from "../../GuestContext";
import { useGoogleSignIn } from "../../googleSignIn";
import { AccountPage, AccountSection, FormModal, Note, SettingRow, SettingRows, StatusTag, TextButton } from "./accountUi";
import { useResidentFull } from "./useResidentFull";
import { DataSections } from "./DataPage";

function PasswordInput({ id, value, onChange, autoComplete, invalid, describedBy, autoFocus }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; invalid?: boolean; describedBy?: string; autoFocus?: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        id={id}
        type={shown ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        autoFocus={autoFocus}
        style={{ ...inputStyle, paddingRight: 48 }}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        style={{ position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)", width: 44, height: 44, background: "none", border: "none", cursor: "pointer", color: "var(--color-muted)", display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        {shown ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
      </button>
    </div>
  );
}

function PasswordSection({ hasPassword, onChanged }: { hasPassword: boolean; onChanged: () => void }) {
  const toast = useToast();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setCurrent("");
    setNext("");
    setError(null);
    setOpen(true);
  };
  const save = async () => {
    if (hasPassword && !current) return setError("Enter your current password."), false;
    if (next.length < 8) return setError("Your new password needs at least 8 characters."), false;
    setError(null);
    try {
      await changeResidentPassword({ currentPassword: hasPassword ? current : undefined, newPassword: next });
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "Your password wasn't changed. Try again.");
    }
    onChanged();
    toast.success(hasPassword ? "Password changed" : "Password set");
  };

  return (
    <AccountSection title="Password" description={hasPassword ? "You can sign in with your password or an email link. Both always work." : "You sign in with an email link. Add a password if you'd rather not wait for an email."}>
      <SettingRows>
        <SettingRow
          label="Password"
          description={hasPassword ? "Set" : "Not set"}
          control={<Button variant="ghost" onClick={start}>{hasPassword ? "Change password" : "Set a password"}</Button>}
        />
      </SettingRows>
      <FormModal
        open={open}
        title={hasPassword ? "Change your password" : "Set a password"}
        submitLabel={hasPassword ? "Change password" : "Set password"}
        dirty={current !== "" || next !== ""}
        error={error}
        onClose={() => setOpen(false)}
        onSubmit={save}
      >
        {hasPassword && (
          <div>
            <label htmlFor={`${id}-cur`} className="acct-row-label" style={{ display: "block", marginBottom: 6 }}>Current password</label>
            <PasswordInput id={`${id}-cur`} value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
          </div>
        )}
        <div>
          <label htmlFor={`${id}-new`} className="acct-row-label" style={{ display: "block", marginBottom: 6 }}>{hasPassword ? "New password" : "Password"}</label>
          <PasswordInput id={`${id}-new`} value={next} onChange={setNext} autoComplete="new-password" invalid={!!error} describedBy={`${id}-hint`} autoFocus={!hasPassword} />
          <div id={`${id}-hint`} className="acct-row-desc" style={{ marginTop: 6 }}>At least 8 characters.</div>
        </div>
      </FormModal>
    </AccountSection>
  );
}

export function SecurityPage() {
  const { resident } = useGuest();
  const toast = useToast();
  const { data, loading, failed, reload, patch } = useResidentFull();
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [googleLinked, setGoogleLinked] = useState(false);
  // Linking a Google identity only ever happens here, from a signed-in
  // session — never inferred from a matching email at sign-in.
  const { busy: linking, error: linkError, trigger: linkGoogle } = useGoogleSignIn(async (idToken) => {
    await linkGoogleAccount(idToken);
    setGoogleLinked(true);
    toast.success("Google account linked");
  });

  const resend = async () => {
    setResendError(null);
    setResending(true);
    try {
      const { alreadyVerified } = await resendVerificationEmail();
      if (alreadyVerified) patch({ emailVerified: true });
      else setResent(true);
    } catch (e) {
      setResendError(e instanceof Error ? e.message : "That didn't send. Try again in a few minutes.");
    } finally {
      setResending(false);
    }
  };

  return (
    <AccountPage eyebrow="Account" title="Sign-in & data" lede="How you get into your account, and what we hold about you." narrow>
      {loading ? (
        <RowSkeleton />
      ) : failed || !data ? (
        <LoadErrorState title="We couldn't load your sign-in settings." onRetry={reload} />
      ) : (
        <>
          <AccountSection title="Email">
            <SettingRows>
              <SettingRow
                stack
                label={resident?.email}
                description={data.emailVerified ? "Confirmed. This is where sign-in links and booking emails go." : resent ? "Check your inbox for a confirmation link." : "Confirm your email so booking emails and sign-in links reach you."}
                control={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <StatusTag tone={data.emailVerified ? "ok" : "warn"}>{data.emailVerified ? "Verified" : "Not verified"}</StatusTag>
                    {!data.emailVerified && !resent && (
                      <TextButton onClick={resend} disabled={resending}>{resending ? "Sending…" : "Resend confirmation"}</TextButton>
                    )}
                  </span>
                }
              />
            </SettingRows>
            {resendError && <p className="acct-field-error" role="alert">{resendError}</p>}
            <p className="acct-row-desc" style={{ marginTop: 12 }}>Your email can’t be changed here.</p>
          </AccountSection>

          <PasswordSection hasPassword={data.hasPassword} onChanged={() => patch({ hasPassword: true })} />

          <AccountSection title="Google" description="Link Google to sign in with one tap instead of a password or email link.">
            <SettingRows>
              <SettingRow
                label="Google account"
                description={googleLinked ? "Linked. You can now sign in with Google." : "Use the Google account with the same email, or another one you own."}
                control={
                  <Button variant="ghost" onClick={linkGoogle} disabled={linking || googleLinked} aria-busy={linking}>
                    <GoogleIcon size={15} /> {googleLinked ? "Linked" : linking ? "Linking…" : "Link Google"}
                  </Button>
                }
              />
            </SettingRows>
            {linkError && <p className="acct-field-error" role="alert">{linkError}</p>}
          </AccountSection>

          <DataSections />

          <AccountSection>
            <Note>We'll never ask for your password by email or message. If something about your account looks wrong, change your password and contact support@hellocircle.ie.</Note>
          </AccountSection>
        </>
      )}
    </AccountPage>
  );
}
