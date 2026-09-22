import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import type { ShareData } from "./routes/sharing.js";

// Universal Sharing & Invitation system §14 — dynamic, on-brand share-card
// images (1200x630), generated server-side so a link pasted into WhatsApp/
// iMessage/Slack/etc. shows real HelloCircle-styled copy instead of a bare
// URL or the raw listing photo alone. No headless browser and no external
// image service: satori lays the card out with a real flexbox engine and
// emits SVG (pure JS, no native deps); @resvg/resvg-js rasterizes that SVG
// to PNG (prebuilt native binary via napi, no system libs like librsvg
// needed) — the same two-package approach Vercel's own `@vercel/og` uses in
// production. Kept deliberately simple (one template, no per-kind variants)
// per the spec's own "don't create generic social-media-looking cards,
// keep the existing editorial/Swiss visual language" instruction.

// Same "package root, not dist" path convention as dataDir.ts's own
// __dirname math — this resolves correctly whether running from source
// (tsx, dev) or from the compiled dist/ (prod), since fonts live in a real
// checked-in assets/ directory next to src/ and dist/, not inside either.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.join(__dirname, "..", "assets", "fonts");

const fontCache: Record<string, Buffer> = {};
function loadFont(file: string): Buffer {
  if (!fontCache[file]) fontCache[file] = fs.readFileSync(path.join(FONTS_DIR, file));
  return fontCache[file];
}

// Literal hex values, hand-copied from index.css's :root light-mode block
// (colors.ts's own comment explains why: every app color is a CSS custom
// property, which doesn't exist in this server-side, no-browser render —
// there's nothing to resolve `var(--color-green)` against here). Light-mode
// values only: a shared link's preview image has no concept of the sharer's
// own dark-mode preference, so it always renders the same way for everyone,
// same reasoning as ogMeta.ts's fixed CLIENT_URL over a per-request host.
const BRAND = {
  green: "#1e7a4c",
  greenDark: "#175f3b",
  dark: "#1e2420",
  cream: "#fbfaf7",
  white: "#ffffff",
};

const WIDTH = 1200;
const HEIGHT = 630;

/** Fetches an image (an external https URL, or a same-origin /uploads/...
 * path read straight off disk) and returns it as a data: URI — satori's
 * <img> only ever accepts an already-resolved data URI, it never performs
 * its own network fetch. Returns null on any failure (unreachable host,
 * timeout, non-image content) rather than throwing — a card with no photo
 * still renders (solid brand background), which is always better than a
 * 500 on what's fundamentally a "nice to have" preview image. */
