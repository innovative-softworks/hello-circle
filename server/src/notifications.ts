import { db } from "./db/index.js";
import { sendMail } from "./email.js";
import { renderTemplate } from "./notificationTemplates.js";
import { sendPush } from "./push.js";
import { CLIENT_URL } from "./stripe.js";

export interface NotifyParams {
  kind: "booking" | "registration" | "program" | "experience";
  listingType: "centre" | "club" | "experience";
  listingId: string;
  listingName: string;
  vendorId: string | null;
  guestName: string;
  guestEmail: string;
  ref: string;
  detailsText: string;
  /** Resident Experience Polish — set only when this booking/registration/
   * enrollment/experience-booking row actually has a resident_id (a
   * signed-in resident made it), never derived from guestEmail alone. Lets
   * notifyNewBookingOrRegistration/notifyCancellation/notifyRefund also
   * write a real in-app notification for the person who made it, not just
   * email — see notifyResident() below. Omitted/null = guest-only booking,
   * no in-app notification to write (there's no resident to write one for). */
  residentId?: string | null;
}

// Copy noun per `kind` — was a bare `kind === "booking" ? "booking" :
// "registration"` ternary in each function below, which silently said
// "registration" for any other kind. Widened alongside NotifyParams.kind to
// add Program/Experience cancel+refund support (Phase 0 protect).
function nounFor(kind: NotifyParams["kind"]): string {
  switch (kind) {
    case "booking":
      return "booking";
    case "registration":
      return "registration";
    case "program":
      return "program enrollment";
    case "experience":
      return "experience booking";
  }
}

const insertNotification = db.prepare(
  `INSERT INTO notifications (recipient_id, kind, title, body, listing_type, listing_id, ref)
   VALUES (@recipientId, @kind, @title, @body, @listingType, @listingId, @ref)`
);

const insertResidentNotification = db.prepare(
  `INSERT INTO notifications (recipient_id, resident_id, kind, title, body, listing_type, listing_id, ref)
   VALUES ('', @residentId, @kind, @title, @body, @listingType, @listingId, @ref)`
);

// Maps a notifyResident `kind` to the NotificationPrefs key that gates it
// (client/src/types.ts's NotificationPrefs) — only kinds with a real
// opt-out today are listed; a kind with no entry here always sends, since
// there's no preference field for a resident to have turned it off with.
const PREF_KEY_BY_KIND: Partial<Record<NotifyResidentParams["kind"], string>> = {
  waitlist: "waitlistOffers",
  intent_match: "intentMatches",
};

/** `residents.notification_prefs` was previously collected
 * (saveNotificationPrefs) but never read anywhere — turning a category off
 * had no effect. Resolves true (send) unless the resident has explicitly
 * saved that category as false; a resident with no prefs saved yet
 * defaults to receiving everything, matching the client's own all-true
 * default. Exported so callers that email a resident directly (not via
 * notifyResident's in-app insert, e.g. waitlist.ts) can respect the same
 * preference instead of only gating the in-app copy. */
export async function residentAllows(residentId: string, prefKey: string): Promise<boolean> {
  const row = (await db.prepare(`SELECT notification_prefs as prefs FROM residents WHERE id = ?`).get(residentId)) as
    | { prefs: string | null }
    | undefined;
  const prefs = row?.prefs ? (JSON.parse(row.prefs) as Record<string, boolean>) : null;
  return !(prefs && prefs[prefKey] === false);
}

interface NotifyResidentParams {
  residentId: string;
  kind: "booking" | "registration" | "program" | "experience" | "waitlist" | "game" | "intent_match" | "circle" | "provider_update" | "host_update" | "centre_update" | "invite" | "share";
  title: string;
  body: string;
  listingType: "centre" | "club" | "game" | "intent" | "circle" | "vendor" | "host" | "experience" | "program";
  listingId: string;
  ref: string;
}

// Deep-link path a tapped push notification opens (native.ts's
// setupAppUrlListener/notification-tap handling on the client) — mirrors
// App.tsx's actual route table, so only listing types with a real detail
// route get one; "intent" has no detail page, so notifyResident's push
// falls back to opening the app with no specific path for that kind.
const DETAIL_PATH_BY_LISTING_TYPE: Partial<Record<NotifyResidentParams["listingType"], string>> = {
  centre: "/centres/",
  club: "/clubs/",
  game: "/games/",
  circle: "/circles/",
  vendor: "/provider/",
  host: "/host/",
  experience: "/experiences/",
  program: "/programs/",
};

