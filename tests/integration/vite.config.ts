import { mergeConfig } from "vite";
import { fileURLToPath } from "node:url";
import base from "../support/vite.config";
import { qaPorts } from "../support/integration-safety";
const ports = qaPorts(process.env);
export default mergeConfig(base, {
  // Do not invalidate the mocked/dev server's optimizer cache when both run.
  cacheDir: fileURLToPath(new URL("../../.qa-data/vite-real-auth", import.meta.url)),
  server: { port: ports.web, strictPort: true, proxy: { "/api": `http://127.0.0.1:${ports.api}`, "/uploads": `http://127.0.0.1:${ports.api}` } },
});
