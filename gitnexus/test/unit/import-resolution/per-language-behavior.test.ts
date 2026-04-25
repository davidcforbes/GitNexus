/**
 * GitNexus-u5y regression: lock in the per-language-behavior registry that
 * replaced the three named-language branches in import-resolvers/standard.ts.
 *
 * Before this fix, `resolveImportPath` had three hardcoded
 * `language === SupportedLanguages.X` branches:
 *   1. TS / JS — tsconfig path-alias rewriting
 *   2. Rust — crate::/super::/self:: → relative-path rewriting
 *   3. C / C++ — preserve literal dots in include paths
 *
 * Per AGENTS.md ("shared pipeline code in core/ingestion/ must not name
 * languages"), these now live in the per-language-behavior registry.
 *
 * These tests pin both the registry contract and the absence of the
 * named-language branches in shared code.
 */
import { describe, expect, it } from 'vitest';
import { SupportedLanguages } from 'gitnexus-shared';
import { getImportBehavior } from '../../../src/core/ingestion/import-resolvers/per-language-behavior.js';

describe('per-language import behavior registry (GitNexus-u5y)', () => {
  it('TypeScript and JavaScript both expose tsconfig alias rewriting', () => {
    expect(getImportBehavior(SupportedLanguages.TypeScript).rewriteAliasPath).toBeTypeOf(
      'function',
    );
    expect(getImportBehavior(SupportedLanguages.JavaScript).rewriteAliasPath).toBeTypeOf(
      'function',
    );
  });

  it('TS alias rewriter rewrites @app/foo against tsconfig paths', () => {
    const tsconfigPaths = {
      baseUrl: '.',
      aliases: [['@app/', 'src/']] as Array<readonly [string, string]>,
    };
    const result = getImportBehavior(SupportedLanguages.TypeScript).rewriteAliasPath!(
      '@app/feature/index',
      tsconfigPaths,
    );
    expect(result).toEqual({ rewritten: 'src/feature/index' });
  });

  it('TS alias rewriter returns null for relative imports (./)', () => {
    const tsconfigPaths = {
      baseUrl: '.',
      aliases: [['@app/', 'src/']] as Array<readonly [string, string]>,
    };
    const result = getImportBehavior(SupportedLanguages.TypeScript).rewriteAliasPath!(
      './sibling',
      tsconfigPaths,
    );
    expect(result).toBeNull();
  });

  it('TS alias rewriter returns null when no tsconfig is provided', () => {
    const result = getImportBehavior(SupportedLanguages.TypeScript).rewriteAliasPath!(
      '@app/foo',
      null,
    );
    expect(result).toBeNull();
  });

  it('Rust exposes module-path rewriting', () => {
    expect(getImportBehavior(SupportedLanguages.Rust).rewriteModulePath).toBeTypeOf('function');
  });

  it('C and C++ both preserve literal dots in import paths', () => {
    expect(getImportBehavior(SupportedLanguages.C).preserveLiteralDots).toBe(true);
    expect(getImportBehavior(SupportedLanguages.CPlusPlus).preserveLiteralDots).toBe(true);
  });

  it('Languages without special behavior return an empty record', () => {
    const behavior = getImportBehavior(SupportedLanguages.Java);
    expect(behavior.rewriteAliasPath).toBeUndefined();
    expect(behavior.rewriteModulePath).toBeUndefined();
    expect(behavior.preserveLiteralDots ?? false).toBe(false);
  });
});

describe('shared standard.ts no longer names languages (GitNexus-u5y)', () => {
  it('contains no `language === SupportedLanguages.<X>` branches', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const filePath = path.resolve(
      __dirname,
      '../../../src/core/ingestion/import-resolvers/standard.ts',
    );
    const src = await readFile(filePath, 'utf-8');
    expect(src).not.toMatch(/language\s*===\s*SupportedLanguages\.\w+/);
    // The previous Rust-import internal helper import is also gone —
    // it now lives only in per-language-behavior.ts.
    expect(src).not.toContain('resolveRustImportInternal');
  });
});
