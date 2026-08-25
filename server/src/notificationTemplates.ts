import { db } from "./db/index.js";

// Admin-editable notification templates (implementation backlog #2) — an
// override layer over notifications.ts's own hardcoded copy, not a
// replacement for it. Every call site still passes a full `fallback`; a
// missing template_key row (the default — the table starts empty and stays
// that way until an admin edits one) means renderTemplate() returns the
// fallback completely unchanged, byte for byte. This is deliberately
// scoped to notifyNewBookingOrRegistration()/notifyCancellation() — the two
// functions every booking/registration/experience/program checkout path
// already shares — rather than every notification call site in the app;
// see the implementation backlog memory for the explicit scope note on
// what's NOT migrated (waitlist/game/circle notifications stay hardcoded
// at their own call sites).

/** Every currently-templated key, with a short human-readable description
 * and the placeholder variables it receives — surfaced in the admin editor
 * (GET /admin/notification-templates) so an admin knows what {{name}} means
 * without reading source. */
export const NOTIFICATION_TEMPLATE_KEYS = [
  {
    key: "booking_new_inapp",
    description: "In-app notification title shown to the vendor/admin when a new booking or registration comes in.",
    fields: ["title"] as const,
    vars: ["noun", "listingName"],
  },
  {
    key: "booking_new_guest_email",
    description: "Confirmation email sent to the guest right after a new booking/registration.",
    fields: ["subject", "body"] as const,
    vars: ["guestName", "noun", "listingName", "ref", "detailsText", "manageUrl"],
  },
  {
    key: "booking_new_vendor_email",
    description: "Email sent to the listing's vendor when a new booking/registration comes in.",
    fields: ["subject", "body"] as const,
    vars: ["noun", "listingName", "ref", "detailsText", "guestName", "guestEmail"],
  },
  {
    key: "booking_new_admin_email",
    description: "Email sent to every admin when a new booking/registration comes in.",
    fields: ["subject", "body"] as const,
    vars: ["noun", "listingName", "ref", "detailsText", "guestName", "guestEmail"],
  },
  {
    key: "booking_cancel_inapp",
    description: "In-app notification title shown to the vendor/admin when a booking/registration is cancelled.",
    fields: ["title"] as const,
    vars: ["noun", "listingName"],
  },
  {
    key: "booking_cancel_guest_email",
    description: "Email sent to the guest confirming their own cancellation.",
    fields: ["subject", "body"] as const,
    vars: ["guestName", "noun", "listingName", "ref", "detailsText"],
  },
  {
    key: "booking_cancel_vendor_email",
    description: "Email sent to the listing's vendor when a guest cancels.",
    fields: ["subject", "body"] as const,
    vars: ["noun", "listingName", "ref", "detailsText", "guestName", "guestEmail"],
  },
  {
    key: "booking_cancel_admin_email",
    description: "Email sent to every admin when a guest cancels.",
    fields: ["subject", "body"] as const,
    vars: ["noun", "listingName", "ref", "detailsText", "guestName", "guestEmail"],
  },
] as const;

export type NotificationTemplateKey = (typeof NOTIFICATION_TEMPLATE_KEYS)[number]["key"];

interface TemplateFallback {
  subject?: string;
  title?: string;
  body?: string;
}

interface RenderedTemplate {
  subject?: string;
  title?: string;
  body?: string;
}

function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
}

/** Never throws — a bad/missing template row degrades to the fallback
 * exactly like an unset one, so a malformed admin edit can't take down a
 * booking confirmation. */
export async function renderTemplate(key: NotificationTemplateKey, vars: Record<string, string>, fallback: TemplateFallback): Promise<RenderedTemplate> {
  try {
    const row = (await db
      .prepare(`SELECT subject_template as subjectTemplate, title_template as titleTemplate, body_template as bodyTemplate FROM notification_templates WHERE template_key = ?`)
      .get(key)) as { subjectTemplate: string | null; titleTemplate: string | null; bodyTemplate: string | null } | undefined;
    if (!row) return fallback;
    return {
      subject: row.subjectTemplate ? substitute(row.subjectTemplate, vars) : fallback.subject,
      title: row.titleTemplate ? substitute(row.titleTemplate, vars) : fallback.title,
      body: row.bodyTemplate ? substitute(row.bodyTemplate, vars) : fallback.body,
    };
  } catch (e) {
    console.error(`[notification-templates] render failed for ${key}:`, e instanceof Error ? e.message : e);
    return fallback;
  }
}
