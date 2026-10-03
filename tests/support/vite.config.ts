import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("../../client", import.meta.url)),
  plugins: [react()],
  envDir: false,
  // Never inherit client/.env (Firebase, Mapbox, or deployment configuration).
  define: {
    "import.meta.env.VITE_LAUNCH_MODE": JSON.stringify("public"),
    "import.meta.env.VITE_MAPBOX_ENABLED": JSON.stringify("false"),
    ...Object.fromEntries(["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_APP_ID", "VITE_MAPBOX_TOKEN"].map((key) => [`import.meta.env.${key}`, JSON.stringify("")])),
  },
  server: { host: "127.0.0.1", port: 4177, strictPort: true, proxy: {} },
});
