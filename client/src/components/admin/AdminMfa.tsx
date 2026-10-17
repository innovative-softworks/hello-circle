import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { confirmAdminMfaEnrolment, setMfaReauthHandler, startAdminMfaEnrolment, verifyAdminMfa } from "../../api";
import { Modal } from "../ui";
import { AdminButton, IconTile, errorMessage } from "./adminUi";

// OG-07 — admin two-step sign-in screens.
// AdminMfaGate: shown in place of the admin workspace until this session has
//   entered a code (or, the first time, set up an authenticator app).
// AdminMfaReauthHost: the "enter a fresh code" prompt a sensitive change asks
//   for (api/core.ts calls it, then retries the change once).

function CodeInput({ value, onChange, id, recovery }: { value: string; onChange: (v: string) => void; id: string; recovery?: boolean }) {
  return (
    <input
      id={id}
      className="adm-input"
      value={value}
      onChange={(e) => onChange(recovery ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, "").slice(0, 6))}
      inputMode={recovery ? "text" : "numeric"}
      autoComplete="one-time-code"
      autoFocus
      placeholder={recovery ? "XXXXX-XXXXX" : "123456"}
      style={{ fontSize: 22, letterSpacing: recovery ? 2 : 8, textAlign: "center", width: "100%", maxWidth: 260 }}
    />
  );
}

