/**
 * GitNexus-1lg regression: lock in the LanguageProvider-hook architecture
 * for auxiliary call extraction.
 *
 * Before this fix, the Vue branch — emit CALLS edges for PascalCase
 * components named in <template> — was duplicated as a hardcoded
 * `if (language === SupportedLanguages.Vue)` block in BOTH
 * call-processor.ts (sequential path) AND workers/parse-worker.ts
 * (worker path), violating AGENTS.md's "shared pipeline code in
 * gitnexus/src/core/ingestion/ must not name languages" rule.
 *
 * The fix: a new optional `auxiliaryCallNamesFromSource(content)` hook
 * on LanguageProvider; Vue implements it by delegating to
 * extractTemplateComponents; both call sites in shared code consult the
 * hook generically and the language name no longer appears in either
 * branch.
 *
 * These tests pin the hook contract + the Vue implementation + the
 * absence of the language-naming branches in shared code.
 */
import { describe, expect, it } from 'vitest';
import { vueProvider } from '../../src/core/ingestion/languages/vue.js';
import { typescriptProvider } from '../../src/core/ingestion/languages/typescript.js';

describe('auxiliaryCallNamesFromSource hook (GitNexus-1lg)', () => {
  it('Vue provider implements the hook', () => {
    expect(typeof vueProvider.auxiliaryCallNamesFromSource).toBe('function');
  });

  it('Vue hook returns the components named in <template>', () => {
    const sfc = `
<script setup lang="ts">
import HeaderBar from './HeaderBar.vue';
import UserCard from './UserCard.vue';
</script>
<template>
  <div>
    <HeaderBar />
    <UserCard :user="user" />
  </div>
</template>
`;
    const names = vueProvider.auxiliaryCallNamesFromSource!(sfc);
    expect(Array.from(names)).toEqual(expect.arrayContaining(['HeaderBar', 'UserCard']));
  });

  it('non-Vue providers do NOT implement the hook by default', () => {
    // The whole point of the refactor is that auxiliary extraction is
    // opt-in. TypeScript shouldn't grow a Vue-style branch implicitly.
    expect(typescriptProvider.auxiliaryCallNamesFromSource).toBeUndefined();
  });
});

describe('shared ingestion code no longer names Vue (GitNexus-1lg)', () => {
  // Source-of-truth assertions: confirm the call-resolution branches
  // that previously hardcoded `language === SupportedLanguages.Vue` are
  // gone. The remaining Vue references in parse-worker.ts (parser map,
  // SFC <script>-extraction) are PARSER-level concerns, not
  // call-resolution; they're out of scope for 1lg.

  it('call-processor.ts has no Vue language branch', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const filePath = path.resolve(
      __dirname,
      '../../src/core/ingestion/call-processor.ts',
    );
    const src = await readFile(filePath, 'utf-8');
    expect(src).not.toMatch(/language\s*===\s*SupportedLanguages\.Vue/);
    // The previous `'vue-template-component'` reason string is also gone
    // (replaced by the generic 'auxiliary-call' reason).
    expect(src).not.toContain('vue-template-component');
  });

  it('parse-worker.ts call-resolution branch no longer names Vue', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const filePath = path.resolve(
      __dirname,
      '../../src/core/ingestion/workers/parse-worker.ts',
    );
    const src = await readFile(filePath, 'utf-8');
    // The CALL-extraction branch that pushed templateComponents into
    // result.calls is gone. The OTHER Vue references (parser map at
    // line ~313, SFC <script> extraction at ~1388, setup-block tag at
    // ~2203) are parser-config concerns, separately tracked.
    expect(src).not.toContain('extractTemplateComponents');
  });
});
