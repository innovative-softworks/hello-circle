import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { PushNotifications } from "@capacitor/push-notifications";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

// Native-shell (Capacitor) integration — every export here is a no-op on
// web, so call sites don't need their own Capacitor.isNativePlatform()
// checks.
export const isNative = Capacitor.isNativePlatform();

export function hideSplashScreen() {
  if (!isNative) return;
  SplashScreen.hide().catch(() => {});
}

// Mirrors index.css's --color-bg light/dark values — kept in sync by hand,
// same convention as types.ts mirroring server response shapes (see
// CLAUDE.md), since the native StatusBar API needs a literal hex rather
// than a CSS custom property.
const STATUS_BAR_BG = { light: "#fbfaf7", dark: "#15181a" };

export function syncStatusBar(theme: "light" | "dark") {
  if (!isNative) return;
  // Style.Dark = light text (for a dark background); Style.Light = dark
  // text (for a light background) — named for the status bar's own visual
  // style, not the app's theme, so this mapping looks backwards at a glance.
  StatusBar.setStyle({ style: theme === "dark" ? Style.Dark : Style.Light }).catch(() => {});
  // Unsupported on Android 15+ (edge-to-edge) and when overlaysWebView is
  // true — best-effort only, never blocks the UI.
  StatusBar.setBackgroundColor({ color: STATUS_BAR_BG[theme] }).catch(() => {});
}

/**
 * Wires the Android hardware back button to `goBack` (typically
 * `() => navigate(-1)`); `isAtRoot` reports whether there's nowhere left in
 * the app to go back to, in which case the app exits instead. No-op
 * (including its returned cleanup) on iOS/web. Registration is async
 * (`addListener` returns a Promise), so the listener handle is captured via
 * a mutable box rather than returned directly.
 */
export function setupBackButton(goBack: () => void, isAtRoot: () => boolean): () => void {
  if (!isNative) return () => {};
  const box: { handle?: { remove: () => void } } = {};
  CapacitorApp.addListener("backButton", () => {
    if (isAtRoot()) CapacitorApp.exitApp();
    else goBack();
  }).then((handle) => {
    box.handle = handle;
  });
  return () => box.handle?.remove();
}

/**
 * Universal Links (iOS) / App Links (Android) — fires when the OS hands the
 * app a `CLIENT_URL`-domain link instead of opening it in the browser (a
 * magic-link/password-reset email, a Stripe checkout success/cancel
 * redirect, or any other in-app link opened elsewhere). `go` is typically
 * `(path) => navigate(path)`; only the path/search/hash after the domain is
 * passed through, so it re-enters this same app instance's router rather
 * than a fresh page load. No-op on web (there the same links just load
 * normally in the browser).
 */
export function setupAppUrlListener(go: (path: string) => void): () => void {
  if (!isNative) return () => {};
  const box: { handle?: { remove: () => void } } = {};
  CapacitorApp.addListener("appUrlOpen", (event) => {
    try {
      const url = new URL(event.url);
      go(`${url.pathname}${url.search}${url.hash}`);
    } catch {
      // Malformed/non-URL payload — ignore rather than crash the listener.
    }
  }).then((handle) => {
    box.handle = handle;
  });
  return () => box.handle?.remove();
}

/**
 * Every checkout-session-creating flow (bookings/registrations/games/
 * programs/passes/experiences — see checkoutService.ts) redirects the
 * browser to the returned Stripe-hosted `url` on success. A full-page
 * `window.location.href` redirect away from the app's own domain is what
 * this call replaces on native: opening Stripe in Capacitor's in-app
 * `Browser` instead keeps the user inside the app shell (and avoids the App
 * Store guideline issue with a wrapped app navigating fully away to an
 * external payment domain). `success_url`/`cancel_url` land back on this
 * same domain, so the in-app browser's own "Done" flow plus the
 * `setupAppUrlListener` Universal/App Link handler return control to the
 * app — no extra wiring needed here. Web keeps the exact redirect it had.
 */
export function openCheckout(url: string) {
  if (isNative) Browser.open({ url });
  else window.location.href = url;
}

/** On iOS/Android per Capacitor's own Token type; "web" everywhere else
 * (not sent server-side, but useful for logging). */
export function nativePlatform(): "ios" | "android" | "web" {
  return Capacitor.getPlatform() as "ios" | "android" | "web";
}

/**
 * Requests notification permission (if not already granted/denied) and, on
 * success, registers this device for FCM/APNs and reports the resulting
 * token via `onToken` — the caller (NativePushSync.tsx) is what actually
 * POSTs it to `/api/residents/me/push-token`, since only a signed-in
 * resident's push should ever be persisted server-side. Silently does
 * nothing if the user has denied permission — never re-prompts on every
 * call, since that would be a nagging re-ask on every sign-in. No-op on web.
 */
export async function registerForPush(onToken: (token: string) => void): Promise<void> {
  if (!isNative) return;
  try {
    let status = await PushNotifications.checkPermissions();
    // Covers both "prompt" and "prompt-with-rationale" — anything not
    // already decided. Skips re-prompting once the user has denied it.
    if (status.receive !== "granted" && status.receive !== "denied") {
      status = await PushNotifications.requestPermissions();
    }
    if (status.receive !== "granted") return;
    await PushNotifications.addListener("registration", (token) => onToken(token.value));
    await PushNotifications.addListener("registrationError", (err) => {
      console.error("[push] registration failed:", err.error);
    });
    await PushNotifications.register();
  } catch (e) {
    console.error("[push] setup failed:", e);
  }
}

/**
 * Fires when a resident taps a delivered push notification (not when one
 * merely arrives) — routes into the same `path` the server's push.ts put in
 * the notification's data payload (see notifications.ts's `pushPathFor`),
 * the same "hand a path to the router" contract `setupAppUrlListener` uses.
 * No-op on web.
 */
export function setupPushTapListener(go: (path: string) => void): () => void {
  if (!isNative) return () => {};
  const box: { handle?: { remove: () => void } } = {};
  PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const path = action.notification.data?.path;
    if (typeof path === "string") go(path);
  }).then((handle) => {
    box.handle = handle;
  });
  return () => box.handle?.remove();
}
