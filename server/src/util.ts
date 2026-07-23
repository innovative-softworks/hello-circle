export function generateRef(prefix: string): string {
  const n = Math.floor(100000 + Math.random() * 899999);
  return `${prefix}-${n}`;
}

export function clientIdFrom(req: { header(name: string): string | undefined }): string {
  const id = req.header("X-Client-Id");
  if (!id) throw new BadRequestError("X-Client-Id header is required");
  return id;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

export class BadRequestError extends Error {}
