import { Router, type Request, type Response } from "express";
import { writeAudit } from "../audit.js";
import { notifyAnswersChanged } from "../notifications.js";
import { isOrderSource, ownedOrder, registrationView, saveOrderAnswers, type OrderCore } from "../participation/orderRecords.js";
import { QuestionError } from "../participation/questions.js";
import { BadRequestError, clientIdFrom } from "../util.js";

// Phase I (docs/participation-expansion/20) — the resident's registration on
// their booking page, for every participation type: people, attendance,
// answers as given (wording and form version), what's missing, and changing
// answers where the organiser's form and the booking allow it. Ownership is
// this browser's guest id or the signed-in resident, exactly like the
// "my …" lists; someone else's reference reads as not found.

export const orderFormsRouter = Router();

async function owned(req: Request, res: Response): Promise<OrderCore | null> {
  const source = req.params.source;
  if (!isOrderSource(source)) {
    res.status(404).json({ error: "Booking not found" });
    return null;
  }
  let clientId: string | null = null;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (!(e instanceof BadRequestError)) throw e;
  }
  const order = await ownedOrder(source, req.params.ref, clientId, req.resident?.id ?? null, req.guestEmail ?? null);
  if (!order) {
    res.status(404).json({ error: "Booking not found" });
    return null;
  }
  return order;
}

orderFormsRouter.get("/:source/:ref/registration", async (req, res) => {
  const order = await owned(req, res);
  if (!order) return;
  res.json(await registrationView(order));
});

orderFormsRouter.put("/:source/:ref/answers", async (req, res) => {
  const order = await owned(req, res);
  if (!order) return;
  let changed: string[];
  try {
    changed = await saveOrderAnswers(order, (req.body ?? {}) as { answers?: unknown; questionsVersion?: unknown }, req.resident ? "resident" : "booker");
  } catch (e) {
    if (e instanceof QuestionError) return res.status(e.status).json({ error: e.message, code: e.code });
    throw e;
  }
  // Keys only — the answers themselves never go into the audit log.
  await writeAudit({ actorUserId: null, actorKind: req.resident ? "resident" : "system", action: `${order.source}.answers_edited`, objectType: order.source, objectId: order.ref, newValue: { keys: changed } });
  void notifyAnswersChanged({ kind: order.source, listingType: order.listingType, listingId: order.listingId, listingName: order.title, vendorId: order.vendorId, ref: order.ref, changed: changed.length });
  res.json(await registrationView(order));
});