function pushPathFor(params: NotifyResidentParams): string | undefined {
  // My Life's own "manage this" link (see notifyNewBookingOrRegistration's
  // manageUrl below) for every kind with a ref-scoped participation row —
  // program/experience included, so the in-app/push deep link matches
  // exactly what the confirmation email already points guests to, rather
  // than the more generic listing detail page.
  if (params.kind === "booking" || params.kind === "registration" || params.kind === "program" || params.kind === "experience") {
    return `/bookings?ref=${params.ref}`;
  }
  const base = DETAIL_PATH_BY_LISTING_TYPE[params.listingType];
  return base ? `${base}${params.listingId}` : undefined;
}

/** Resident-facing in-app notification (MVP) — used for waitlist/game
 * activity, not the vendor/admin booking-confirmation feed above. Never
 * throws, same contract as the vendor/admin notifiers: a failed insert must
 * not fail whatever triggered it. `recipient_id` stays NOT NULL (existing
 * schema), so this writes '' there and resident_id instead — the two
 * recipient spaces are deliberately distinct, matched by whichever route
 * queries the table (routes/vendor.ts by recipient_id, routes/residents.ts
 * by resident_id).
 *
 * Checks the resident's notification_prefs (via residentAllows) before
 * inserting — only gates kinds with a matching pref key (see
 * PREF_KEY_BY_KIND). */
export async function notifyResident(params: NotifyResidentParams) {
  try {
    const prefKey = PREF_KEY_BY_KIND[params.kind];
    if (prefKey && !(await residentAllows(params.residentId, prefKey))) return;
    await insertResidentNotification.run({
      residentId: params.residentId,
      kind: params.kind,
      title: params.title,
      body: params.body,
      listingType: params.listingType,
      listingId: params.listingId,
      ref: params.ref,
    });
  } catch (e) {
    console.error("[notifications] resident notify failed:", e);
  }
  // Native push (Capacitor migration Phase 5) — same gating as the in-app
  // notification above, but never allowed to affect it: a push failure
  // (including an entirely unconfigured Firebase project) must not stop the
  // in-app notification from having already been written.
  try {
    const prefKey = PREF_KEY_BY_KIND[params.kind];
    if (prefKey && !(await residentAllows(params.residentId, prefKey))) return;
    await sendPush(params.residentId, { title: params.title, body: params.body, path: pushPathFor(params) });
  } catch (e) {
    console.error("[notifications] resident push failed:", e);
  }
}

async function recipients(vendorId: string | null) {
  const admins = (await db.prepare(`SELECT id, email FROM users WHERE role = 'admin'`).all()) as { id: string; email: string }[];
  const vendorEmail = vendorId
    ? ((await db.prepare(`SELECT email FROM users WHERE id = ?`).get(vendorId)) as { email: string } | undefined)?.email
    : undefined;
  return { admins, vendorEmail };
}

/** Logs an in-app notification for the listing's vendor (if any) and every
 * admin, and emails the guest, vendor and admin — used for every new
 * booking/registration. Never throws: a notification failure must not fail
 * the booking/registration itself. */
