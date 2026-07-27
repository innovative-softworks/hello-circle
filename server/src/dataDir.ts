import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Where the SQLite file and uploads folder live. Defaults to the server
 * package root (unchanged local behavior); point DATA_DIR at a mounted
 * persistent volume/disk in production so data survives redeploys. */
export const dataDir = process.env.DATA_DIR ?? path.join(__dirname, "..");
