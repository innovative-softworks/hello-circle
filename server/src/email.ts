import nodemailer from "nodemailer";
import { CLIENT_URL } from "./stripe.js";

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER || "hello-circle@example.com";

// Without SMTP credentials configured, mail is logged instead of sent — keeps
// bookings/registrations working in dev without requiring a real mailbox.
const transporter = SMTP_HOST && SMTP_USER && SMTP_PASS
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null;

if (!transporter) {
  console.log("[email] SMTP not configured (set SMTP_HOST/SMTP_USER/SMTP_PASS in server/.env) — mail will be logged, not sent");
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Optional single primary action, rendered as a button in the HTML
   * version — e.g. a magic-link sign-in or password-reset email. When
   * given, `cta.url` is expected to also appear in `text` (every call site
   * already builds a plain-text body containing the raw link, for clients/
   * spam filters that only read the text/plain part) — the HTML renderer
   * strips that raw URL from its own paragraph flow so it isn't shown both
   * as a plain link and as a button. */
  cta?: { label: string; url: string };
  /** Overrides the Reply-To header — `from` is MAIL_FROM (a noreply
   * address in production), so any call site where a real reply is
   * plausible (e.g. the magic-link sign-in email) should set this to a
   * real, monitored inbox instead of leaving replies to land on noreply. */
  replyTo?: string;
}

const EMAIL_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const URL_PATTERN = /https?:\/\/[^\s<]+[^\s<.,)]/g;

/** Applied to already-escaped text — the URLs it matches never contain
 * `<`/`>`/`&` as literal characters (an escaped `&` reads as `&amp;`,
 * which is the *correct* escaped form inside an href anyway). */
function autoLinkUrls(escaped: string): string {
  return escaped.replace(URL_PATTERN, (url) => `<a href="${url}" style="color:${"#175f3b"};">${url}</a>`);
}

function ctaButtonHtml(cta: { label: string; url: string }): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 22px;"><tr><td style="border-radius:10px;background-color:#1e7a4c;">` +
    `<a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:12px 26px;font-family:${EMAIL_FONT};font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(cta.label)}</a>` +
    `</td></tr></table>`;
}

/** Plain-text body (the same `\n\n`-paragraph convention every call site
 * already writes in) → HTML paragraphs, with `cta.url` (if given) pulled
 * out of its paragraph and replaced with a styled button in place, rather
 * than appended after the sign-off — see MailMessage's own comment. */
function textToHtmlBody(text: string, cta?: { label: string; url: string }): string {
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const parts: string[] = [];
  for (const raw of paragraphs) {
    if (cta && raw.includes(cta.url)) {
      const leftover = raw.split(cta.url).join("").trim();
      if (leftover) parts.push(`<p style="margin:0 0 12px;">${autoLinkUrls(escapeHtml(leftover)).replace(/\n/g, "<br>")}</p>`);
      parts.push(ctaButtonHtml(cta));
    } else {
      parts.push(`<p style="margin:0 0 16px;">${autoLinkUrls(escapeHtml(raw)).replace(/\n/g, "<br>")}</p>`);
    }
  }
  return parts.join("\n");
}

/** Table-based layout with inline styles throughout (no `<style>` block) —
 * the standard "bulletproof email" approach, since Outlook desktop's Word
 * rendering engine ignores most CSS outside inline `style` attributes and
 * has no border-radius/flexbox/grid support at all. */
function wrapEmailHtml(subject: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#fbfaf7;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fbfaf7;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border:1px solid #e7e4dc;border-radius:16px;">
            <tr>
              <td style="padding:20px 32px;border-bottom:1px solid #e7e4dc;">
                <img src="${CLIENT_URL}/illustrations/logo-email.png" width="114" height="26" alt="Hello Circle" style="display:block;width:114px;height:26px;border:0;">
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 8px;font-family:${EMAIL_FONT};font-size:15px;line-height:1.6;color:#1e2420;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px 26px;border-top:1px solid #e7e4dc;font-family:${EMAIL_FONT};font-size:12.5px;color:#5b635c;">
                Hello Circle — local community centres &amp; sports clubs in Ireland.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Never throws — a failed/unconfigured send must not break a booking or registration. */
export async function sendMail(msg: MailMessage): Promise<void> {
  if (!transporter) {
    console.log(`[email:dev] to=${msg.to} subject="${msg.subject}"\n${msg.text}\n`);
    return;
  }
  try {
    // Sent multipart (text + html) — text/plain stays the literal body every
    // call site already writes (used as-is by clients that prefer it, and
    // by spam filters); html is generated from it here so no call site has
    // to maintain two copies of the same copy.
    const html = wrapEmailHtml(msg.subject, textToHtmlBody(msg.text, msg.cta));
    await transporter.sendMail({ from: MAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text, html, replyTo: msg.replyTo });
  } catch (e) {
    console.error(`[email] failed to send to ${msg.to}:`, e instanceof Error ? e.message : e);
  }
}
