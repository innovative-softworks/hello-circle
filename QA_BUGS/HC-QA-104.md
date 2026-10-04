# HC-QA-104 — Behind Cloudflare, production sees a Cloudflare edge IP as every visitor's IP

Severity: P2 (per-IP rate limits shared across many real users; wrong IPs in logs). Category: SECURITY / OPERATIONS.
Status: OPEN — found in Phase 13A read-only inspection (2026-10-04). Production unchanged.

- **Evidence:**
  - `hellocircle.ie` resolves to Cloudflare (2606:4700:…), so the site is proxied.
  - nginx has no `real_ip` / `set_real_ip_from` / `CF-Connecting-IP` configuration; it forwards `X-Forwarded-For $proxy_add_x_forwarded_for`.
  - The app uses `TRUST_PROXY_HOPS=1`.
- **Effect:** the trusted hop is nginx, so `req.ip` is the next address, which is the **Cloudflare edge**. Visitors sharing an edge share one rate-limit bucket: one person's failed logins can rate-limit others, and attackers rotate edges cheaply. Logs record Cloudflare IPs.
- **Fix (proposed; production change, needs owner approval):** nginx `real_ip` module with Cloudflare's published IP ranges (`set_real_ip_from …; real_ip_header CF-Connecting-IP;`), only valid together with HC-QA-103's port lockdown. Keep `TRUST_PROXY_HOPS=1`.
