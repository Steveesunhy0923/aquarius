/**
 * Read EVERY row of a listing, across the server's row cap.
 *
 * PostgREST truncates a bare `.select()` at `max_rows` (1000 in
 * supabase/config.toml, and the hosted default) — SILENTLY: no error, and
 * nothing in the response says the list is short. For the sync engine that is
 * not a cosmetic problem: it treats a previously-synced note that is missing
 * from the cloud listing as deleted on another device and removes the local
 * copy (lib/sync/engine.ts). A truncated listing therefore deletes notes.
 *
 * KEYSET, not offset. `range(from, to)` skips a row whenever an earlier row is
 * deleted between two page requests, and a skipped row looks exactly like a
 * deleted one. Walking `key > lastKey` over an immutable primary key cannot
 * skip: a concurrent delete or insert only ever changes rows we have not
 * passed yet, or ones we already hold.
 *
 * THE STOP RULE. A page shorter than the limit means the server had nothing
 * more — but only if the limit we asked for is one the server honours. If the
 * project's cap is LOWER than our page size, every page is "short". So the
 * first request also asks for the exact total: when it reports more rows than
 * the page returned, that page's length IS the cap, and it becomes the limit
 * for the rest of the walk. One count, on one request; no trailing empty page
 * in the common case.
 */

export const PAGE_SIZE = 1000;

export interface Page<T> {
  rows: T[];
  /** Exact total matching the query. Only meaningful on the first page. */
  total?: number | null;
}

/**
 * @param fetchPage  Fetch up to `limit` rows whose key is greater than `after`
 *                   (all rows from the start when `after` is null), ORDERED BY
 *                   that key ascending. `wantTotal` is true only on the first
 *                   call, which should then report the exact total.
 * @param keyOf      The row's ordering key (an immutable, unique column).
 */
export async function fetchAllByKey<T>(
  fetchPage: (after: string | null, limit: number, wantTotal: boolean) => Promise<Page<T>>,
  keyOf: (row: T) => string,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = [];
  let limit = pageSize;
  let after: string | null = null;

  for (let first = true; ; first = false) {
    const { rows, total } = await fetchPage(after, limit, first);
    all.push(...rows);
    if (rows.length === 0) break;

    // The server capped us below what we asked for: adopt its cap as the limit,
    // so "shorter than the limit" keeps meaning "no more rows".
    if (first && rows.length < limit && typeof total === "number" && total > rows.length) {
      limit = rows.length;
    } else if (rows.length < limit) {
      break;
    }
    after = keyOf(rows[rows.length - 1]);
  }
  return all;
}
