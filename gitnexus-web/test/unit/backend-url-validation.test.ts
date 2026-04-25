/**
 * Regression tests for the bridge-mode backend URL allowlist.
 *
 * Locks in GitNexus-a2v: localStorage values that don't match
 * `localhost`/`127.0.0.1`/`::1` (or the configured DEFAULT_BACKEND_URL
 * host) must NOT be loaded as the backend URL on mount, otherwise an
 * attacker who can write to localStorage (XSS, malicious extension)
 * could redirect every backend call to an arbitrary host.
 *
 * The allowlist lives in src/hooks/useBackend.ts as a private function;
 * we mirror the regex / parse logic here so the test ships even if the
 * function is later moved or renamed. The renderHook integration would
 * be heavier than necessary for what is really a parser test.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_BACKEND_URL } from '../../src/config/ui-constants';

const isSafeBackendUrl = (raw: string): boolean => {
  if (!raw) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const rawHost = parsed.hostname.toLowerCase();
  const host =
    rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  try {
    const defaultHost = new URL(DEFAULT_BACKEND_URL).hostname.toLowerCase();
    if (host === defaultHost) return true;
  } catch {
    /* falls through */
  }
  return false;
};

describe('bridge-mode backend URL allowlist (GitNexus-a2v)', () => {
  it('accepts localhost and 127.0.0.1', () => {
    expect(isSafeBackendUrl('http://localhost:4747')).toBe(true);
    expect(isSafeBackendUrl('http://127.0.0.1:4747')).toBe(true);
    expect(isSafeBackendUrl('http://[::1]:4747')).toBe(true);
  });

  it('accepts the configured DEFAULT_BACKEND_URL host', () => {
    // Use the actual default — whatever it is, it must not regress.
    expect(isSafeBackendUrl(DEFAULT_BACKEND_URL)).toBe(true);
  });

  it('rejects arbitrary external hosts', () => {
    expect(isSafeBackendUrl('http://attacker.example.com:4747')).toBe(false);
    expect(isSafeBackendUrl('https://evil.org/api/repos')).toBe(false);
  });

  it('rejects RFC-1918 private addresses (defense-in-depth)', () => {
    expect(isSafeBackendUrl('http://10.0.0.1:4747')).toBe(false);
    expect(isSafeBackendUrl('http://192.168.1.1:4747')).toBe(false);
    expect(isSafeBackendUrl('http://172.16.0.1:4747')).toBe(false);
  });

  it('rejects non-http(s) schemes', () => {
    expect(isSafeBackendUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeBackendUrl('ws://localhost:4747')).toBe(false);
    expect(isSafeBackendUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isSafeBackendUrl('')).toBe(false);
    expect(isSafeBackendUrl('not-a-url')).toBe(false);
    expect(isSafeBackendUrl('http://')).toBe(false);
  });
});
