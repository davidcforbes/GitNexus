/**
 * Standard import path resolution.
 * Handles relative imports, path alias rewriting, and generic suffix matching.
 * Used as the fallback when language-specific resolvers don't match.
 */

import type { SuffixIndex } from './utils.js';
import { tryResolveWithExtensions, suffixResolve } from './utils.js';
import { SupportedLanguages } from 'gitnexus-shared';
import type { ImportResult, ImportResolverStrategy, ResolveCtx } from './types.js';
import type { TsconfigPaths } from '../language-config.js';
import { getImportBehavior } from './per-language-behavior.js';

/** Max entries in the resolve cache. Beyond this, entries are evicted.
 *  100K entries ≈ 15MB — covers the most common import patterns. */
export const RESOLVE_CACHE_CAP = 100_000;

/**
 * Resolve an import path to a file path in the repository.
 *
 * Language-specific preprocessing is applied before the generic resolution:
 * - TypeScript/JavaScript: rewrites tsconfig path aliases
 * - Rust: converts crate::/super::/self:: to relative paths
 *
 * Java wildcards and Go package imports are handled separately in processImports
 * because they resolve to multiple files.
 */
export const resolveImportPath = (
  currentFile: string,
  importPath: string,
  allFiles: Set<string>,
  allFileList: string[],
  normalizedFileList: string[],
  resolveCache: Map<string, string | null>,
  language: SupportedLanguages,
  tsconfigPaths: TsconfigPaths | null,
  index?: SuffixIndex,
): string | null => {
  const cacheKey = `${currentFile}::${importPath}`;
  if (resolveCache.has(cacheKey)) return resolveCache.get(cacheKey) ?? null;

  const cache = (result: string | null): string | null => {
    // Evict oldest 20% when cap is reached instead of clearing all
    if (resolveCache.size >= RESOLVE_CACHE_CAP) {
      const evictCount = Math.floor(RESOLVE_CACHE_CAP * 0.2);
      const iter = resolveCache.keys();
      for (let i = 0; i < evictCount; i++) {
        const key = iter.next().value;
        if (key !== undefined) resolveCache.delete(key);
      }
    }
    resolveCache.set(cacheKey, result);
    return result;
  };

  // GitNexus-u5y: per-language preprocessing dispatch via the registry
  // table in per-language-behavior.ts — no `if (language === ...)`
  // switches in this shared file.
  const behavior = getImportBehavior(language);

  // Path-alias rewrite (TS / JS via tsconfig). On a hit, try direct
  // resolution against the rewritten path then suffix-match; if both
  // miss, fall through to the generic resolver below.
  const aliasHit = behavior.rewriteAliasPath?.(importPath, tsconfigPaths);
  if (aliasHit) {
    const resolved = tryResolveWithExtensions(aliasHit.rewritten, allFiles);
    if (resolved) return cache(resolved);
    const parts = aliasHit.rewritten.split('/').filter(Boolean);
    const suffixResult = suffixResolve(parts, normalizedFileList, allFileList, index);
    if (suffixResult) return cache(suffixResult);
  }

  // Module-path rewrite (Rust crate::/super::, including grouped
  // imports). On a direct resolution hit, return immediately;
  // otherwise fall through to the generic resolver.
  const modulePathHit = behavior.rewriteModulePath?.(importPath, currentFile, allFiles);
  if (modulePathHit) {
    return cache(modulePathHit.resolved);
  }

  // ---- Generic relative import resolution (./ and ../) ----
  const currentDir = currentFile.split('/').slice(0, -1);
  const parts = importPath.split('/');

  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      currentDir.pop();
    } else {
      currentDir.push(part);
    }
  }

  const basePath = currentDir.join('/');

  if (importPath.startsWith('.')) {
    const resolved = tryResolveWithExtensions(basePath, allFiles);
    return cache(resolved);
  }

  // ---- Generic package/absolute import resolution (suffix matching) ----
  // Java wildcards are handled in processImports, not here
  if (importPath.endsWith('.*')) {
    return cache(null);
  }

  // GitNexus-u5y: dot-handling decision lives on the per-language
  // behavior. C/C++ #include directives use literal paths like
  // "animal.h"; everywhere else, dots are package-segment separators
  // and convert to slashes for suffix matching.
  const preserveLiteralDots = behavior.preserveLiteralDots ?? false;
  const pathLike =
    importPath.includes('/') || preserveLiteralDots
      ? importPath
      : importPath.replace(/\./g, '/');
  const pathParts = pathLike.split('/').filter(Boolean);

  const resolved = suffixResolve(pathParts, normalizedFileList, allFileList, index);
  return cache(resolved);
};

// ============================================================================
// Per-language dispatch functions (moved from import-resolution.ts)
// ============================================================================

/**
 * Standard single-file resolution (TS/JS/C/C++ and fallback for other languages).
 * Handles relative imports, tsconfig path aliases, and suffix matching.
 */
export function resolveStandard(
  rawImportPath: string,
  filePath: string,
  ctx: ResolveCtx,
  language: SupportedLanguages,
): ImportResult {
  const resolvedPath = resolveImportPath(
    filePath,
    rawImportPath,
    ctx.allFilePaths,
    ctx.allFileList,
    ctx.normalizedFileList,
    ctx.resolveCache,
    language,
    ctx.configs.tsconfigPaths,
    ctx.index,
  );
  return resolvedPath ? { kind: 'files', files: [resolvedPath] } : null;
}

// ============================================================================
// Strategy factory — composable hook for ImportResolutionConfig
// ============================================================================

/** Create a reusable standard-resolution strategy for a given language. */
export function createStandardStrategy(language: SupportedLanguages): ImportResolverStrategy {
  return (raw, fp, ctx) => resolveStandard(raw, fp, ctx, language);
}
