// UI/UX plan phase 7 — a small, shared bank of fallback strings for the
// handful of truly-generic error/empty states (network failure, nothing
// found, no permission), written in the same warm-but-plain voice as the
// rest of this app's copy. Deliberately NOT a place to route every error
// message in the app: most of this codebase's ~40 catch-block fallbacks are
// already usefully specific ("Couldn't cancel this booking," "Couldn't
// reschedule") and should stay that way — a specific message beats a
// generic one every time it's available. This only covers the cases where
// nothing more specific exists (e.g. a caught value that isn't a real
// Error), which previously meant each call site re-typed its own version of
// the same generic sentence by hand.

export const fallbackCopy = {
  /** The catch-all when an error genuinely carries no useful detail — the
   * `!(e instanceof Error)` branch, not a stand-in for a real message. */
  generic: "Something went wrong — try again.",
  /** A request that completed but found nothing to show. */
  notFound: "Couldn't find anything matching that.",
  /** A 401/403-shaped failure. */
  permissionDenied: "You don't have permission to do that.",
} as const;
