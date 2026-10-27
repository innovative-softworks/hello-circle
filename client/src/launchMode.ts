// The site-wide pre-launch gate as one shared switch (moved out of App.tsx so
// pages can read it too — PUB-10). Defaults ON (gated) until a deploy
// explicitly sets VITE_LAUNCH_MODE=public, so a forgotten env var fails
// closed rather than open. Reading it never changes it.
export const LAUNCH_GATE_ENABLED = import.meta.env.VITE_LAUNCH_MODE !== "public";
