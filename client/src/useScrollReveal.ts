import { useLayoutEffect, useRef } from "react";

const TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "IMG", "LI", "BLOCKQUOTE", "FIGCAPTION", "BUTTON", "A", "SVG"]);
const TEXTY = new Set(["DIV", "SPAN"]);
const STAGGER_MS = 90;
const MAX_STEPS = 6;
// Content that mounts after data loads is still revealed, but only shortly
// after page load — later re-renders (filters, typing) shouldn't re-animate.
const LATE_WINDOW_MS = 4000;

function hasOwnText(el: Element) {
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) return true;
  }
  return false;
}

// Reveals the text and images inside each direct child of the returned ref's
// element as they scroll into view — including above-the-fold content on
// load. Section backgrounds stay put. `skip` leaves the first N children
// static. Add data-no-reveal to any element to opt it (and its subtree) out.
export function useScrollReveal<T extends HTMLElement>(skip = 0) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const mountedAt = Date.now();
    const chosen = new Set<Element>();

    const finish = (e: Event) => {
      const el = e.currentTarget as HTMLElement;
      if (e.target !== el || (e as TransitionEvent).propertyName !== "transform") return;
      el.classList.remove("reveal", "is-visible");
      el.style.transitionDelay = "";
      el.removeEventListener("transitionend", finish);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        let step = 0;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          observer.unobserve(el);
          el.style.transitionDelay = `${Math.min(step++, MAX_STEPS) * STAGGER_MS}ms`;
          el.addEventListener("transitionend", finish);
          el.classList.add("is-visible");
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -8% 0px" },
    );

    const topLevelIndex = (el: Element) => {
      let node: Element | null = el;
      while (node && node.parentElement !== root) node = node.parentElement;
      return node ? { node, index: Array.from(root.children).indexOf(node) } : null;
    };

    const consider = (el: Element) => {
      const tag = el.tagName.toUpperCase();
      if (!TAGS.has(tag) && !(TEXTY.has(tag) && hasOwnText(el))) return;
      if (el.closest("[data-no-reveal], .fv-marquee-viewport")) return;
      for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
        if (chosen.has(p)) return;
      }
      chosen.add(el);
      el.classList.add("reveal");
      observer.observe(el);
    };

    const scan = (start: Element) => {
      const top = topLevelIndex(start);
      if (!top || top.index < skip || top.node.tagName === "HEADER" || top.node.tagName === "FOOTER") return;
      consider(start);
      for (const el of Array.from(start.querySelectorAll("*"))) consider(el);
    };

    for (const section of Array.from(root.children)) scan(section);

    const mutations = new MutationObserver((records) => {
      if (Date.now() - mountedAt > LATE_WINDOW_MS) {
        mutations.disconnect();
        return;
      }
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if (n.nodeType === Node.ELEMENT_NODE && !(n as Element).classList.contains("reveal")) scan(n as Element);
        });
      }
    });
    mutations.observe(root, { childList: true, subtree: true });

    return () => {
      mutations.disconnect();
      observer.disconnect();
      for (const el of chosen) {
        el.removeEventListener("transitionend", finish);
        el.classList.remove("reveal", "is-visible");
        (el as HTMLElement).style.transitionDelay = "";
      }
    };
  }, [skip]);

  return ref;
}
