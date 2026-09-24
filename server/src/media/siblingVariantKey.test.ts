import { describe, expect, it } from "vitest";
import { siblingVariantKey } from "./mediaService.js";

// Pure string manipulation — the mechanism that lets one stored canonical
// URL (always the "hero" or, for an avatar-only group, "avatar" variant)
// resolve to any of its real sibling files without a DB lookup. Mirrored
// in client/src/media.ts; kept as two copies per this codebase's existing
// client/server split convention.

describe("siblingVariantKey", () => {
  const base = "centres/abc123/gallery/9af6b2a4-uuid";

  it("derives every standard sibling from the canonical hero key", () => {
    expect(siblingVariantKey(`${base}-hero.avif`, "thumbnail")).toBe(`${base}-thumbnail.avif`);
    expect(siblingVariantKey(`${base}-hero.avif`, "card")).toBe(`${base}-card.avif`);
    expect(siblingVariantKey(`${base}-hero.avif`, "hero")).toBe(`${base}-hero.avif`);
  });

  it("derives siblings starting from any variant, not just hero", () => {
    expect(siblingVariantKey(`${base}-card.avif`, "hero")).toBe(`${base}-hero.avif`);
    expect(siblingVariantKey(`${base}-thumbnail.avif`, "card")).toBe(`${base}-card.avif`);
  });

  it("returns the single avatar file unchanged for any requested variant on an avatar-only group", () => {
    const avatarBase = "residents/xyz/avatar/uuid-avatar.avif";
    expect(siblingVariantKey(avatarBase, "thumbnail")).toBe(avatarBase);
    expect(siblingVariantKey(avatarBase, "card")).toBe(avatarBase);
    expect(siblingVariantKey(avatarBase, "hero")).toBe(avatarBase);
    expect(siblingVariantKey(avatarBase, "avatar")).toBe(avatarBase);
  });

  it("falls back to thumbnail (never a nonexistent file) when 'avatar' is requested on a standard group", () => {
    expect(siblingVariantKey(`${base}-hero.avif`, "avatar")).toBe(`${base}-thumbnail.avif`);
  });

  it("returns null for a legacy key that doesn't match the local-processing naming convention at all", () => {
    expect(siblingVariantKey("centres/abc123/gallery/plain-uuid.jpg", "hero")).toBeNull();
    expect(siblingVariantKey("centres/abc123/gallery/uuid.avif", "hero")).toBeNull(); // .avif but no variant suffix
  });
});
