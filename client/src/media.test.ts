import { describe, expect, it } from "vitest";
import { resolveMediaUrl } from "./media";

// resolveMediaUrl is the pure, config-injected core of getMediaUrl() — see
// its own doc comment for why tests call it directly instead of stubbing
// import.meta.env (Vite bakes those in at transform time, which doesn't
// reliably respond to re-stubbing process.env per test).

const NO_PROVIDER = { mediaPublicDomain: null, imageResizingEnabled: false, cloudinaryCloudName: null };

describe("resolveMediaUrl", () => {
  it("passes through a legacy /uploads path unchanged when no cloud provider is configured", () => {
    expect(resolveMediaUrl("/uploads/abc123.jpg", "card", NO_PROVIDER)).toBe("/uploads/abc123.jpg");
  });

  it("passes through null/undefined as an empty string", () => {
    expect(resolveMediaUrl(null, "card", NO_PROVIDER)).toBe("");
    expect(resolveMediaUrl(undefined, "card", NO_PROVIDER)).toBe("");
  });

  it("passes through an external marketing/placeholder URL unchanged even when R2 is configured", () => {
    const config = { mediaPublicDomain: "media.hellocircle.ie", imageResizingEnabled: true, cloudinaryCloudName: null };
    expect(resolveMediaUrl("https://placehold.co/600x400", "card", config)).toBe("https://placehold.co/600x400");
  });

  it("rewrites an R2 URL into a Cloudflare Image Resizing transform when both R2 vars are set", () => {
    const config = { mediaPublicDomain: "media.hellocircle.ie", imageResizingEnabled: true, cloudinaryCloudName: null };
    const result = resolveMediaUrl("https://media.hellocircle.ie/centres/abc/gallery/x.jpg", "card", config);
    expect(result).toBe("https://media.hellocircle.ie/cdn-cgi/image/width=800,fit=scale-down,format=auto/centres/abc/gallery/x.jpg");
  });

  it("renders the raw R2 object URL, unresized, when Image Resizing isn't enabled", () => {
    const config = { mediaPublicDomain: "media.hellocircle.ie", imageResizingEnabled: false, cloudinaryCloudName: null };
    expect(resolveMediaUrl("https://media.hellocircle.ie/centres/abc/gallery/x.jpg", "card", config)).toBe("https://media.hellocircle.ie/centres/abc/gallery/x.jpg");
  });

  it("does not touch a URL that merely resembles the R2 domain (no https:// prefix match)", () => {
    const config = { mediaPublicDomain: "media.hellocircle.ie", imageResizingEnabled: true, cloudinaryCloudName: null };
    expect(resolveMediaUrl("http://media.hellocircle.ie/x.jpg", "card", config)).toBe("http://media.hellocircle.ie/x.jpg");
  });

  it("rewrites a Cloudinary delivery URL into a Cloudinary transform, independent of R2 config", () => {
    const config = { mediaPublicDomain: null, imageResizingEnabled: false, cloudinaryCloudName: "hellocircle-demo" };
    const result = resolveMediaUrl("https://res.cloudinary.com/hellocircle-demo/image/upload/hellocircle/editorial/abc123", "hero", config);
    expect(result).toBe("https://res.cloudinary.com/hellocircle-demo/image/upload/w_1600,c_limit,f_auto,q_auto/hellocircle/editorial/abc123");
  });

  it("never rewrites a Cloudinary-shaped URL from a DIFFERENT cloud name than the configured one", () => {
    const config = { mediaPublicDomain: null, imageResizingEnabled: false, cloudinaryCloudName: "hellocircle-demo" };
    const foreignUrl = "https://res.cloudinary.com/someone-elses-cloud/image/upload/x";
    expect(resolveMediaUrl(foreignUrl, "hero", config)).toBe(foreignUrl);
  });

  it("passes through an unconfigured Cloudinary-shaped URL unchanged when no cloud name is set", () => {
    const url = "https://res.cloudinary.com/hellocircle-demo/image/upload/hellocircle/editorial/abc123";
    expect(resolveMediaUrl(url, "hero", NO_PROVIDER)).toBe(url);
  });

  it("checks Cloudinary before R2, and each still only matches its own configured domain", () => {
    const config = { mediaPublicDomain: "media.hellocircle.ie", imageResizingEnabled: true, cloudinaryCloudName: "hellocircle-demo" };
    const r2Result = resolveMediaUrl("https://media.hellocircle.ie/circles/xyz/cover/y.jpg", "thumbnail", config);
    expect(r2Result).toBe("https://media.hellocircle.ie/cdn-cgi/image/width=360,fit=scale-down,format=auto/circles/xyz/cover/y.jpg");
    const cloudinaryResult = resolveMediaUrl("https://res.cloudinary.com/hellocircle-demo/image/upload/hellocircle/editorial/z", "thumbnail", config);
    expect(cloudinaryResult).toBe("https://res.cloudinary.com/hellocircle-demo/image/upload/w_360,c_limit,f_auto,q_auto/hellocircle/editorial/z");
  });

  it("never upscales via c_limit/scale-down semantics for non-avatar variants (both providers use the same non-upscaling fit)", () => {
    const r2Config = { mediaPublicDomain: "media.hellocircle.ie", imageResizingEnabled: true, cloudinaryCloudName: null };
    expect(resolveMediaUrl("https://media.hellocircle.ie/x.jpg", "card", r2Config)).toContain("fit=scale-down");
    const cloudinaryConfig = { mediaPublicDomain: null, imageResizingEnabled: false, cloudinaryCloudName: "demo" };
    expect(resolveMediaUrl("https://res.cloudinary.com/demo/image/upload/x", "card", cloudinaryConfig)).toContain("c_limit");
  });

  // Local-processing pass — a pre-generated variant is a real, already-
  // correctly-sized static AVIF file; resolving it means swapping to the
  // sibling file, never asking Cloudflare to transform an AVIF source
  // (confirmed live that Image Resizing 415s on that).
  describe("local-processing (pre-generated AVIF variant) URLs", () => {
    const config = { mediaPublicDomain: "media.hellocircle.ie", imageResizingEnabled: true, cloudinaryCloudName: null };

    it("swaps to the sibling file for the requested variant instead of building a transform URL", () => {
      const hero = "https://media.hellocircle.ie/centres/abc/gallery/uuid-hero.avif";
      expect(resolveMediaUrl(hero, "thumbnail", config)).toBe("https://media.hellocircle.ie/centres/abc/gallery/uuid-thumbnail.avif");
      expect(resolveMediaUrl(hero, "card", config)).toBe("https://media.hellocircle.ie/centres/abc/gallery/uuid-card.avif");
      expect(resolveMediaUrl(hero, "hero", config)).toBe(hero);
    });

    it("returns the single avatar file unchanged regardless of requested variant", () => {
      const avatar = "https://media.hellocircle.ie/residents/xyz/avatar/uuid-avatar.avif";
      expect(resolveMediaUrl(avatar, "card", config)).toBe(avatar);
      expect(resolveMediaUrl(avatar, "hero", config)).toBe(avatar);
    });

    it("falls back to the legacy Image Resizing transform for a URL that doesn't match the variant-suffix convention", () => {
      const legacy = "https://media.hellocircle.ie/centres/abc/gallery/plain-uuid.jpg";
      expect(resolveMediaUrl(legacy, "card", config)).toBe("https://media.hellocircle.ie/cdn-cgi/image/width=800,fit=scale-down,format=auto/centres/abc/gallery/plain-uuid.jpg");
    });
  });

  // Privacy pass — the one signed-delivery case (a restricted Circle
  // cover) is never rewritten as a string; the wanted size is threaded
  // through as a query param so the SERVER derives and signs the right
  // real object (see routes/media.ts). This proves the client never
  // tries to construct or mutate a signed url itself.
  describe("restricted Circle cover proxy path", () => {
    const config = { mediaPublicDomain: "media.hellocircle.ie", imageResizingEnabled: true, cloudinaryCloudName: null };

    it("appends the requested variant as a query param, not a path/signature rewrite", () => {
      expect(resolveMediaUrl("/api/media/circles/abc-123/cover", "hero", config)).toBe("/api/media/circles/abc-123/cover?variant=hero");
      expect(resolveMediaUrl("/api/media/circles/abc-123/cover", "thumbnail", NO_PROVIDER)).toBe("/api/media/circles/abc-123/cover?variant=thumbnail");
    });
  });
});
