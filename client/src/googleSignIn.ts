import { getRedirectResult, signInWithPopup, signInWithRedirect, type UserCredential } from "firebase/auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { firebaseReady, getFirebaseAuth, googleProvider } from "./firebase";

/** The user closed the popup or dismissed the account chooser — not a real
 * error, never shown as one (task: "handle user cancellation without a
 * frightening error"). */
export class GoogleSignInCancelled extends Error {}

/** VITE_FIREBASE_* env vars aren't set — see firebase.ts. */
export class GoogleSignInUnavailable extends Error {}

/** Tries a popup first — keeps the SPA mounted, no full navigation, best
 * desktop UX — and falls back to a full-page redirect only when the popup
 * itself couldn't open (Safari private mode and some in-app/webview
 * browsers block window.open outright). This popup-first-with-redirect-
 * fallback shape is Firebase's own documented recommendation for a web SPA.
 * completeGoogleRedirect() below picks the flow back up after the redirect
 * returns. */
export async function signInWithGoogle(): Promise<UserCredential> {
  const auth = getFirebaseAuth();
  if (!firebaseReady || !auth) throw new GoogleSignInUnavailable();
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (e) {
    const code = (e as { code?: string } | undefined)?.code;
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
      throw new GoogleSignInCancelled();
    }
    if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, googleProvider);
      // The page is navigating away — this promise deliberately never
      // resolves; whatever called signInWithGoogle() won't run its
      // .then()/finally after this point on this page load.
      return new Promise<UserCredential>(() => {});
    }
    throw e;
  }
}

/** Picks up a signInWithRedirect flow after the browser lands back on the
 * app at the same URL it left from. Resolves null (not an error) on every
 * normal page load that isn't a redirect return. */
export function completeGoogleRedirect(): Promise<UserCredential | null> {
  const auth = getFirebaseAuth();
  if (!firebaseReady || !auth) return Promise.resolve(null);
  return getRedirectResult(auth);
}

/** The bits of a Google identity a form might want to pre-fill with —
 * display-only, never trusted as proof of anything by itself; the server
 * always re-derives the real identity from the ID token. */
export interface GoogleProfile {
  email: string;
  name: string | null;
  photoURL: string | null;
}

/** Shared Google sign-in flow for every auth surface (resident LoginForm/
 * SignupForm, vendor Login.tsx/VendorSignup.tsx) — owns busy/error state,
 * popup-vs-redirect, and cancellation handling so each screen only needs to
 * supply what to do with the resulting Firebase ID token (and, for a form
 * that pre-fills fields from it, the profile alongside it). `onIdentity` is
 * expected to throw a message-bearing Error (e.g. ApiError) on a
 * server-side rejection, which this surfaces as `error` the same way a
 * failed password submit does. */
export function useGoogleSignIn(onIdentity: (idToken: string, profile: GoogleProfile) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onIdentityRef = useRef(onIdentity);
  onIdentityRef.current = onIdentity;
  const checkedRedirect = useRef(false);

  const handleCredential = useCallback(async (cred: UserCredential) => {
    setBusy(true);
    setError(null);
    try {
      const idToken = await cred.user.getIdToken();
      await onIdentityRef.current(idToken, { email: cred.user.email ?? "", name: cred.user.displayName, photoURL: cred.user.photoURL });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't sign in with Google");
    } finally {
      setBusy(false);
    }
  }, []);

  // Completes the redirect fallback above, if this page load is one.
  useEffect(() => {
    if (checkedRedirect.current) return;
    checkedRedirect.current = true;
    completeGoogleRedirect()
      .then((cred) => {
        if (cred) return handleCredential(cred);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't complete Google sign-in"));
  }, [handleCredential]);

  const trigger = useCallback(async () => {
    setError(null);
    try {
      const cred = await signInWithGoogle();
      await handleCredential(cred);
    } catch (e) {
      if (e instanceof GoogleSignInCancelled) return;
      if (e instanceof GoogleSignInUnavailable) {
        setError("Google sign-in isn't available right now — please use email instead.");
        return;
      }
      setError(e instanceof Error ? e.message : "Couldn't sign in with Google");
    }
  }, [handleCredential]);

  return { busy, error, trigger };
}