export function AdminMfaGate({ enrolled, email, onDone }: { enrolled: boolean; email: string; onDone: () => void }) {
  const [setup, setSetup] = useState<{ uri: string; secret: string; qr: string | null } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (enrolled) return;
    startAdminMfaEnrolment()
      .then(async ({ otpauthUri, secret }) => {
        setSetup({ uri: otpauthUri, secret, qr: null });
        const QRCode = await import("qrcode");
        const qr = await QRCode.toDataURL(otpauthUri, { width: 200, margin: 1 });
        setSetup({ uri: otpauthUri, secret, qr });
      })
      .catch((e) => setError(errorMessage(e, "Couldn't start the set-up. Refresh the page to try again.")));
  }, [enrolled]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!enrolled) {
        const r = await confirmAdminMfaEnrolment(code);
        setRecoveryCodes(r.recoveryCodes);
      } else {
        await verifyAdminMfa(useRecovery ? { recoveryCode: code } : { code });
        onDone();
      }
    } catch (e) {
      setError(errorMessage(e, "That didn't work. Try again."));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    const blob = new Blob([`HelloCircle admin recovery codes for ${email}\nEach code works once.\n\n${recoveryCodes!.join("\n")}\n`], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hellocircle-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="adm" style={{ minHeight: "70vh", display: "grid", placeItems: "center", padding: "40px 16px" }}>
      <div className="adm-box" style={{ maxWidth: 480, width: "100%", padding: 28, display: "flex", flexDirection: "column", gap: 14 }}>
        <IconTile icon={ShieldCheck} />
        {recoveryCodes ? (
          <>
            <h1 style={{ fontFamily: "var(--adm-display)", fontSize: 22, margin: 0 }}>Save your recovery codes</h1>
            <p style={{ margin: 0, color: "var(--adm-muted)" }}>If you lose your phone, each of these lets you sign in once. They won't be shown again.</p>
            <ol style={{ margin: 0, paddingLeft: 22, columns: 2, fontFamily: "ui-monospace, monospace", fontSize: 15 }} aria-label="Recovery codes">
              {recoveryCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ol>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <AdminButton onClick={download}>Download</AdminButton>
              <AdminButton onClick={() => navigator.clipboard?.writeText(recoveryCodes.join("\n"))}>Copy</AdminButton>
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I've saved them somewhere safe
            </label>
            <AdminButton variant="primary" disabled={!saved} onClick={onDone}>
              Continue to the admin workspace
            </AdminButton>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            style={{ display: "flex", flexDirection: "column", gap: 14 }}
          >
            <h1 style={{ fontFamily: "var(--adm-display)", fontSize: 22, margin: 0 }}>{enrolled ? "Two-step sign-in" : "Set up two-step sign-in"}</h1>
            {enrolled ? (
              <p style={{ margin: 0, color: "var(--adm-muted)" }}>
                {useRecovery ? "Enter one of your recovery codes. Each works once." : "Enter the 6-digit code from your authenticator app."}
              </p>
            ) : (
              <>
                <p style={{ margin: 0, color: "var(--adm-muted)" }}>
                  HelloCircle admin accounts need a code from an authenticator app (such as Google Authenticator, Microsoft Authenticator or 1Password) as well as a password. Scan this, then enter the code it shows.
                </p>
                {setup ? (
                  <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                    {setup.qr ? <img src={setup.qr} width={160} height={160} alt="QR code for your authenticator app" /> : <span className="adm-note">Making the QR code…</span>}
                    <div style={{ fontSize: 13 }}>
                      Can't scan? Enter this key:
                      <div className="adm-mono" style={{ wordBreak: "break-all", marginTop: 4, userSelect: "all" }}>
                        {setup.secret}
                      </div>
                    </div>
                  </div>
                ) : (
                  !error && <span className="adm-note">Preparing…</span>
                )}
              </>
            )}
            <label htmlFor="adm-mfa-code" style={{ fontWeight: 700 }}>
              {useRecovery ? "Recovery code" : "Code"}
            </label>
            <CodeInput id="adm-mfa-code" value={code} onChange={setCode} recovery={useRecovery} />
            {error && (
              <p role="alert" className="adm-field-error" style={{ margin: 0 }}>
                {error}
              </p>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <AdminButton type="submit" variant="primary" disabled={busy || (useRecovery ? code.replace(/[^A-Z0-9]/g, "").length < 10 : code.length !== 6)}>
                {busy ? "Checking…" : enrolled ? "Continue" : "Turn on two-step sign-in"}
              </AdminButton>
              {enrolled && (
                <button
                  type="button"
                  className="adm-linkish"
                  onClick={() => {
                    setUseRecovery(!useRecovery);
                    setCode("");
                    setError(null);
                  }}
                >
                  {useRecovery ? "Use the app instead" : "Use a recovery code"}
                </button>
              )}
            </div>
            {enrolled && <p className="adm-note" style={{ margin: 0 }}>Lost your phone and your recovery codes? Ask another super admin to reset your two-step sign-in.</p>}
          </form>
        )}
      </div>
    </div>
  );
}

/** Mount once inside the admin workspace: answers `mfaReauth` refusals. */
export function AdminMfaReauthHost() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    setMfaReauthHandler(
      () =>
        new Promise<boolean>((resolve) => {
          resolver.current = resolve;
          setCode("");
          setError(null);
          setOpen(true);
        })
    );
    return () => setMfaReauthHandler(null);
  }, []);

  const finish = (ok: boolean) => {
    setOpen(false);
    resolver.current?.(ok);
    resolver.current = null;
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await verifyAdminMfa({ code });
      finish(true);
    } catch (e) {
      setError(errorMessage(e, "That code didn't work."));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => finish(false)}
      title="Confirm it's you"
      subtitle="This change needs a fresh code from your authenticator app."
      footer={
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <AdminButton variant="quiet" onClick={() => finish(false)}>
            Cancel
          </AdminButton>
          <AdminButton variant="primary" onClick={submit} disabled={busy || code.length !== 6}>
            {busy ? "Checking…" : "Confirm"}
          </AdminButton>
        </div>
      }
    >
      <div className="adm-dlg" style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
        <label htmlFor="adm-reauth-code" style={{ fontWeight: 700 }}>
          Code
        </label>
        <CodeInput id="adm-reauth-code" value={code} onChange={setCode} />
        {error && (
          <p role="alert" className="adm-field-error" style={{ margin: 0 }}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
