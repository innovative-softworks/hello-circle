import { describe, expect, it } from "vitest";
import { parseInline, parsePolicy, safeHref } from "./policyMarkdown";

describe("policy markdown", () => {
  it("parses headings, paragraphs and both list kinds", () => {
    const blocks = parsePolicy("# Title\n\n## 1. Section\n\nLine one\nline two\n\n1. First\n2. Second\n\n- a\n- b");
    expect(blocks.map((b) => b.t)).toEqual(["h", "h", "p", "ol", "ul"]);
    expect(blocks[1]).toMatchObject({ level: 2, id: "1-section" });
    expect(blocks[2]).toEqual({ t: "p", v: [{ t: "text", v: "Line one line two" }] });
  });

  it("only turns safe links into anchors", () => {
    expect(safeHref("/policies/x")).toBe("/policies/x");
    expect(safeHref("https://stripe.com/ie/privacy")).toBe("https://stripe.com/ie/privacy");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("//evil.example")).toBeNull();
    expect(parseInline("[x](javascript:alert(1))")[0]).toEqual({ t: "text", v: "x" });
    expect(parseInline("see [Pricing](/pricing).")).toEqual([{ t: "text", v: "see " }, { t: "link", href: "/pricing", v: "Pricing" }, { t: "text", v: "." }]);
  });

  it("keeps HTML as literal text and handles bold and escapes", () => {
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([{ t: "text", v: "<img src=x onerror=alert(1)>" }]);
    expect(parseInline("**Bold** and _ga_\\*")).toEqual([{ t: "bold", v: [{ t: "text", v: "Bold" }] }, { t: "text", v: " and _ga_*" }]);
  });
});
