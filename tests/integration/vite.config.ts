import { mergeConfig } from "vite";
import { fileURLToPath } from "node:url";
import base from "../support/vite.config";
export default mergeConfig(base, {
  // Do not invalidate the mocked/dev server's optimizer cache when both run.
  cacheDir: fileURLToPath(new URL("../../.qa-data/vite-real-auth", import.meta.url)),
  server: { port: 4178, proxy: { "/api": "http://127.0.0.1:4311", "/uploads": "http://127.0.0.1:4311" } },
});
