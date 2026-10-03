import bcrypt from "bcryptjs";
import { test, expect } from "../fixtures";
import { withSecurityIdentity, assertAnonymous, assertLoggedOut, assertRejected } from "../security-fixture";

for (const variant of ["original", "uppercase", "whitespace"] as const) {
  const id = { original: "AUTH-SEC-001/006/007", uppercase: "AUTH-SEC-004", whitespace: "AUTH-SEC-005" }[variant];
  test(`${id}: ${variant} existing Google identity rejects signup and attacker login`, async ({ request }) => {
    await withSecurityIdentity("google", async (fixture) => {
      await fixture.resolveOriginalGoogle();
      await assertAnonymous(request);
      const email = variant === "uppercase" ? fixture.email.toUpperCase() : variant === "whitespace" ? `  ${fixture.email}  ` : fixture.email;
      const response = await request.post("/api/guest/signup", { data: { email, password: fixture.password, name: "Unrelated requester", termsAccepted: true } });
      await assertRejected(response, request, variant === "whitespace" ? 400 : 409);
      if (variant === "whitespace") {
        // API rejects malformed whitespace first; service must ALSO reject after normalization.
        const { createResidentWithPassword } = await import("../../../server/src/residents");
        expect(await createResidentWithPassword(email, bcrypt.hashSync(fixture.password, 10), "Unrelated", true, true)).toBeNull();
      }
      await fixture.unchanged();
      expect((await request.post("/api/guest/login", { data: { email: fixture.email, password: fixture.password } })).status()).toBe(401);
      await assertAnonymous(request);
      const [sessions] = await fixture.connection.query<any[]>("SELECT COUNT(*) AS count FROM guest_sessions WHERE email = ?", [fixture.email]);
      expect(Number(sessions[0].count)).toBe(0);
      await fixture.resolveOriginalGoogle();
      await fixture.unchanged();
    });
  });
}

test("AUTH-SEC-002: existing password signup conflicts without replacing credentials", async ({ request }) => {
  await withSecurityIdentity("password", async (fixture) => {
    const response = await request.post("/api/guest/signup", { data: { email: fixture.email, password: fixture.password, termsAccepted: true } });
    await assertRejected(response, request);
    await fixture.unchanged();
    expect((await request.post("/api/guest/login", { data: { email: fixture.email, password: fixture.originalPassword } })).status()).toBe(200);
    expect((await (await request.get("/api/residents/me")).json()).resident.id).toBe(fixture.id);
    await request.post("/api/guest/logout");
    await assertLoggedOut(request);
  });
});

test("AUTH-SEC-008: repeated signup attempts never mutate the original identity", async ({ request }) => {
  await withSecurityIdentity("google", async (fixture) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await assertRejected(await request.post("/api/guest/signup", { data: { email: fixture.email, password: fixture.password, termsAccepted: true, marketingConsent: true } }), request);
      await fixture.unchanged();
    }
    await fixture.resolveOriginalGoogle();
  });
});
