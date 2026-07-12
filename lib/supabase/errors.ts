/** Postgres unique-violation SQLSTATE (23505), surfaced by supabase-js as
    `error.code`. Used as the atomic gate for idempotent inserts — the Granola
    import ledger and the tasks client_request_id key both rely on it. */
export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}
