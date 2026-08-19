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
