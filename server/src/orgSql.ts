// D-01 — SQL condition for public reads of organisation-owned supply: the
// member in `vendorCol` doesn't belong to a suspended organisation. No
// imports, so db/queries.ts and any router can use it without a cycle.
// Ownership and the rules behind it: see orgStatus.ts.
export function orgActiveSql(vendorCol: string): string {
  return `NOT EXISTS (SELECT 1 FROM users _osu JOIN organisations _oso ON _oso.id = _osu.org_id WHERE _osu.id = ${vendorCol} AND _oso.status = 'suspended')`;
}
