import { Router } from "express";
import { requireAdminPermission } from "../adminPermissions.js";
import { PrivacyError, consentsForEmail, listPrivacyRequests, privacyRequestDetail, updatePrivacyRequest } from "../privacyRequests.js";

// OG-29 / OG-31 — the privacy-request queue and the consent viewer. Recording
// only: no route here deletes or anonymises data (D-07, DEC-14).

export const adminPrivacyRouter = Router();

const fail = (res: import("express").Response, e: unknown) => {
  if (e instanceof PrivacyError) return res.status(e.status).json({ error: e.message });
  throw e;
};

adminPrivacyRouter.get("/requests", requireAdminPermission("privacy.requests"), async (req, res) => {
  res.json(await listPrivacyRequests(typeof req.query.status === "string" ? req.query.status : undefined));
});

adminPrivacyRouter.get("/requests/:id", requireAdminPermission("privacy.requests"), async (req, res) => {
  try {
    res.json(await privacyRequestDetail(Number(req.params.id)));
  } catch (e) {
    fail(res, e);
  }
});

adminPrivacyRouter.post("/requests/:id", requireAdminPermission("privacy.requests"), async (req, res) => {
  try {
    const { status, response } = req.body as { status?: unknown; response?: unknown };
    await updatePrivacyRequest(Number(req.params.id), req.user!.id, status, response);
    res.json(await privacyRequestDetail(Number(req.params.id)));
  } catch (e) {
    fail(res, e);
  }
});

adminPrivacyRouter.get("/consents", requireAdminPermission("privacy.requests"), async (req, res) => {
  const email = typeof req.query.email === "string" ? req.query.email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter an email address" });
  res.json(await consentsForEmail(email));
});
