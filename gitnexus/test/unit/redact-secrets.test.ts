/**
 * Regression tests for the LLM error / wiki output secret redactor.
 *
 * Locks in GitNexus-nl0 / GitNexus-qat: API keys returned in error
 * bodies (or thrown by the underlying HTTP client into err.message)
 * must not survive into terminal / CI log output.
 */
import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../../src/core/wiki/llm-client.js';

describe('redactSecrets (GitNexus-nl0, GitNexus-qat)', () => {
  it('redacts Bearer tokens', () => {
    const out = redactSecrets(
      'HTTP 401: Authorization: Bearer sk-ant-api03-AbCdEfGhIjKlMnOp1234567890_-+/=',
    );
    expect(out).not.toMatch(/Bearer\s+sk-/);
    expect(out).toContain('Bearer [REDACTED]');
  });

  it('redacts X-Api-Key header values', () => {
    const out = redactSecrets('Headers: { x-api-key: abcdef1234567890_secret }');
    expect(out).not.toMatch(/abcdef1234567890_secret/);
    expect(out).toMatch(/x-api-key/);
    expect(out).toContain('[REDACTED]');
  });

  it('redacts api_key= JSON-style assignments', () => {
    const out = redactSecrets('{"api_key": "sk-proj-zzzz_yyyy_xxxx_wwww_vvvv"}');
    expect(out).not.toMatch(/zzzz/);
    expect(out).toContain('[REDACTED]');
  });

  it('redacts standalone OpenAI / OpenRouter / Anthropic key shapes', () => {
    expect(redactSecrets('Use sk-1234567890abcdefghij to authenticate.')).not.toMatch(
      /sk-1234567890/,
    );
    expect(
      redactSecrets('Bad key sk-or-v1-abcdef1234567890ghijklmnop reported by upstream.'),
    ).not.toMatch(/sk-or-v1-abcdef/);
    expect(
      redactSecrets('Anthropic returned sk-ant-api03-AbCdEfGhIjKlMnOp1234567890.'),
    ).not.toMatch(/sk-ant-api03-AbCdEfGhIjKlMnOp/);
  });

  it('preserves non-secret content', () => {
    const out = redactSecrets('LLM API error (429): rate limit exceeded — try again later');
    expect(out).toContain('rate limit exceeded');
    expect(out).toContain('429');
  });

  it('handles empty / null-ish input safely', () => {
    expect(redactSecrets('')).toBe('');
    // @ts-expect-error — runtime safety check
    expect(redactSecrets(undefined)).toBeUndefined();
  });
});
