// Placeholder marketing/decorative images. Previously backed by Lorem Picsum
// (picsum.photos/seed/...) — deterministic per seed, but a real third-party
// service whose own outages break every image using it at once (observed
// 2026-08-31: picsum.photos returning 503/unreachable while every other
// tested host was fine). placehold.co generates a solid color block on the
// fly with no backing photo library to go down — same "stable, distinct
// placeholder per seed" property, without a third real photo-serving
// backend in the loop. Mirrors server/src/db/seed.ts's placeholderImage()
// (no shared package between client/server — kept in sync by hand).
const PLACEHOLDER_PALETTE = ["DDE8DA", "DEE6E9", "DBE7E6", "E4E3DA", "E1EBD9", "EAE9E1", "D9E6EC", "F5E1D3", "EDE0EC", "E1E6DE", "E4EDF1", "FAEBE0"];

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash;
}

export function placeholderImage(seed: string, width: number, height: number): string {
  const bg = PLACEHOLDER_PALETTE[hashSeed(seed) % PLACEHOLDER_PALETTE.length];
  return `https://placehold.co/${width}x${height}/${bg}/44544a.png?text=${encodeURIComponent(seed)}`;
}
