import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// Publishes the fixed UI along the bottom of the viewport as two CSS custom
// properties on <html> (HC-QA-001 — one rule instead of per-page offsets):
//
//   --bottom-nav     the mobile tab bar's real height. Its own padding already
//                    includes env(safe-area-inset-bottom), so nothing that
//                    stacks on it may add the inset again. Without a visible
//                    bar it falls back to the safe-area inset (index.css :root).
//   --bottom-chrome  the whole fixed bottom stack: the tab bar plus any bar
//                    sitting on it (.mobile-join-bar, or anything marked
//                    [data-bottom-chrome]). Floating UI — the cookie banner,
//                    toasts — anchors at calc(var(--bottom-chrome) + 16px).
//
// Bars that sit ON the nav use `bottom: var(--bottom-nav)`.
const STACK_SELECTOR = ".mobile-tab-bar, .mobile-join-bar, [data-bottom-chrome]";

export function BottomChromeSync() {
  const { pathname } = useLocation();

  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const bar = document.querySelector<HTMLElement>(".mobile-tab-bar");
      const barVisible = !!bar && getComputedStyle(bar).display !== "none";
      if (barVisible) root.style.setProperty("--bottom-nav", `${bar!.offsetHeight}px`);
      else root.style.removeProperty("--bottom-nav");

      // Highest top edge among visible bottom-fixed bars = height of the stack.
      let top = Infinity;
      for (const el of document.querySelectorAll<HTMLElement>(STACK_SELECTOR)) {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.position !== "fixed") continue;
        const rect = el.getBoundingClientRect();
        if (rect.height > 0) top = Math.min(top, rect.top);
      }
      if (top !== Infinity) root.style.setProperty("--bottom-chrome", `${Math.max(0, Math.round(window.innerHeight - top))}px`);
      else root.style.removeProperty("--bottom-chrome");
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    window.addEventListener("resize", schedule);
    // A bar inside an entering page wrapper only reaches its final fixed
    // position once the entrance animation finishes — re-measure then too.
    document.addEventListener("animationend", schedule, true);
    document.addEventListener("transitionend", schedule, true);
    // Join bars mount after a page's data loads, so watch the DOM (coalesced
    // to one measurement per frame) as well as the bars' own size.
    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    const observeBars = () => document.querySelectorAll<HTMLElement>(STACK_SELECTOR).forEach((el) => resize?.observe(el));
    observeBars();
    const mutations = typeof MutationObserver !== "undefined" ? new MutationObserver(() => { observeBars(); schedule(); }) : null;
    mutations?.observe(document.body, { childList: true, subtree: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("animationend", schedule, true);
      document.removeEventListener("transitionend", schedule, true);
      resize?.disconnect();
      mutations?.disconnect();
    };
  }, [pathname]);

  return null;
}
