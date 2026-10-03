export type DatabaseIdentity = {
  databaseName: string;
  account: string;
  serverUuid: string;
  grants: string[];
  databases: string[];
  runId: string;
  nonce: string;
};

export function assertDatabaseIdentity(actual: DatabaseIdentity, expected: { databaseName: string; serverUuid: string; runId: string; nonce: string }): void {
  const fail = () => { throw new Error("QA SAFETY ABORT: Connected database is not an approved isolated QA database."); };
  if (!/^hello_circle_e2e_qa_[a-z0-9]{8,24}$/.test(expected.databaseName)) fail();
  if (!expected.serverUuid || !expected.nonce || !expected.runId) fail();
  if (actual.databaseName !== expected.databaseName || actual.account !== "hello_circle_qa@%"
    || actual.serverUuid !== expected.serverUuid || actual.runId !== expected.runId || actual.nonce !== expected.nonce) fail();
  const allowedDatabases = new Set([expected.databaseName, "information_schema", "performance_schema"]);
  if (actual.databases.some((name) => !allowedDatabases.has(name))) fail();
  const privileges = new Set(["SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "INDEX"]);
  let schemaGrant = false;
  for (const grant of actual.grants) {
    if (/^GRANT USAGE ON \*\.\* TO `hello_circle_qa`@`%`$/.test(grant)) continue;
    const match = /^GRANT ([A-Z, ]+) ON `([^`]+)`\.\* TO `hello_circle_qa`@`%`$/.exec(grant);
    if (!match || match[2] !== expected.databaseName.replaceAll("_", "\\_") || match[1].split(", ").some((item) => !privileges.has(item))) fail();
    schemaGrant = true;
  }
  if (!schemaGrant) fail();
}
