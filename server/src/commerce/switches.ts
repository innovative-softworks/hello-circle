import { getSetting } from "../db/index.js";
import { COMMERCE_SWITCHES } from "./catalog.js";

/** Reads a commerce switch from app_settings, falling back to its catalog
 * default — the default lives only in catalog.ts, never at a call site. */
export async function commerceSwitch(key: string): Promise<boolean> {
  const spec = COMMERCE_SWITCHES.find((s) => s.key === key);
  if (!spec) throw new Error(`Unknown commerce switch "${key}"`);
  return (await getSetting(key, spec.defaultValue ? "true" : "false")) === "true";
}
