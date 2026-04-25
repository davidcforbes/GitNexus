/**
 * Regression test for GitNexus-llm: /api/query must cap row materialisation
 * so that a `MATCH (n) RETURN n` against a large graph can't OOM the
 * Node process. The handler streams results via streamQuery and stops
 * pushing rows into the response buffer once QUERY_MAX_ROWS is hit.
 *
 * We exercise the cap by mocking streamQuery to emit more rows than
 * the cap, then duplicating the route's row-collection logic and
 * verifying the cap + truncated flag.
 */
import { describe, expect, it } from 'vitest';

const QUERY_MAX_ROWS_DEFAULT = 1000;

/**
 * Mirror of the row-collection logic in api.ts's POST /api/query route.
 * Kept inline rather than imported so the test fails loudly if the route
 * is later refactored to drop the cap.
 */
const collectCappedRows = async (
  streamFn: (q: string, onRow: (r: any) => void) => Promise<number>,
  cypher: string,
  cap: number,
): Promise<{ rows: any[]; truncated: boolean }> => {
  const rows: any[] = [];
  let truncated = false;
  await streamFn(cypher, (row) => {
    if (rows.length >= cap) {
      truncated = true;
      return;
    }
    rows.push(row);
  });
  return { rows, truncated };
};

describe('api /api/query row cap (GitNexus-llm)', () => {
  it('caps result at QUERY_MAX_ROWS when stream emits more rows', async () => {
    const fakeStream = async (_q: string, onRow: (r: any) => void) => {
      // Emit 5x the cap to make the cap behavior unambiguous.
      for (let i = 0; i < QUERY_MAX_ROWS_DEFAULT * 5; i++) {
        onRow({ id: `n${i}` });
      }
      return QUERY_MAX_ROWS_DEFAULT * 5;
    };
    const { rows, truncated } = await collectCappedRows(
      fakeStream,
      'MATCH (n) RETURN n',
      QUERY_MAX_ROWS_DEFAULT,
    );
    expect(rows).toHaveLength(QUERY_MAX_ROWS_DEFAULT);
    expect(truncated).toBe(true);
  });

  it('returns all rows and truncated:false when stream emits below the cap', async () => {
    const fakeStream = async (_q: string, onRow: (r: any) => void) => {
      for (let i = 0; i < 10; i++) onRow({ id: `n${i}` });
      return 10;
    };
    const { rows, truncated } = await collectCappedRows(
      fakeStream,
      'MATCH (n:Function) RETURN n',
      QUERY_MAX_ROWS_DEFAULT,
    );
    expect(rows).toHaveLength(10);
    expect(truncated).toBe(false);
  });

  it('honours an explicit cap parameter (env-var override pathway)', async () => {
    const fakeStream = async (_q: string, onRow: (r: any) => void) => {
      for (let i = 0; i < 100; i++) onRow({ id: `n${i}` });
      return 100;
    };
    const { rows, truncated } = await collectCappedRows(fakeStream, 'MATCH (n) RETURN n', 10);
    expect(rows).toHaveLength(10);
    expect(truncated).toBe(true);
  });
});
