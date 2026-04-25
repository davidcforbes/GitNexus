import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getEmbeddingDims, isEmbedderReady } from '../../src/mcp/core/embedder.js';
import { resolveEmbedderRevision } from '../../src/core/embeddings/embedder.js';
import { DEFAULT_EMBEDDING_CONFIG } from '../../src/core/embeddings/types.js';

describe('embedder', () => {
  describe('getEmbeddingDims', () => {
    it('returns 384 (MiniLM default)', () => {
      expect(getEmbeddingDims()).toBe(384);
    });
  });

  describe('isEmbedderReady', () => {
    it('returns false before initialization', () => {
      expect(isEmbedderReady()).toBe(false);
    });
  });

  // GitNexus-b1j: embedder model revision pinning
  describe('resolveEmbedderRevision (GitNexus-b1j)', () => {
    let savedEnv: string | undefined;

    beforeEach(() => {
      savedEnv = process.env.GITNEXUS_EMBEDDER_REVISION;
      delete process.env.GITNEXUS_EMBEDDER_REVISION;
    });

    afterEach(() => {
      if (savedEnv === undefined) delete process.env.GITNEXUS_EMBEDDER_REVISION;
      else process.env.GITNEXUS_EMBEDDER_REVISION = savedEnv;
    });

    it('returns undefined when no override is set (preserves historical default)', () => {
      expect(resolveEmbedderRevision(null)).toBeUndefined();
      expect(resolveEmbedderRevision(undefined)).toBeUndefined();
      expect(resolveEmbedderRevision('')).toBeUndefined();
    });

    it('uses the EmbeddingConfig.revision when env var is unset', () => {
      expect(resolveEmbedderRevision('abc123')).toBe('abc123');
    });

    it('GITNEXUS_EMBEDDER_REVISION env var wins over config', () => {
      process.env.GITNEXUS_EMBEDDER_REVISION = 'env-sha';
      expect(resolveEmbedderRevision('config-sha')).toBe('env-sha');
      expect(resolveEmbedderRevision(null)).toBe('env-sha');
    });

    it('default config keeps revision as null (no surprise pin shipped)', () => {
      expect(DEFAULT_EMBEDDING_CONFIG.revision).toBeNull();
    });
  });
});
