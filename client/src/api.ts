import type { Role } from "./types";

// Thin barrel re-exporting every typed fetch wrapper — the implementation
// now lives in client/src/api/{core,public,resident,vendorAuth,vendor,
// admin}.ts, split out of what used to be a single 1076-line file (see
// CLAUDE.md). Kept as the public import path so none of the existing
// `from "./api"` / `from "../api"` call sites need to change.

export * from "./api/core";
export * from "./api/public";
export * from "./api/resident";
export * from "./api/vendorAuth";
export * from "./api/vendor";
export * from "./api/admin";
export * from "./api/manage";

export type { Role };
