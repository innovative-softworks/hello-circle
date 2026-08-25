import crypto from "node:crypto";
import { Router } from "express";
import { db } from "../db/index.js";
import { BadRequestError, clientIdFrom } from "../util.js";

// Community-contributed places (master-prompt punch list #4) — a resident
// (or anonymous guest, same client-id pattern as reports.ts) suggests a
// venue that isn't listed yet. Admin reviews it in routes/admin.ts;
// approval auto-publishes a real unclaimed listing (vendor_id left NULL),
// the same pattern seed.ts already uses for platform-curated venues — see
// db/index.ts's place_suggestions comment.

export const placeSuggestionsRouter = Router();

interface SuggestionInput {
  suggestedName?: string;
  category?: "centre" | "club";
  area?: string;
  county?: string;
  description?: string;
  contactInfo?: string;
}

placeSuggestionsRouter.post("/", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }

  const b = req.body as SuggestionInput;
  if (!b.suggestedName?.trim() || !b.category || !["centre", "club"].includes(b.category)) {
    return res.status(400).json({ error: "A place name and category (centre or club) are required" });
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO place_suggestions (id, client_id, resident_id, suggested_name, category, area, county, description, contact_info)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, clientId, req.resident?.id ?? null, b.suggestedName.trim(), b.category, b.area ?? "", b.county ?? "", b.description ?? "", b.contactInfo ?? "");

  res.status(201).json({ id });
});

// A resident's own submitted suggestions, so they can see what happened to
// them — mirrors the Safety Centre's "your reports" read-your-own pattern.
placeSuggestionsRouter.get("/mine", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const rows = await db
    .prepare(
      `SELECT id, suggested_name as suggestedName, category, area, county, status, published_listing_id as publishedListingId, created_at as createdAt
       FROM place_suggestions WHERE client_id = ? ORDER BY created_at DESC`
    )
    .all(clientId);
  res.json(rows);
});
