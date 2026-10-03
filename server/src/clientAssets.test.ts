import fs from "node:fs";
import http, { type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HTML_CACHE, IMMUTABLE_ASSET_CACHE, createIndexHtmlReader, isStaticAssetPath, mountClient } from "./clientAssets.js";

// HC-QA-090 — serving contract for the built client: immutable hashed assets,
// a real 404 for a missing asset (an old build's chunk after a deploy), SPA
// fallback only for HTML routes, and a shell that follows a rebuild.

let server: Server;
let base: string;
let dist: string;

beforeAll(async () => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), "hc-client-dist-"));
  fs.mkdirSync(path.join(dist, "assets"));
  fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><script type=module src=/assets/index-AAAA1111.js></script>");
  fs.writeFileSync(path.join(dist, "assets", "index-AAAA1111.js"), "export {};");
  fs.writeFileSync(path.join(dist, "favicon.svg"), "<svg/>");
  const readIndex = createIndexHtmlReader(path.join(dist, "index.html"));
  const app = express();
  app.get("/api/ping", (_req, res) => res.json({ ok: true }));
  mountClient(app, dist, async (_req, res) => res.type("text/html").send(readIndex()));
  app.use((_req, res) => res.status(404).json({ error: "api not found" }));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(dist, { recursive: true, force: true });
});

describe("client asset serving (HC-QA-090)", () => {
  it("classifies build/static paths, not SPA routes", () => {
    expect(isStaticAssetPath("/assets/Circles-Cup5glGj.js")).toBe(true);
    expect(isStaticAssetPath("/assets/logo.png")).toBe(true);
    expect(isStaticAssetPath("/vendor.css")).toBe(true);
    expect(isStaticAssetPath("/circles")).toBe(false);
    expect(isStaticAssetPath("/centres/dublin-community-hall")).toBe(false);
  });

  it("serves a hashed asset as JavaScript with immutable caching", async () => {
    const res = await fetch(`${base}/assets/index-AAAA1111.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    expect(res.headers.get("cache-control")).toBe(IMMUTABLE_ASSET_CACHE);
  });

  it("answers a missing (old-build) chunk with a real 404 — never index.html", async () => {
    const res = await fetch(`${base}/assets/Circles-OLDHASH0.js`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).not.toMatch(/html/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).not.toMatch(/<!doctype html/i);
  });

  it("serves the SPA shell for an HTML route, revalidated on every load", async () => {
    const res = await fetch(`${base}/circles`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/html/);
    expect(res.headers.get("cache-control")).toBe(HTML_CACHE);
  });

  it("does not cache non-hashed root files as immutable", async () => {
    const res = await fetch(`${base}/favicon.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).not.toMatch(/immutable/);
  });

  it("passes /api/* through to the API handlers", async () => {
    expect(await (await fetch(`${base}/api/ping`)).json()).toEqual({ ok: true });
    const missing = await fetch(`${base}/api/nope`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toMatch(/json/);
  });

  it("follows a rebuild without a restart (new asset hashes in the shell)", async () => {
    const indexPath = path.join(dist, "index.html");
    fs.writeFileSync(indexPath, "<!doctype html><script type=module src=/assets/index-BBBB2222.js></script>");
    const later = new Date(Date.now() + 5_000);
    fs.utimesSync(indexPath, later, later);
    expect(await (await fetch(`${base}/`)).text()).toContain("index-BBBB2222.js");
  });
});