export async function notifyNewBookingOrRegistration(params: NotifyParams) {
  const { kind, listingType, listingId, listingName, vendorId, guestName, guestEmail, ref, detailsText, residentId } = params;
  const noun = nounFor(kind);
  const nounCap = `${noun[0].toUpperCase()}${noun.slice(1)}`;

  const { admins, vendorEmail } = await recipients(vendorId);

  const inApp = await renderTemplate("booking_new_inapp", { noun, listingName }, { title: kind === "booking" ? `New booking: ${listingName}` : `New registration: ${listingName}` });
  const recipientIds = new Set<string>(admins.map((a) => a.id));
  if (vendorId) recipientIds.add(vendorId);
  for (const recipientId of recipientIds) {
    await insertNotification.run({
      recipientId,
      kind,
      title: inApp.title,
      body: detailsText,
      listingType,
      listingId,
      ref,
    });
  }

  // Resident Experience Polish — the resident's own copy of this event,
  // previously email-only (see this function's own long-standing gap: it
  // only ever wrote notifications for the vendor/admin side above). Only
  // fires when residentId is actually set on the row — never inferred from
  // guestEmail, which isn't a verified resident identity.
  if (residentId) {
    await notifyResident({
      residentId,
      kind,
      title: `${nounCap} confirmed: ${listingName}`,
      body: detailsText,
      listingType,
      listingId,
      ref,
    }).catch((e) => console.error("[notifications] resident copy of new-booking notify failed:", e));
  }

  const manageUrl = `${CLIENT_URL}/bookings?ref=${ref}`;
  const guestVars = { guestName, noun, listingName, ref, detailsText, manageUrl };
  const guestMsg = await renderTemplate("booking_new_guest_email", guestVars, {
    subject: `Your ${noun} is confirmed — ${listingName} (${ref})`,
    body: `Hi ${guestName},\n\nYour ${noun} for ${listingName} is confirmed.\nReference: ${ref}\n\n${detailsText}\n\nView or manage this ${noun} any time: ${manageUrl}\n\nThanks for using Hello Circle.`,
  });
  await sendMail({ to: guestEmail, subject: guestMsg.subject!, text: guestMsg.body! });

  if (vendorEmail) {
    const vendorVars = { noun, listingName, ref, detailsText, guestName, guestEmail };
    const vendorMsg = await renderTemplate("booking_new_vendor_email", vendorVars, {
      subject: `New ${noun} — ${listingName} (${ref})`,
      body: `You have a new ${noun} for ${listingName}.\nReference: ${ref}\n\n${detailsText}\n\nGuest: ${guestName} (${guestEmail})`,
    });
    await sendMail({ to: vendorEmail, subject: vendorMsg.subject!, text: vendorMsg.body! });
  }

  for (const admin of admins) {
    const adminVars = { noun, listingName, ref, detailsText, guestName, guestEmail };
    const adminMsg = await renderTemplate("booking_new_admin_email", adminVars, {
      subject: `[Hello Circle] New ${noun} — ${listingName} (${ref})`,
      body: `New ${noun} recorded on the platform.\nListing: ${listingName}\nReference: ${ref}\n\n${detailsText}\n\nGuest: ${guestName} (${guestEmail})`,
    });
    await sendMail({ to: admin.email, subject: adminMsg.subject!, text: adminMsg.body! });
  }
}

/** Vendor-triggered "Resend confirmation" — re-sends just the guest-facing
 * confirmation email, reusing the same booking_new_guest_email template
 * notifyNewBookingOrRegistration sends at creation. Deliberately guest-only:
 * doesn't re-notify vendor/admin or write a new in-app notification, since
 * this is reassurance for one guest, not a new event. Caller is expected to
 * .catch() this, same "never blocks the action that triggered it" contract
 * as every other notification helper here. */
export async function resendConfirmationEmail(params: NotifyParams) {
  const { kind, guestName, guestEmail, ref, detailsText, listingName } = params;
  const noun = nounFor(kind);
  const manageUrl = `${CLIENT_URL}/bookings?ref=${ref}`;
  const guestVars = { guestName, noun, listingName, ref, detailsText, manageUrl };
  const guestMsg = await renderTemplate("booking_new_guest_email", guestVars, {
    subject: `Your ${noun} is confirmed — ${listingName} (${ref})`,
    body: `Hi ${guestName},\n\nYour ${noun} for ${listingName} is confirmed.\nReference: ${ref}\n\n${detailsText}\n\nView or manage this ${noun} any time: ${manageUrl}\n\nThanks for using Hello Circle.`,
  });
  await sendMail({ to: guestEmail, subject: guestMsg.subject!, text: guestMsg.body! });
}

/** Same recipients/shape as notifyNewBookingOrRegistration, but for a guest
 * cancelling their own booking/registration — the vendor/admin need to know
 * a slot/place has freed up (refunds, if any, are handled off-platform).
 * Never throws, same as the new-booking path. */
