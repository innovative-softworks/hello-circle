// Revenue & Connect Stage 4 — the small Markdown subset used by policy
// documents, parsed to a plain tree (rendered by components/PolicyMarkdown).
// Deliberately not a general Markdown/HTML renderer: nothing is ever
// injected as HTML, and only same-site, https/http and mailto links become
// anchors — anything else stays as text.

export type Inline = { t: "text"; v: string } | { t: "bold"; v: Inline[] } | { t: "link"; href: string; v: string };
export type Block =
  | { t: "h"; level: 1 | 2 | 3; v: Inline[]; id: string }
  | { t: "p"; v: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; items: Inline[][] };

export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^\/(?!\/)/.test(h)) return h;
  if (/^(https?:\/\/|mailto:)[^\s"'<>]+$/i.test(h)) return h;
  return null;
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", v: text });
    text = "";
  };
  let i = 0;
  while (i < src.length) {
    if (src[i] === "\\" && i + 1 < src.length) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (src.startsWith("**", i)) {
      const end = src.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: "bold", v: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (src[i] === "[") {
      const m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(src.slice(i));
      if (m) {
        const href = safeHref(m[2]);
        flush();
        out.push(href ? { t: "link", href, v: m[1] } : { t: "text", v: m[1] });
        i += m[0].length;
        continue;
      }
    }
    text += src[i];
    i += 1;
  }
  flush();
  return out;
}

export function parsePolicy(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { t: "ul" | "ol"; items: Inline[][] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ t: "p", v: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    const ul = /^\s*-\s+(.+)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      blocks.push({ t: "h", level: h[1].length as 1 | 2 | 3, v: parseInline(h[2]), id: slug(h[2]) });
    } else if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      if (!list || list.t !== kind) {
        flushList();
        list = { t: kind, items: [] };
      }
      list.items.push(parseInline((ul ?? ol)![1]));
    } else if (list && /^\s{2,}\S/.test(raw)) {
      // continuation of the previous list item
      list.items[list.items.length - 1].push({ t: "text", v: " " }, ...parseInline(line.trim()));
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}
