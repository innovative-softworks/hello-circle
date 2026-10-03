import { describe, expect, it } from "vitest";
import { assertDatabaseIdentity, type DatabaseIdentity } from "../integration/identity";

const expected = { databaseName: "hello_circle_e2e_qa_unittest01", serverUuid: "isolated-server", runId: "qa_unittest01", nonce: "unique-run-marker" };
const valid = (): DatabaseIdentity => ({ ...expected, account: "hello_circle_qa@%", databases: [expected.databaseName, "information_schema"], grants: [
  "GRANT USAGE ON *.* TO `hello_circle_qa`@`%`",
  `GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX ON \`${expected.databaseName.replaceAll("_", "\\_")}\`.* TO \`hello_circle_qa\`@\`%\``,
] });
describe("connected identity policy (offline synthetic evidence)", () => {
  it("accepts exact isolated identity and scoped privileges", () => expect(() => assertDatabaseIdentity(valid(), expected)).not.toThrow());
  it.each([
    ["databaseName", "hello_circle_dev"], ["databaseName", "hello_circle"], ["databaseName", "hello_circle_prod"],
    ["databaseName", "unknown"], ["account", "root@localhost"], ["account", "hello_circle_qa@localhost"],
    ["serverUuid", "other-server"], ["runId", "other-run"], ["nonce", "wrong-marker"],
  ])("rejects mismatched %s", (key, value) => expect(() => assertDatabaseIdentity({ ...valid(), [key]: value }, expected)).toThrow("QA SAFETY ABORT"));
  it("rejects visibility of the protected development database", () => expect(() => assertDatabaseIdentity({ ...valid(), databases: [expected.databaseName, "hello_circle_dev"] }, expected)).toThrow());
  it.each([
    [], ["GRANT ALL PRIVILEGES ON *.* TO `hello_circle_qa`@`%`"],
    ["GRANT SELECT ON `hello_circle_dev`.* TO `hello_circle_qa`@`%`"],
    [`GRANT SELECT ON \`${expected.databaseName}\`.* TO \`hello_circle_qa\`@\`%\``],
    [`GRANT SELECT ON \`${expected.databaseName}\`.* TO \`hello_circle_qa\`@\`%\` WITH GRANT OPTION`],
  ].map((grants) => ({ grants })))("rejects missing or excessive grants $grants", ({ grants }) => expect(() => assertDatabaseIdentity({ ...valid(), grants }, expected)).toThrow("QA SAFETY ABORT"));
  it("rejects unsafe expected target even when actual matches", () => expect(() => assertDatabaseIdentity({ ...valid(), databaseName: "hello_circle_dev" }, { ...expected, databaseName: "hello_circle_dev" })).toThrow());
});
