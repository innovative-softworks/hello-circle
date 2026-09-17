import { getClientId } from "../clientId";

/** Thrown instead of a plain Error so callers that need more than the
 * message (e.g. registrations.ts's `{ error, full: true }` on a capacity
 * conflict) can inspect the parsed response body without a second fetch. */
export class ApiError extends Error {
  body: Record<string, unknown>;
  constructor(message: string, body: Record<string, unknown>) {
    super(message);
    this.body = body;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Id": getClientId(),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error || `Request failed: ${res.status}`, body);
  }
  return res.json() as Promise<T>;
}

/** "Add to calendar" (IA spec §13) — the .ics routes need the same
 * X-Client-Id/cookie auth as `request()`, but return text/calendar, not
 * JSON, so this triggers a browser download instead of parsing a body. */
export async function downloadIcs(path: string, filename: string): Promise<void> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "X-Client-Id": getClientId() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error || `Request failed: ${res.status}`, body);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** "Download my data" — same shape as downloadIcs above, for a JSON export
 * instead of a .ics file. */
export async function downloadJson(path: string, filename: string): Promise<void> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "X-Client-Id": getClientId() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error || `Request failed: ${res.status}`, body);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
