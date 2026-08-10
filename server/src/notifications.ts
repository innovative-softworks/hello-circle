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
  const { kind, listingType, listingId, listingName, vendorId, guestName, guestEmail, ref, detailsText } = params;
  const noun = kind === "booking" ? "booking" : "registration";

  const { admins, vendorEmail } = await recipients(vendorId);

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

/** Same recipients/shape as notifyNewBookingOrRegistration, but for a guest
 * cancelling their own booking/registration — the vendor/admin need to know
 * a slot/place has freed up (refunds, if any, are handled off-platform).
 * Never throws, same as the new-booking path. */
export async function notifyCancellation(params: NotifyParams) {
  const { kind, listingType, listingId, listingName, vendorId, guestName, guestEmail, ref, detailsText } = params;
  const noun = kind === "booking" ? "booking" : "registration";

  const { admins, vendorEmail } = await recipients(vendorId);

  const recipientIds = new Set<string>(admins.map((a) => a.id));
  if (vendorId) recipientIds.add(vendorId);
  for (const recipientId of recipientIds) {
    await insertNotification.run({
      recipientId,
      kind,
      title: kind === "booking" ? `Booking cancelled: ${listingName}` : `Registration cancelled: ${listingName}`,
      body: detailsText,
      listingType,
      listingId,
      ref,
    });
  }

  await sendMail({
    to: guestEmail,
    subject: `Your ${noun} was cancelled — ${listingName} (${ref})`,
    text: `Hi ${guestName},\n\nYour ${noun} for ${listingName} (ref ${ref}) has been cancelled as requested.\n\n${detailsText}\n\nIf you paid online and are due a refund, we'll be in touch about that separately.\n\nThanks for using Hello Circle.`,
  });

  if (vendorEmail) {
    await sendMail({
      to: vendorEmail,
      subject: `${noun[0].toUpperCase()}${noun.slice(1)} cancelled — ${listingName} (${ref})`,
      text: `A guest has cancelled their ${noun} for ${listingName}.\nReference: ${ref}\n\n${detailsText}\n\nGuest: ${guestName} (${guestEmail})`,
    });
  }

  for (const admin of admins) {
    await sendMail({
      to: admin.email,
      subject: `[Hello Circle] ${noun[0].toUpperCase()}${noun.slice(1)} cancelled — ${listingName} (${ref})`,
      text: `A ${noun} was cancelled on the platform.\nListing: ${listingName}\nReference: ${ref}\n\n${detailsText}\n\nGuest: ${guestName} (${guestEmail})`,
    });
  }
}
