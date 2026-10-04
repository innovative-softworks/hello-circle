# HC-QA-103 — Production Node port 3001 is reachable from the internet, bypassing nginx/Cloudflare, while trusting X-Forwarded-For

Severity: **P1** (security: client-IP spoofing defeats the per-IP login rate limiter and falsifies IPs in logs). Category: SECURITY / OPERATIONS.
Status: OPEN — found in Phase 13A read-only inspection of the production VPS (2026-10-04). Production unchanged.

- **Evidence:**
  - From the internet, `GET http://<prod-ip>:3001/api/health` returns **HTTP 200**.
  - On the VPS, `ss` shows `*:3001 node`, and `ufw` is **inactive**.
  - Production `.env` has `TRUST_PROXY_HOPS=1`.
- **Root cause:**
  - `server/src/index.ts` calls `app.listen(port)` with no host, so it binds all interfaces.
  - No host firewall restricts the port.
  - Phase 11A's `TRUST_PROXY_HOPS=1` is valid **only** if Node is reachable solely through nginx (QA_STAGING_PROVISIONING.md §Proxy).
- **Impact:** a client calling `:3001` directly can send any `X-Forwarded-For`, and Express (trust 1 hop) takes it as the client IP. That defeats per-IP rate limits (e.g. the login limiter) and spoofs IPs in audit/analytics. It also skips nginx and Cloudflare protections.
- **Not exploited or tested against production:** no spoofing attempts were made on the live login.
- **Fix (proposed; needs owner approval because it changes production):**
  1. App: optional `HOST` setting (e.g. `HOST=127.0.0.1`), so Node can bind to loopback only.
  2. Host firewall: `ufw allow OpenSSH; allow 80,443; enable`.