export async function notifyCancellation(params: NotifyParams) {
  const { kind, listingType, listingId, listingName, vendorId, guestName, guestEmail, ref, detailsText, residentId } = params;
  const noun = nounFor(kind);
  const nounCap = `${noun[0].toUpperCase()}${noun.slice(1)}`;

  const { admins, vendorEmail } = await recipients(vendorId);

  const inApp = await renderTemplate("booking_cancel_inapp", { noun, listingName }, { title: kind === "booking" ? `Booking cancelled: ${listingName}` : `Registration cancelled: ${listingName}` });
  const recipientIds = new Set<string>(admins.map((a) => a.id));
  if (vendorId) recipientIds.add(vendorId);
  for (const recipientId of recipientIds) {
    await insertNotification.run({
      recipientId,
      kind,
      title: inApp.title,
      body: detailsText,
      listingType,
      listingId,
      ref,
    });
  }

  // Resident Experience Polish — same reasoning as notifyNewBookingOrRegistration.
  // This function is called both from the resident's own self-cancel routes
  // and from a vendor-initiated cancel, so residentId being set here also
  // covers "a vendor cancelled a signed-in resident's booking" correctly.
  if (residentId) {
    await notifyResident({
      residentId,
      kind,
      title: `${nounCap} cancelled: ${listingName}`,
      body: detailsText,
      listingType,
      listingId,
      ref,
    }).catch((e) => console.error("[notifications] resident copy of cancellation notify failed:", e));
  }

  const guestVars = { guestName, noun, listingName, ref, detailsText };
  const guestMsg = await renderTemplate("booking_cancel_guest_email", guestVars, {
    subject: `Your ${noun} was cancelled — ${listingName} (${ref})`,
    body: `Hi ${guestName},\n\nYour ${noun} for ${listingName} (ref ${ref}) has been cancelled as requested.\n\n${detailsText}\n\nIf you paid online and are due a refund, we'll be in touch about that separately.\n\nThanks for using Hello Circle.`,
  });
  await sendMail({ to: guestEmail, subject: guestMsg.subject!, text: guestMsg.body! });

  if (vendorEmail) {
    const vendorVars = { noun, listingName, ref, detailsText, guestName, guestEmail };
    const vendorMsg = await renderTemplate("booking_cancel_vendor_email", vendorVars, {
      subject: `${nounCap} cancelled — ${listingName} (${ref})`,
      body: `A guest has cancelled their ${noun} for ${listingName}.\nReference: ${ref}\n\n${detailsText}\n\nGuest: ${guestName} (${guestEmail})`,
    });
    await sendMail({ to: vendorEmail, subject: vendorMsg.subject!, text: vendorMsg.body! });
  }

  for (const admin of admins) {
    const adminVars = { noun, listingName, ref, detailsText, guestName, guestEmail };
    const adminMsg = await renderTemplate("booking_cancel_admin_email", adminVars, {
      subject: `[Hello Circle] ${nounCap} cancelled — ${listingName} (${ref})`,
      body: `A ${noun} was cancelled on the platform.\nListing: ${listingName}\nReference: ${ref}\n\n${detailsText}\n\nGuest: ${guestName} (${guestEmail})`,
    });
    await sendMail({ to: admin.email, subject: adminMsg.subject!, text: adminMsg.body! });
  }
}

/** Vendor-issued refund (Host Manage spec §10/§14) — same recipients/shape
 * as notifyCancellation, but a distinct event worth its own record (a
 * refund can happen without a cancellation, or well after one). Hardcoded
 * copy, not run through renderTemplate()'s admin-editable layer — that
 * system is deliberately scoped to just notifyNewBookingOrRegistration()/
 * notifyCancellation() (see notificationTemplates.ts's own comment); this
 * follows the same "not migrated" precedent as the waitlist/game/circle
 * notifications elsewhere. Never throws, same contract as the others. */
export async function notifyRefund(params: NotifyParams & { refundedCents: number }) {
  const { kind, listingType, listingId, listingName, vendorId, guestName, guestEmail, ref, detailsText, refundedCents, residentId } = params;
  const noun = nounFor(kind);
  const amount = `€${(refundedCents / 100).toFixed(2)}`;

  const { admins, vendorEmail } = await recipients(vendorId);
  const recipientIds = new Set<string>(admins.map((a) => a.id));
  if (vendorId) recipientIds.add(vendorId);
  for (const recipientId of recipientIds) {
    await insertNotification.run({
      recipientId,
      kind,
      title: `Refund issued: ${listingName}`,
      body: `${amount} refunded — ${detailsText}`,
      listingType,
      listingId,
      ref,
    });
  }

  // Resident Experience Polish — same reasoning as the two functions above.
  if (residentId) {
    await notifyResident({
      residentId,
      kind,
      title: `Refund issued: ${listingName}`,
      body: `${amount} refunded — ${detailsText}`,
      listingType,
      listingId,
      ref,
    }).catch((e) => console.error("[notifications] resident copy of refund notify failed:", e));
  }

  await sendMail({
    to: guestEmail,
    subject: `You've been refunded ${amount} — ${listingName} (${ref})`,
    text: `Hi ${guestName},\n\nYou've been refunded ${amount} for your ${noun} at ${listingName} (ref ${ref}).\n\n${detailsText}\n\nThis can take a few business days to show up, depending on your bank.\n\nThanks for using Hello Circle.`,
  });

  if (vendorEmail) {
    await sendMail({
      to: vendorEmail,
      subject: `Refund issued — ${listingName} (${ref})`,
      text: `A refund of ${amount} was issued for the ${noun} at ${listingName}.\nReference: ${ref}\n\n${detailsText}\n\nGuest: ${guestName} (${guestEmail})`,
    });
  }
}
