/**
 * Unit Tests: CORS origin allowlist
 *
 * Tests isAllowedOrigin() from server/api.ts, which controls which HTTP
 * Origins are permitted by the Express CORS middleware.
 *
 * Policy (default):
 *   - No origin (non-browser)         → allowed
 *   - http(s)://localhost / 127.0.0.1 / [::1]  → allowed
 *   - https://gitnexus.vercel.app     → allowed
 *   - RFC 1918 LAN ranges             → REJECTED (was allowed pre-GitNexus-y28)
 *   - Everything else                 → rejected
 *
 * With GITNEXUS_ALLOW_LAN_ORIGINS=1:
 *   - https://10.x|172.16-31|192.168.x  → allowed
 *   - http://<any LAN host>             → still rejected (HTTPS required)
 */
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { isAllowedOrigin } from '../../src/server/api.js';

// ─── No origin (non-browser / curl) ──────────────────────────────────

describe('isAllowedOrigin: no origin', () => {
  it('allows undefined origin (curl, server-to-server)', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
  });
});

// ─── Localhost variants ───────────────────────────────────────────────

describe('isAllowedOrigin: localhost', () => {
  it('allows http://localhost:3000', () => {
    expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
  });

  it('allows http://localhost:5173 (Vite default)', () => {
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
  });

  it('allows http://localhost:8080', () => {
    expect(isAllowedOrigin('http://localhost:8080')).toBe(true);
  });

  it('allows http://127.0.0.1:3000', () => {
    expect(isAllowedOrigin('http://127.0.0.1:3000')).toBe(true);
  });

  it('allows http://127.0.0.1:5173', () => {
    expect(isAllowedOrigin('http://127.0.0.1:5173')).toBe(true);
  });

  it('allows http://localhost without port', () => {
    expect(isAllowedOrigin('http://localhost')).toBe(true);
  });

  it('allows http://127.0.0.1 without port', () => {
    expect(isAllowedOrigin('http://127.0.0.1')).toBe(true);
  });

  it('allows IPv6 loopback http://[::1]:3000', () => {
    expect(isAllowedOrigin('http://[::1]:3000')).toBe(true);
  });

  it('allows IPv6 loopback http://[::1] without port', () => {
    expect(isAllowedOrigin('http://[::1]')).toBe(true);
  });

  it('allows https://localhost (covers self-signed dev TLS)', () => {
    expect(isAllowedOrigin('https://localhost:8443')).toBe(true);
  });
});

// ─── Deployed site ────────────────────────────────────────────────────

describe('isAllowedOrigin: vercel.app', () => {
  it('allows https://gitnexus.vercel.app', () => {
    expect(isAllowedOrigin('https://gitnexus.vercel.app')).toBe(true);
  });

  it('rejects other vercel.app subdomains', () => {
    expect(isAllowedOrigin('https://evil.vercel.app')).toBe(false);
  });
});

// ─── GitNexus-y28: LAN origins are off by default ────────────────────

describe('isAllowedOrigin: RFC 1918 default-deny (GitNexus-y28)', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.GITNEXUS_ALLOW_LAN_ORIGINS;
    delete process.env.GITNEXUS_ALLOW_LAN_ORIGINS;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.GITNEXUS_ALLOW_LAN_ORIGINS;
    else process.env.GITNEXUS_ALLOW_LAN_ORIGINS = saved;
  });

  it('rejects http://10.0.0.1:3000 by default', () => {
    expect(isAllowedOrigin('http://10.0.0.1:3000')).toBe(false);
  });

  it('rejects http://172.16.0.1:3000 by default', () => {
    expect(isAllowedOrigin('http://172.16.0.1:3000')).toBe(false);
  });

  it('rejects http://192.168.1.100:5173 by default', () => {
    expect(isAllowedOrigin('http://192.168.1.100:5173')).toBe(false);
  });

  it('rejects https://10.0.0.1 even when LAN is disabled', () => {
    expect(isAllowedOrigin('https://10.0.0.1')).toBe(false);
  });
});

// ─── GitNexus-y28: LAN opt-in requires HTTPS ─────────────────────────

describe('isAllowedOrigin: RFC 1918 with GITNEXUS_ALLOW_LAN_ORIGINS=1', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.GITNEXUS_ALLOW_LAN_ORIGINS;
    process.env.GITNEXUS_ALLOW_LAN_ORIGINS = '1';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.GITNEXUS_ALLOW_LAN_ORIGINS;
    else process.env.GITNEXUS_ALLOW_LAN_ORIGINS = saved;
  });

  it('still rejects http://10.0.0.1:3000 (HTTPS required even when enabled)', () => {
    expect(isAllowedOrigin('http://10.0.0.1:3000')).toBe(false);
  });

  it('allows https://10.0.0.1:3000', () => {
    expect(isAllowedOrigin('https://10.0.0.1:3000')).toBe(true);
  });

  it('allows https://10.255.255.255:8080', () => {
    expect(isAllowedOrigin('https://10.255.255.255:8080')).toBe(true);
  });

  it('allows https://172.16.0.1:3000 (lower bound)', () => {
    expect(isAllowedOrigin('https://172.16.0.1:3000')).toBe(true);
  });

  it('allows https://172.31.255.255:3000 (upper bound)', () => {
    expect(isAllowedOrigin('https://172.31.255.255:3000')).toBe(true);
  });

  it('rejects https://172.15.0.1:3000 (below RFC 1918 range)', () => {
    expect(isAllowedOrigin('https://172.15.0.1:3000')).toBe(false);
  });

  it('rejects https://172.32.0.1:3000 (above RFC 1918 range)', () => {
    expect(isAllowedOrigin('https://172.32.0.1:3000')).toBe(false);
  });

  it('allows https://192.168.0.1:3000', () => {
    expect(isAllowedOrigin('https://192.168.0.1:3000')).toBe(true);
  });

  it('rejects https://192.167.1.1 (adjacent, not private)', () => {
    expect(isAllowedOrigin('https://192.167.1.1')).toBe(false);
  });

  it('rejects https://192.169.1.1 (adjacent, not private)', () => {
    expect(isAllowedOrigin('https://192.169.1.1')).toBe(false);
  });
});

// ─── Public / untrusted origins ───────────────────────────────────────

describe('isAllowedOrigin: rejected origins', () => {
  it('rejects https://evil.com', () => {
    expect(isAllowedOrigin('https://evil.com')).toBe(false);
  });

  it('rejects https://example.com', () => {
    expect(isAllowedOrigin('https://example.com')).toBe(false);
  });

  it('rejects http://8.8.8.8:3000 (Google DNS, public IP)', () => {
    expect(isAllowedOrigin('http://8.8.8.8:3000')).toBe(false);
  });

  it('rejects https://gitnexus.example.com (not the official domain)', () => {
    expect(isAllowedOrigin('https://gitnexus.example.com')).toBe(false);
  });

  it('rejects malformed origin string', () => {
    expect(isAllowedOrigin('not-a-url')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isAllowedOrigin('')).toBe(false);
  });

  it('rejects non-HTTP(S) origins from private IPs', () => {
    expect(isAllowedOrigin('ftp://10.0.0.1')).toBe(false);
    expect(isAllowedOrigin('ftp://192.168.1.1')).toBe(false);
  });
});
