import { describe, expect, it } from "vitest";

import { fetchAllByKey, type Page } from "./paginate";

interface Row { id: string }

const ids = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(6, "0") }));

/** A PostgREST-like listing: ordered by id, filtered by `id > after`, and
 *  truncated at min(limit, serverCap) with no indication that it was. */
function server(table: () => Row[], serverCap: number) {
  const calls: { after: string | null; limit: number; wantTotal: boolean }[] = [];
  const fetchPage = async (after: string | null, limit: number, wantTotal: boolean): Promise<Page<Row>> => {
    calls.push({ after, limit, wantTotal });
    const matching = table().filter((r) => after === null || r.id > after).sort((a, b) => (a.id < b.id ? -1 : 1));
    return { rows: matching.slice(0, Math.min(limit, serverCap)), total: wantTotal ? matching.length : undefined };
  };
  return { fetchPage, calls };
}

const keyOf = (r: Row) => r.id;

describe("fetchAllByKey", () => {
  it("returns a small listing in one request", async () => {
    const rows = ids(7);
    const s = server(() => rows, 1000);
    expect(await fetchAllByKey(s.fetchPage, keyOf, 1000)).toHaveLength(7);
    expect(s.calls).toHaveLength(1);
  });

  it("reads past the server cap instead of stopping at the first page", async () => {
    const rows = ids(2500);
    const s = server(() => rows, 1000);
    const got = await fetchAllByKey(s.fetchPage, keyOf, 1000);
    expect(got.map(keyOf)).toEqual(rows.map(keyOf));
    expect(s.calls).toHaveLength(3); // 1000 + 1000 + 500 — no trailing empty page
  });

  it("asks for the total only once", async () => {
    const s = server(() => ids(2500), 1000);
    await fetchAllByKey(s.fetchPage, keyOf, 1000);
    expect(s.calls.map((c) => c.wantTotal)).toEqual([true, false, false]);
  });

  it("still reads everything when the server cap is LOWER than the page size", async () => {
    const rows = ids(1234);
    const s = server(() => rows, 100); // e.g. max_rows lowered on the dashboard
    const got = await fetchAllByKey(s.fetchPage, keyOf, 1000);
    expect(got).toHaveLength(1234);
    expect(new Set(got.map(keyOf)).size).toBe(1234);
  });

  it("handles a listing that is an exact multiple of the page size", async () => {
    const s = server(() => ids(2000), 1000);
    expect(await fetchAllByKey(s.fetchPage, keyOf, 1000)).toHaveLength(2000);
  });

  it("never skips a surviving row when an earlier row is deleted mid-walk", async () => {
    // Offset pagination would shift every later row up by one here and skip
    // the first row of page two — which the sync engine would then delete.
    let rows = ids(2500);
    const s = server(() => rows, 1000);
    const original = s.fetchPage;
    let page = 0;
    const fetchPage: typeof original = async (after, limit, wantTotal) => {
      const res = await original(after, limit, wantTotal);
      if (page++ === 0) rows = rows.filter((r) => r.id !== "000003"); // deleted after page one
      return res;
    };
    const got = new Set((await fetchAllByKey(fetchPage, keyOf, 1000)).map(keyOf));
    for (const r of rows) expect(got.has(r.id)).toBe(true);
  });

  it("returns an empty list for an empty table", async () => {
    const s = server(() => [], 1000);
    expect(await fetchAllByKey(s.fetchPage, keyOf, 1000)).toEqual([]);
  });
});
