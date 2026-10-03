// HC-QA-090 — recover from a stale build after a deploy.
//
// A tab opened before a deploy still runs the previous build's chunk graph;
// its next lazy route/component asks for /assets/<old-hash>.js, which no longer
// exists (the server now answers 404). Without handling, React unmounts and the
// page goes blank. Recovery: reload once (fetches the new index.html and its
// new chunk graph); if a reload already happened recently, don't loop — show
// "HelloCircle has been updated — Refresh to continue" instead.

const RELOAD_KEY = "hc_stale_build_reload_at";
export const AUTO_RELOAD_WINDOW_MS = 5 * 60_000;

const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // WebKit
  /Expected a JavaScript(-or-Wasm)? module script/i,
  /Unable to preload CSS/i, // Vite CSS preload
  /Loading (CSS )?chunk [\w-]+ failed/i,
];

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const name = (error as { name?: string }).name ?? "";
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : String((error as { message?: unknown }).message ?? "");
  return name === "ChunkLoadError" || CHUNK_ERROR_PATTERNS.some((p) => p.test(message));
}

export interface ReloadStore { get(): string | null; set(value: string): void }

export const sessionReloadStore: ReloadStore = {
  get() { try { return sessionStorage.getItem(RELOAD_KEY); } catch { return null; } },
  set(value) { try { sessionStorage.setItem(RELOAD_KEY, value); } catch { /* storage blocked */ } },
};

/** Decide whether to auto-reload now. Records the attempt; returns false when a
 * reload already happened within the window — or when the attempt can't be
 * recorded (blocked storage), since an unrecorded reload could loop forever. */
export function claimAutoReload(store: ReloadStore = sessionReloadStore, now: number = Date.now()): boolean {
  const last = Number(store.get() ?? 0);
  if (last && now - last < AUTO_RELOAD_WINDOW_MS) return false;
  store.set(String(now));
  return store.get() === String(now);
}

// A chunk request the browser aborts because the user is LEAVING the page
// (typed a URL, clicked a full-page link) fails exactly like a stale chunk.
// Reloading then would hijack the user's own navigation (found in Firefox:
// NS_BINDING_ABORTED), so recovery is suppressed while the page is unloading
// — cleared again if the navigation turns out not to happen — and offline
// (a reload can't fetch a new build without a network anyway).
let leaving = false;
let leavingTimer: ReturnType<typeof setTimeout> | undefined;
export function markPageLeaving(clearAfterMs = 10_000) {
  leaving = true;
  if (leavingTimer) clearTimeout(leavingTimer);
  leavingTimer = setTimeout(() => { leaving = false; }, clearAfterMs);
}
export function isPageLeaving(): boolean {
  return leaving;
}
function recoveryBlocked(): boolean {
  return leaving || (typeof navigator !== "undefined" && navigator.onLine === false);
}

let reloadStarted = false;
/** True once a recovery reload has been triggered — the UI should render
 * nothing further (any follow-on error from the abandoned import is moot). */
export function isStaleReloadInProgress(): boolean {
  return reloadStarted;
}

/** Returns true when a reload was started (caller renders nothing new). */
export function recoverFromStaleBuild(reload: () => void = () => window.location.reload(), store: ReloadStore = sessionReloadStore): boolean {
  if (recoveryBlocked() || !claimAutoReload(store)) return false;
  reloadStarted = true;
  reload();
  return true;
}

let listening = false;
/** Vite fires `vite:preloadError` when a dynamic import's preload fails. */
export function installStaleBuildListener() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("beforeunload", () => markPageLeaving());
  window.addEventListener("pagehide", () => markPageLeaving());
  window.addEventListener("vite:preloadError", (event) => {
    if (recoverFromStaleBuild()) event.preventDefault();
    // Otherwise let the import reject → AppUpdateBoundary shows "Refresh to continue".
  });
}
