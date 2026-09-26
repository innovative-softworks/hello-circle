import { flushSync } from "react-dom";

type ViewTransitionDoc = Document & {
  startViewTransition?: (cb: () => Promise<void> | void) => { finished: Promise<void> };
};

const WAIT_MS = 900;
// Only destinations whose page renders a data-vt-hero element — anywhere else
// the transition would just stall for WAIT_MS waiting for one.
const HERO_ROUTE = /^\/(centres|clubs|experiences|adventures|programs|games|circles|provider)\/[^/?#]+\/?(\?.*)?$/;

// Resolves once the destination page has painted its hero (and its image has
// loaded), or after WAIT_MS — whichever comes first — so the morph captures a
// finished frame instead of a spinner.
function waitForHero(): Promise<void> {
  return new Promise((resolve) => {
    const deadline = Date.now() + WAIT_MS;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      observer.disconnect();
      resolve();
    };
    const check = () => {
      const hero = document.querySelector("[data-vt-hero]");
      if (!hero) return;
      const img = hero.querySelector("img");
      if (!img || img.complete) return finish();
      img.addEventListener("load", finish, { once: true });
      img.addEventListener("error", finish, { once: true });
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    check();
    window.setTimeout(finish, Math.max(0, deadline - Date.now()));
  });
}

// Morphs the clicked card's image into the destination page's `data-vt-hero`
// element via the View Transitions API. Falls back to a plain navigation
// where the API is missing or the user prefers reduced motion.
export function navigateWithSharedImage(navigate: (to: string) => void, to: string, source: HTMLElement | null) {
  const doc = document as ViewTransitionDoc;
  if (!source || !HERO_ROUTE.test(to) || to === "/games/host" || to === "/circles/start" || !doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    navigate(to);
    return;
  }
  // Only one element may carry the name at a time — mute the current page's hero, if any.
  document.querySelectorAll<HTMLElement>("[data-vt-hero]").forEach((el) => el.style.setProperty("view-transition-name", "none"));
  source.style.setProperty("view-transition-name", "hc-hero");
  const reset = () => source.style.removeProperty("view-transition-name");
  const t = doc.startViewTransition(async () => {
    flushSync(() => navigate(to));
    await waitForHero();
  });
  t.finished.then(reset, reset);
}
