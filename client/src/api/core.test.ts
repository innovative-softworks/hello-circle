import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../clientId", () => ({ getClientId: () => "qa-client" }));
import { ApiError, request } from "./core";

// HC-QA-074 — concurrent identical GETs share one request; nothing is cached.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => { vi.unstubAllGlobals(); });

describe("request() GET coalescing", () => {
  it("identical concurrent GETs make one network request; each caller gets its own copy", async () => {
    const fetchMock = vi.fn(async () => json({ items: [1, 2] }));
    vi.stubGlobal("fetch", fetchMock);
    const [a, b, c] = await Promise.all([request<{ items: number[] }>("/residents/me"), request<{ items: number[] }>("/residents/me"), request<{ items: number[] }>("/residents/me")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ items: [1, 2] });
    a.items.push(3);
    expect(b.items, "one caller mutating its copy never affects another").toEqual([1, 2]);
    expect(c).not.toBe(b);
  });

  it("never caches: a later call goes to the network again and sees fresh data", async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => json({ n: ++n }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await request("/residents/me")).toEqual({ n: 1 });
    expect(await request("/residents/me")).toEqual({ n: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("different paths, writes, custom headers and abortable requests are never coalesced", async () => {
    const fetchMock = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([
      request("/a"), request("/b"),
      request("/a", { method: "POST", body: "{}" }), request("/a", { method: "POST", body: "{}" }),
      request("/a", { headers: { "X-Custom": "1" } }),
      request("/a", { signal: new AbortController().signal }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("a shared failure rejects every caller with its own ApiError carrying the status", async () => {
    const fetchMock = vi.fn(async () => json({ error: "Nope" }, 404));
    vi.stubGlobal("fetch", fetchMock);
    const results = await Promise.allSettled([request("/games/x"), request("/games/x")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const r of results) {
      expect(r.status).toBe("rejected");
      const e = (r as PromiseRejectedResult).reason;
      expect(e).toBeInstanceOf(ApiError);
      expect(e.status).toBe(404);
      expect(e.message).toBe("Nope");
    }
    expect((results[0] as PromiseRejectedResult).reason).not.toBe((results[1] as PromiseRejectedResult).reason);
  });
});
