import { cloneElement, isValidElement, useEffect, useRef, type CSSProperties, type ReactNode } from "react";

const STEP_MS = 55;
const MAX_STEPS = 14;

type Tag = "h1" | "h2" | "h3" | "p";

// Headline that reveals word by word (each word rises out of a clipped line)
// once it scrolls into view. Handles nested inline elements (<br />, colored
// <span>s) by splitting the text inside them. Opts out of useScrollReveal's
// whole-element fade since it animates itself.
export function RevealText({ as: Tag = "h2", style, className, children }: { as?: Tag; style?: CSSProperties; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.classList.add("is-in");
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        el.classList.add("is-in");
        observer.disconnect();
      },
      { threshold: 0.2, rootMargin: "0px 0px -6% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  let index = 0;
  const split = (node: ReactNode): ReactNode => {
    if (typeof node === "string") {
      return node.split(/(\s+)/).map((token, i) => {
        if (token === "") return null;
        if (/^\s+$/.test(token)) return " ";
        const delay = Math.min(index++, MAX_STEPS) * STEP_MS;
        return (
          <span key={i} className="rt-word">
            <span className="rt-inner" style={{ transitionDelay: `${delay}ms` }}>
              {token}
            </span>
          </span>
        );
      });
    }
    if (Array.isArray(node)) return node.map((n, i) => <span key={i} style={{ display: "contents" }}>{split(n)}</span>);
    if (isValidElement<{ children?: ReactNode }>(node)) {
      if (node.type === "br" || node.props.children === undefined) return node;
      return cloneElement(node, undefined, split(node.props.children));
    }
    return node;
  };

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Tag ref={ref as any} data-no-reveal className={`rt-root${className ? ` ${className}` : ""}`} style={style}>
      {split(children)}
    </Tag>
  );
}
