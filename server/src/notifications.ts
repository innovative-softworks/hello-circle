import { db } from "./db/index.js";
import { sendMail } from "./email.js";

interface NotifyParams {
  kind: "booking" | "registration";
  listingType: "centre" | "club";
  listingId: string;
  listingName: string;
  vendorId: string | null;
  guestName: string;
  guestEmail: string;
  ref: string;
  detailsText: string;
}

const insertNotification = db.prepare(
  `INSERT INTO notifications (recipient_id, kind, title, body, listing_type, listing_id, ref)
   VALUES (@recipientId, @kind, @title, @body, @listingType, @listingId, @ref)`
);

/** Logs an in-app notification for the listing's vendor (if any) and every
 * admin, and emails the guest, vendor and admin — used for every new
 * booking/registration. Never throws: a notification failure must not fail
 * the booking/registration itself. */
export async function notifyNewBookingOrRegistration(params: NotifyParams) {
  const { kind, listingType, listingId, listingName, vendorId, guestName, guestEmail, ref, detailsText } = params;
  const noun = kind === "booking" ? "booking" : "registration";

  const admins = (await db.prepare(`SELECT id, email FROM users WHERE role = 'admin'`).all()) as { id: string; email: string }[];

  const recipientIds = new Set<string>(admins.map((a) => a.id));
  if (vendorId) recipientIds.add(vendorId);
  for (const recipientId of recipientIds) {
    await insertNotification.run({
      recipientId,
      kind,
      title: kind === "booking" ? `New booking: ${listingName}` : `New registration: ${listingName}`,
      body: detailsText,
      listingType,
      listingId,
      ref,
    });
  }

  const vendorEmail = vendorId
    ? ((await db.prepare(`SELECT email FROM users WHERE id = ?`).get(vendorId)) as { email: string } | undefined)?.email
    : undefined;

  await sendMail({
    to: guestEmail,
    subject: `Your ${noun} is confirmed — ${listingName} (${ref})`,
    text: `Hi ${guestName},\n\nYour ${noun} for ${listingName} is confirmed.\nReference: ${ref}\n\n${detailsText}\n\nThanks for using Hello Circle.`,
  });

  if (vendorEmail) {
    await sendMail({
      to: vendorEmail,
      subject: `New ${noun} — ${listingName} (${ref})`,
      text: `You have a new ${noun} for ${listingName}.\nReference: ${ref}\n\n${detailsText}\n\nGuest: ${guestName} (${guestEmail})`,
    });
  }

  for (const admin of admins) {
    await sendMail({
      to: admin.email,
      subject: `[Hello Circle] New ${noun} — ${listingName} (${ref})`,
      text: `New ${noun} recorded on the platform.\nListing: ${listingName}\nReference: ${ref}\n\n${detailsText}\n\nGuest: ${guestName} (${guestEmail})`,
    });
  }
}
