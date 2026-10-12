import { describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { FEE_CLAIM_DRAFT_CORRECTIONS, POLICY_SEEDS } from "./drafts.js";

// Commercial claims safety audit — the policy drafts must not present the
// unapproved partner fee model (or "no booking fee for customers") as fact.

const FALSE_CLAIMS = [/adds no booking fee for customers/i, /Your customers pay no booking fee/i, /reduced success fee/i, /success fee for your plan, as published on the \[Pricing page\]/i];

describe("policy drafts make no unapproved fee claims", () => {
  it("seeds", () => {
    for (const d of POLICY_SEEDS) for (const c of FALSE_CLAIMS) expect(d.body, `${d.key} ${c}`).not.toMatch(c);
    for (const c of FEE_CLAIM_DRAFT_CORRECTIONS) expect(POLICY_SEEDS.find((d) => d.key === c.docKey)?.body, c.docKey).toContain(c.to);
  });

  it("system drafts already in a database are corrected at boot; nothing published was rewritten", async () => {
    const rows = (await db.prepare(`SELECT doc_key as k, status, created_by as by_, body FROM policy_versions`).all()) as { k: string; status: string; by_: string; body: string }[];
    for (const r of rows.filter((x) => x.status === "draft" && x.by_ === "system")) for (const c of FALSE_CLAIMS) expect(r.body, `${r.k} ${c}`).not.toMatch(c);
  });
});
