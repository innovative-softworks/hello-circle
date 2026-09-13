// Editorial photography for onboarding/auth marketing screens (spec's
// Splash/Welcome/Location-success moments) — real, freely-licensed stock
// photography (Unsplash), not fabricated listing data. Direct CDN URLs,
// pinned to a specific photo id each so they never change out from under
// the app.
export const ONBOARDING_PHOTOS = {
  // Misty green coastal hillside — the Splash screen's "find your people,
  // do more together" backdrop.
  splash: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1200&q=80',
  // Ocean sunset — Location Success's "Hello {county}" backdrop.
  sunset: 'https://images.unsplash.com/photo-1414609245224-afa02bfb3fda?w=1200&q=80',
  // Friends laughing together outdoors — Check Email / Verifying's
  // reassuring "you're nearly in" backdrop.
  friends: 'https://images.unsplash.com/photo-1543807535-eceef0bc6599?w=1200&q=80',
} as const;
