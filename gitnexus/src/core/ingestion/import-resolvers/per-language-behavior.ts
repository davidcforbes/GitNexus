/**
 * Per-language import-resolution behaviour table (GitNexus-u5y).
 *
 * The shared `resolveImportPath` in `standard.ts` previously had three
 * named-language `if` branches:
 *   - `language === SupportedLanguages.TypeScript || JavaScript` →
 *      tsconfig path-alias rewriting
 *   - `language === SupportedLanguages.Rust` →
 *      crate::/super::/self:: → relative-path rewriting
 *   - `language === SupportedLanguages.C || CPlusPlus` →
 *      treat dots in the import path as literal (don't convert to slashes)
 *
 * Per AGENTS.md ("shared pipeline code in core/ingestion/ must not name
 * languages"), the shared resolver now consults this single registry
 * via `getImportBehavior(language)` instead of switching directly. This
 * file is the per-language registry — it CAN name languages because it
 * is the language-aware glue that the shared resolver dispatches into.
 *
 * Default behaviour (any language not in the table) has no preprocessing
 * and converts dots to slashes for suffix matching.
 */
import { SupportedLanguages } from 'gitnexus-shared';
import type { TsconfigPaths } from '../language-config.js';
import { resolveRustImportInternal } from './rust.js';

/**
 * Per-language preprocessing applied INSIDE `resolveImportPath` before
 * the generic relative/suffix resolution runs.
 */
export interface ImportResolverBehavior {
  /**
   * tsconfig path-alias rewriting (TS / JS). Receives the raw import
   * path and the parsed tsconfigPaths; returns either:
   *   - { rewritten: string } — pass the rewritten path through to the
   *     downstream resolveWithExtensions / suffixResolve passes
   *   - null — no alias matched, fall through to the generic resolver
   *
   * Implementation lives here so the language test (which prefix
   * matched, baseUrl handling, etc.) doesn't pollute the shared
   * resolver.
   */
  readonly rewriteAliasPath?: (
    importPath: string,
    tsconfigPaths: TsconfigPaths | null,
  ) => { rewritten: string } | null;

  /**
   * Module-path syntax preprocessing (Rust `crate::/super::/self::` →
   * relative file paths, including grouped imports like
   * `crate::a::{b, c}`). Returns:
   *   - { resolved: string } — direct hit; resolveImportPath returns it
   *   - null — no match; fall through to the generic resolver
   */
  readonly rewriteModulePath?: (
    importPath: string,
    currentFile: string,
    allFiles: Set<string>,
  ) => { resolved: string } | null;

  /**
   * When true, dots in the import path are treated as literal characters
   * (the path is `animal.h`, not the package `animal/h`). C / C++ #include
   * directives behave this way; most other languages use dots as
   * package-segment separators.
   */
  readonly preserveLiteralDots?: boolean;
}

const EMPTY_BEHAVIOR: ImportResolverBehavior = Object.freeze({});

const TYPESCRIPT_JS_ALIAS_REWRITE = (
  importPath: string,
  tsconfigPaths: TsconfigPaths | null,
): { rewritten: string } | null => {
  if (!tsconfigPaths || importPath.startsWith('.')) return null;
  for (const [aliasPrefix, targetPrefix] of tsconfigPaths.aliases) {
    if (!importPath.startsWith(aliasPrefix)) continue;
    const remainder = importPath.slice(aliasPrefix.length);
    const rewritten =
      tsconfigPaths.baseUrl === '.'
        ? targetPrefix + remainder
        : tsconfigPaths.baseUrl + '/' + targetPrefix + remainder;
    return { rewritten };
  }
  return null;
};

const TYPESCRIPT_BEHAVIOR: ImportResolverBehavior = Object.freeze({
  rewriteAliasPath: TYPESCRIPT_JS_ALIAS_REWRITE,
});

const RUST_BEHAVIOR: ImportResolverBehavior = Object.freeze({
  rewriteModulePath: (importPath, currentFile, allFiles) => {
    // Handle grouped imports: use crate::module::{Foo, Bar, Baz}
    // — extract the prefix path before ::{...} and resolve that.
    let rustImportPath = importPath;
    const braceIdx = importPath.indexOf('::{');
    if (braceIdx !== -1) {
      rustImportPath = importPath.substring(0, braceIdx);
    } else if (importPath.startsWith('{') && importPath.endsWith('}')) {
      // Top-level grouped imports: use {crate::a, crate::b}
      // Iterate each part and return the first that resolves.
      const inner = importPath.slice(1, -1);
      const parts = inner
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      for (const part of parts) {
        const partResult = resolveRustImportInternal(currentFile, part, allFiles);
        if (partResult) return { resolved: partResult };
      }
      return null;
    }
    const rustResult = resolveRustImportInternal(currentFile, rustImportPath, allFiles);
    return rustResult ? { resolved: rustResult } : null;
  },
});

const CPP_BEHAVIOR: ImportResolverBehavior = Object.freeze({
  preserveLiteralDots: true,
});

const BEHAVIOR_TABLE: ReadonlyMap<SupportedLanguages, ImportResolverBehavior> = new Map<
  SupportedLanguages,
  ImportResolverBehavior
>([
  [SupportedLanguages.TypeScript, TYPESCRIPT_BEHAVIOR],
  [SupportedLanguages.JavaScript, TYPESCRIPT_BEHAVIOR],
  [SupportedLanguages.Rust, RUST_BEHAVIOR],
  [SupportedLanguages.C, CPP_BEHAVIOR],
  [SupportedLanguages.CPlusPlus, CPP_BEHAVIOR],
]);

/** Return the per-language import-resolver behaviour, or an empty record
 *  if the language has no special preprocessing. */
export const getImportBehavior = (language: SupportedLanguages): ImportResolverBehavior =>
  BEHAVIOR_TABLE.get(language) ?? EMPTY_BEHAVIOR;
