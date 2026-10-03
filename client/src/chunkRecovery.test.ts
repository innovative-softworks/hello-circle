import { describe, expect, it, vi } from "vitest";
import { AUTO_RELOAD_WINDOW_MS, claimAutoReload, isChunkLoadError, markPageLeaving, recoverFromStaleBuild, type ReloadStore } from "./chunkRecovery";

// HC-QA-090 — stale-build recovery must recognise each engine's chunk-load
// failure and must never reload in a loop.

function memoryStore(): ReloadStore & { value: string | null } {
  return { value: null, get() { return this.value; }, set(v) { this.value = v; } };
}

describe("isChunkLoadError", () => {
  it("recognises the Chromium, Firefox and WebKit dynamic-import failures", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/assets/Circles-Cup5glGj.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module: https://x/assets/a.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Unable to preload CSS for /assets/a.css"))).toBe(true);
  });
  it("ignores ordinary errors", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe("claimAutoReload — never loops", () => {
  it("allows one reload, then refuses within the window, then allows again after it", () => {
    const store = memoryStore();
    const t0 = 1_000_000;
    expect(claimAutoReload(store, t0)).toBe(true);
    expect(claimAutoReload(store, t0 + 1_000)).toBe(false);
    expect(claimAutoReload(store, t0 + AUTO_RELOAD_WINDOW_MS - 1)).toBe(false);
    expect(claimAutoReload(store, t0 + AUTO_RELOAD_WINDOW_MS + 1)).toBe(true);
  });
  it("refuses to auto-reload when the attempt can't be recorded (blocked storage)", () => {
    const blocked: ReloadStore = { get: () => null, set: () => {} };
    expect(claimAutoReload(blocked, 5)).toBe(false);
  });
  it("recoverFromStaleBuild reloads at most once per window", () => {
    const store = memoryStore();
    const reload = vi.fn();
    expect(recoverFromStaleBuild(reload, store)).toBe(true);
    expect(recoverFromStaleBuild(reload, store)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("recoverFromStaleBuild — never hijacks a navigation", () => {
  it("does not reload while the page is being left (aborted chunk ≠ stale build)", () => {
    vi.useFakeTimers();
    try {
      const store = memoryStore();
      const reload = vi.fn();
      markPageLeaving(10_000);
      expect(recoverFromStaleBuild(reload, store)).toBe(false);
      expect(reload).not.toHaveBeenCalled();
      expect(store.value, "no reload attempt recorded").toBeNull();
      vi.advanceTimersByTime(10_001); // navigation didn't happen → recovery allowed again
      expect(recoverFromStaleBuild(reload, store)).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
