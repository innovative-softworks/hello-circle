// Demo/decorative images. Previously backed by Lorem Picsum (picsum.photos/
// seed/...) — deterministic per seed, but a real third-party service whose
// own outages break every image using it at once (observed 2026-08-31:
// picsum.photos returning 503/unreachable while every other tested host was
// fine). A brief attempt at solid-color placehold.co blocks instead was
// worse: even loading correctly, a color block reads as "no photo" rather
// than a real image. These are real, individually verified
// `images.unsplash.com` photo ids — sport/activity/community themed, the
// same already-vetted-Unsplash-photo convention Home.tsx/VendorHero.tsx use
// — cycled deterministically per seed so every use still gets a stable
// photo rather than a random one on every load. Mirrors
// server/src/db/seed.ts's placeholderImage() (no shared package between
// client/server — kept in sync by hand).
const DEMO_PHOTO_IDS = [
  "1517649763962-0c623066013b", // group cycling
  "1571019613914-85f342c6a11e", // gym weight training
  "1543269865-cbf427effbad", // friends meeting over coffee
  "1500534623283-312aade485b7", // mountain sunrise
  "1551632811-561732d1e306", // group hiking a trail
  "1526232761682-d26e03ac148e", // kids' local football club
  "1554068865-24cecd4e34b8", // tennis match on a clay court
  "1544367567-0f2fcb009e0b", // evening yoga by the sea
  "1600965962102-9d260a71890d", // swimming laps
  "1743601587751-01dc32b707d2", // indoor badminton court
  "1635321101901-7ac6eec3d371", // community meeting room
  "1680239551293-1b1407fe1e0a", // aerial view of a playground
  "1763561553595-a60112a2977e", // colorful children's playground
  "1735216228027-fe31c23474ce", // group road cycling
];

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash;
}

export function placeholderImage(seed: string, width: number, height: number): string {
  const id = DEMO_PHOTO_IDS[hashSeed(seed) % DEMO_PHOTO_IDS.length];
  return `https://images.unsplash.com/photo-${id}?w=${width}&h=${height}&q=75&auto=format&fit=crop`;
}
