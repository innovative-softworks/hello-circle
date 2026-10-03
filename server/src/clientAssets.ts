// Serving the built client (single-origin deploy) — HC-QA-090.
//
// Before: express.static with default caching, then a catch-all that answered
// EVERY unmatched GET with index.html (200). After a deploy, a tab still
// running the previous build lazy-loads /assets/<old-hash>.js, received HTML,
// failed strict MIME checking, and the app went blank. Now:
//   - hashed build output under /assets/ is immutable (content-addressed), so
//     it is cached for a year;
//   - a missing static asset is a real 404 (never HTML pretending to be JS);
//   - HTML (the SPA shell) is `no-cache` so a new deploy is picked up on the
//     next navigation, and the cached template is re-read when index.html
//     changes on disk — a rebuild can't keep serving stale asset hashes.
// The client side of the fix (recover from a failed chunk load) lives in
// client/src/chunkRecovery.ts.
import fs from "node:fs";
import path from "node:path";
import express, { type Express, type Request, type Response } from "express";

export const IMMUTABLE_ASSET_CACHE = "public, max-age=31536000, immutable";
export const HTML_CACHE = "no-cache";

/** Paths that can only ever be a build/static file, never an SPA route. */
export function isStaticAssetPath(p: string): boolean {
  return p.startsWith("/assets/") || /\.(?:m?js|css|map|wasm)$/i.test(p);
}

export function createIndexHtmlReader(indexHtmlPath: string) {
  let cached: { mtimeMs: number; html: string } | null = null;
  return function readIndexHtml(): string {
    const { mtimeMs } = fs.statSync(indexHtmlPath);
    if (!cached || cached.mtimeMs !== mtimeMs) cached = { mtimeMs, html: fs.readFileSync(indexHtmlPath, "utf-8") };
    return cached.html;
  };
}

/** Mounts the static client + SPA fallback. `renderShell` produces the HTML for
 * an SPA route (e.g. with per-route OG tags); `/api/*` and `/uploads/*` are
 * always passed through to later handlers. */
export function mountClient(app: Express, clientDist: string, renderShell: (req: Request, res: Response) => Promise<unknown>) {
  // `index: false` — see index.ts: "/" must go through renderShell (OG tags).
  app.use(
    express.static(clientDist, {
      index: false,
      setHeaders(res, filePath) {
        const rel = path.relative(clientDist, filePath).split(path.sep).join("/");
        if (rel.startsWith("assets/")) res.setHeader("Cache-Control", IMMUTABLE_ASSET_CACHE);
      },
    })
  );
  app.get("*", async (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) return next();
    if (isStaticAssetPath(req.path)) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(404).type("text/plain").send("Not found");
    }
    res.setHeader("Cache-Control", HTML_CACHE);
    await renderShell(req, res);
  });
}