async function imageToDataUri(url: string, dataDir: string): Promise<string | null> {
  try {
    if (url.startsWith("/uploads/")) {
      const filePath = path.join(dataDir, url);
      const buf = await fs.promises.readFile(filePath);
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      return `data:${mime};base64,${buf.toString("base64")}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${contentType};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// Plain hyperscript tree — satori's expected input shape (a small subset of
// React elements), built by hand rather than via JSX/React: this is a
// backend module with no React runtime, and the tree is simple enough that
// a JSX toolchain would be pure overhead for one template.
function h(type: string, props: Record<string, unknown>, ...children: unknown[]) {
  return { type, props: { ...props, children: children.length === 1 ? children[0] : children } };
}

function buildCardTree(data: ShareData, imageDataUri: string | null) {
  const metaLine = [data.date ? `${data.date}${data.time ? ` · ${data.time}` : ""}` : null, data.location].filter(Boolean).join("  ·  ");
  const badgeText =
    typeof data.interestedCount === "number" && data.interestedCount > 0
      ? `${data.interestedCount} ${data.interestedCount === 1 ? "person" : "people"} interested`
      : data.host?.name
        ? `Hosted by ${data.host.name}`
        : null;

  const wordmarkColor = imageDataUri ? BRAND.white : BRAND.cream;
  const titleColor = BRAND.white;
  const metaColor = "rgba(255,255,255,.82)";

  return h(
    "div",
    {
      style: {
        width: `${WIDTH}px`,
        height: `${HEIGHT}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        position: "relative",
        background: imageDataUri ? BRAND.dark : `linear-gradient(135deg, ${BRAND.green} 0%, ${BRAND.greenDark} 100%)`,
        fontFamily: "Hanken Grotesk",
      },
    },
    // Background photo, absolutely filled, with a bottom-weighted dark tint
    // for legibility — the same gradient treatment Photo.tsx already uses
    // for every in-app photo card, applied here for visual consistency.
    imageDataUri
      ? h("img", { src: imageDataUri, style: { position: "absolute", inset: 0, width: `${WIDTH}px`, height: `${HEIGHT}px`, objectFit: "cover" } })
      : null,
    h("div", {
      style: {
        position: "absolute",
        inset: 0,
        display: "flex",
        background: imageDataUri ? "linear-gradient(180deg, rgba(20,24,20,.15) 0%, rgba(20,24,20,.82) 100%)" : "linear-gradient(180deg, rgba(20,24,20,0) 0%, rgba(20,24,20,.45) 100%)",
      },
    }),
    // Foreground content
    h(
      "div",
      { style: { position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", width: `${WIDTH}px`, height: `${HEIGHT}px`, padding: "56px 64px" } },
      h(
        "div",
        { style: { display: "flex", alignItems: "center", fontSize: 22, fontWeight: 800, letterSpacing: "0.08em", color: wordmarkColor, textTransform: "uppercase" } },
        "HelloCircle"
      ),
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 14 } },
        badgeText
          ? h(
              "div",
              {
                style: {
                  display: "flex",
                  alignSelf: "flex-start",
                  background: "rgba(255,255,255,.16)",
                  color: BRAND.white,
                  fontSize: 22,
                  fontWeight: 700,
                  padding: "8px 18px",
                  borderRadius: 999,
                  marginBottom: 6,
                },
              },
              badgeText
            )
          : null,
        h(
          "div",
          {
            style: {
              display: "flex",
              fontFamily: "Bricolage Grotesque",
              fontWeight: 800,
              fontSize: 64,
              lineHeight: 1.08,
              letterSpacing: "-0.02em",
              color: titleColor,
              maxWidth: "1000px",
            },
          },
          truncate(data.title, 70)
        ),
        metaLine
          ? h("div", { style: { display: "flex", fontSize: 28, fontWeight: 500, color: metaColor } }, truncate(metaLine, 90))
          : null,
        h("div", { style: { display: "flex", fontSize: 20, fontWeight: 600, color: "rgba(255,255,255,.6)", marginTop: 8 } }, "hellocircle.ie")
      )
    )
  );
}

/** Renders the 1200x630 branded share-card PNG for one entity's ShareData.
 * `dataDir` is passed in (rather than imported) so this stays decoupled
 * from dataDir.ts's own module-load side effects — callers already have it
 * via the same import every upload-serving route uses. */
export async function renderShareCardPng(data: ShareData, dataDir: string): Promise<Buffer> {
  const imageDataUri = data.image ? await imageToDataUri(data.image, dataDir) : null;
  const tree = buildCardTree(data, imageDataUri);
  const svg = await satori(tree as never, {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      { name: "Hanken Grotesk", data: loadFont("HankenGrotesk-Regular.ttf"), weight: 400, style: "normal" },
      { name: "Hanken Grotesk", data: loadFont("HankenGrotesk-Bold.ttf"), weight: 700, style: "normal" },
      { name: "Bricolage Grotesque", data: loadFont("BricolageGrotesque-Bold.ttf"), weight: 700, style: "normal" },
      { name: "Bricolage Grotesque", data: loadFont("BricolageGrotesque-ExtraBold.ttf"), weight: 800, style: "normal" },
    ],
  });
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: WIDTH } });
  return resvg.render().asPng();
}
