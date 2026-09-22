import type { ShareData } from "./api/sharing";

// Universal Sharing & Invitation system §6 — contextual message templates
// per entity type. Deliberately not "Check this out" for everything: each
// kind gets copy that actually says what it is, matching the reference
// spec's own worked examples.

export function buildShareMessage(data: ShareData): string {
  const when = data.date ? `${data.date}${data.time ? ` · ${data.time}` : ""}` : null;

  if (data.entityType === "game") {
    const lines = [`Anyone up for ${data.title}${when ? " this weekend" : ""}?`, "", when ? when : null, data.location ? data.location : null, "", `See it on HelloCircle:`, data.url];
    return lines.filter((l) => l !== null).join("\n");
  }

  if (data.entityType === "circle") {
    return [`I found this Circle on HelloCircle:`, "", data.title, data.description, "", `Join here:`, data.url].join("\n");
  }

  if (data.entityType === "centre" || data.entityType === "club") {
    return [`Check out this place I found on HelloCircle:`, "", data.title, data.location ?? "", "", `See what's happening there:`, data.url].join("\n");
  }

  if (data.entityType === "experience" || data.entityType === "adventure") {
    const lines = [`Anyone interested in ${data.title}?`, "", when, data.location ?? null, "", `See it on HelloCircle:`, data.url];
    return lines.filter((l) => l !== null).join("\n");
  }

  if (data.entityType === "program") {
    return [`Check out ${data.title} on HelloCircle.`, "", data.description, "", data.url].join("\n");
  }

  if (data.entityType === "host") {
    return [`See what ${data.title.replace(" on HelloCircle", "")} is organising on HelloCircle:`, "", data.url].join("\n");
  }

  // provider
  return [`Check out ${data.title} on HelloCircle:`, "", data.url].join("\n");
}

export function buildInviteMessage(data: ShareData, inviterName: string, inviteUrl: string): string {
  const when = data.date ? `${data.date}${data.time ? ` · ${data.time}` : ""}` : null;
  const lines = [`I'm going to ${data.title}. Want to join me?`, "", when, data.location ?? null, "", `Join me:`, inviteUrl];
  void inviterName;
  return lines.filter((l) => l !== null).join("\n");
}

export function buildEmailSubject(data: ShareData): string {
  return `${data.title} on HelloCircle`;
}

export function buildEmailBody(data: ShareData): string {
  const when = data.date ? `${data.date}${data.time ? ` · ${data.time}` : ""}` : null;
  return [`I thought you might be interested in this.`, "", data.title, when, data.location ?? null, "", `View it on HelloCircle:`, data.url].filter((l) => l !== null).join("\n");
}
