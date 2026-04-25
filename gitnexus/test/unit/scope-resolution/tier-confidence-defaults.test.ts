/**
 * GitNexus-4ks regression: lock in the alignment between TIER_CONFIDENCE
 * and the scope-resolution edge emitter's defaults.
 *
 * Background: prior to this fix, tryEmitEdge defaulted confidence to a
 * magic 0.85 that wasn't in the TIER_CONFIDENCE table, and
 * receiver-bound-calls.ts:289 emitted CALLS edges at 0.85 even when the
 * resolution was clearly same-file (legacy DAG emitted same-file CALLS at
 * 0.95). The result was a visible parity-gate divergence between the
 * legacy DAG and the scope-resolution path for migrated languages.
 *
 * These assertions are intentionally tight — if a future refactor
 * reintroduces the 0.85 magic number, the parity gate will fail loudly
 * rather than silently emit divergent edges.
 */
import { describe, expect, it } from 'vitest';
import { TIER_CONFIDENCE } from '../../../src/core/ingestion/model/resolution-context.js';

describe('TIER_CONFIDENCE values (GitNexus-4ks)', () => {
  it('exposes the canonical tier scale', () => {
    expect(TIER_CONFIDENCE['same-file']).toBe(0.95);
    expect(TIER_CONFIDENCE['import-scoped']).toBe(0.9);
    expect(TIER_CONFIDENCE['global']).toBe(0.5);
  });

  it('does NOT contain the legacy 0.85 magic number that caused parity drift', () => {
    const values = new Set(Object.values(TIER_CONFIDENCE));
    expect(values.has(0.85)).toBe(false);
  });
});

describe('tryEmitEdge default confidence (GitNexus-4ks)', () => {
  it('defaults to TIER_CONFIDENCE.import-scoped (0.9) — not the old 0.85', async () => {
    // The default lives in the function signature itself. We can't easily
    // call tryEmitEdge here without a full graph + scope fixture, so we
    // assert the source-of-truth: read the file and confirm the default
    // expression references TIER_CONFIDENCE['import-scoped'] rather than
    // a literal number.
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const edgesPath = path.resolve(
      __dirname,
      '../../../src/core/ingestion/scope-resolution/graph-bridge/edges.ts',
    );
    const src = await readFile(edgesPath, 'utf-8');
    expect(src).toContain("confidence: number = TIER_CONFIDENCE['import-scoped']");
    // Belt-and-suspenders: the file must NOT contain the old default.
    expect(src).not.toMatch(/confidence\s*=\s*0\.85/);
  });
});

describe('receiver-bound-calls confidence (GitNexus-4ks)', () => {
  it('uses TIER_CONFIDENCE for the same-file vs cross-file CALLS branch', async () => {
    // Same source-of-truth assertion: confirm the file uses the
    // TIER_CONFIDENCE constants in the receiver-call branch rather than
    // the previous flat 0.85.
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const filePath = path.resolve(
      __dirname,
      '../../../src/core/ingestion/scope-resolution/passes/receiver-bound-calls.ts',
    );
    const src = await readFile(filePath, 'utf-8');
    expect(src).toContain("TIER_CONFIDENCE['same-file']");
    expect(src).toContain("TIER_CONFIDENCE['import-scoped']");
    // The CALLS branch (line ~289) must no longer contain the inline
    // `? 1.0 : 0.85` ternary. The 0.85 used elsewhere in the file
    // (heuristic / global-tier sites) is intentional and stays.
    expect(src).not.toMatch(/site\.kind === ['"]read['"]\s*\?\s*1\.0\s*:\s*0\.85/);
  });
});
