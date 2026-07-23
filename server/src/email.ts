import nodemailer from "nodemailer";

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
}

/** Never throws — a failed/unconfigured send must not break a booking or registration. */
export async function sendMail(msg: MailMessage): Promise<void> {
  if (!transporter) {
    console.log(`[email:dev] to=${msg.to} subject="${msg.subject}"\n${msg.text}\n`);
    return;
  }
  try {
    await transporter.sendMail({ from: MAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text });
  } catch (e) {
    console.error(`[email] failed to send to ${msg.to}:`, e instanceof Error ? e.message : e);
  }
}
