import { useState, useEffect, useCallback, useRef } from 'react';
import { probeBackend, setBackendUrl as setServiceUrl } from '../services/backend-client';
import { DEFAULT_BACKEND_URL } from '../config/ui-constants';

// ── localStorage keys ────────────────────────────────────────────────────────

const LS_URL_KEY = 'gitnexus-backend-url';

/**
 * Validate a candidate backend URL before we trust it. localStorage is
 * shared with any XSS in the same origin and any browser extension; if a
 * malicious value lands there, we'd otherwise auto-probe and route every
 * subsequent API call to it. Restrict to:
 *   - http(s) scheme
 *   - hostname is exactly "localhost" or 127.0.0.1 (or the configured
 *     DEFAULT_BACKEND_URL host — covers the Docker-bridge default).
 * (GitNexus-a2v)
 */
const isSafeBackendUrl = (raw: string): boolean => {
  if (!raw) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  // Strip surrounding brackets that URL.hostname leaves on IPv6 literals.
  const rawHost = parsed.hostname.toLowerCase();
  const host =
    rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  // Allow the project's configured default (covers users who change
  // DEFAULT_BACKEND_URL via env at build time).
  try {
    const defaultHost = new URL(DEFAULT_BACKEND_URL).hostname.toLowerCase();
    if (host === defaultHost) return true;
  } catch {
    /* falls through to false */
  }
  return false;
};

// ── Public interface ─────────────────────────────────────────────────────────

export interface UseBackendResult {
  /** Backend probe succeeded */
  isConnected: boolean;
  /** Currently checking connection */
  isProbing: boolean;
  /** Current backend URL */
  backendUrl: string;
  /** Start polling for server availability (setTimeout chain, visibility-aware) */
  startPolling: () => void;
  /** Stop polling */
  stopPolling: () => void;
  /** Whether polling is active */
  isPolling: boolean;
}

// ── Hook implementation ──────────────────────────────────────────────────────

export function useBackend(): UseBackendResult {
  const [backendUrl] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(LS_URL_KEY);
      if (stored && isSafeBackendUrl(stored)) return stored;
      // Stored value is missing, malformed, or points outside the safe
      // host allowlist (potentially planted by XSS or a bad extension).
      // Reset to the default so we never auto-probe an arbitrary host.
      if (stored) {
        try {
          localStorage.removeItem(LS_URL_KEY);
        } catch {
          /* ignore — quota / strict-mode storage */
        }
      }
      return DEFAULT_BACKEND_URL;
    } catch {
      return DEFAULT_BACKEND_URL;
    }
  });

  const [isConnected, setIsConnected] = useState(false);
  const [isProbing, setIsProbing] = useState(false);

  // Race-condition guard: monotonically increasing probe ID
  const probeIdRef = useRef(0);

  // ── Core probe logic ───────────────────────────────────────────────────────

  const probe = useCallback(async (): Promise<boolean> => {
    const id = ++probeIdRef.current;
    setIsProbing(true);

    try {
      const ok = await probeBackend();
      if (id !== probeIdRef.current) return false;
      setIsConnected(ok);
      return ok;
    } catch {
      if (id === probeIdRef.current) {
        setIsConnected(false);
      }
      return false;
    } finally {
      if (id === probeIdRef.current) {
        setIsProbing(false);
      }
    }
  }, []);

  // ── Polling for server detection (setTimeout chain, no overlap) ──────────

  const pollingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const probeRef = useRef(probe);
  probeRef.current = probe;

  const stopPolling = useCallback(() => {
    if (pollingTimerRef.current !== null) {
      clearTimeout(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    setIsPolling(true);

    const schedule = () => {
      pollingTimerRef.current = setTimeout(async () => {
        if (document.hidden) {
          // Don't reschedule — visibilitychange handler restarts the chain
          pollingTimerRef.current = null;
          return;
        }
        const ok = await probeRef.current();
        if (ok) {
          setIsPolling(false);
          pollingTimerRef.current = null;
        } else {
          schedule();
        }
      }, 3_000);
    };

    schedule();
  }, [stopPolling]);

  // On tab return during polling, clear pending timer, probe, and reschedule if needed
  useEffect(() => {
    if (!isPolling) return;
    const handleVisibility = () => {
      if (!document.hidden) {
        // Clear any pending timer so we don't double-fire
        if (pollingTimerRef.current !== null) {
          clearTimeout(pollingTimerRef.current);
          pollingTimerRef.current = null;
        }
        // Probe immediately, then restart the polling chain if still disconnected
        void probeRef.current().then((ok) => {
          if (!ok && isPolling) {
            // Restart the setTimeout chain — schedule is captured in startPolling's closure,
            // so we re-call startPolling which clears+restarts cleanly.
            startPolling();
          }
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isPolling, startPolling]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingTimerRef.current !== null) {
        clearTimeout(pollingTimerRef.current);
      }
    };
  }, []);

  // ── Mount: sync service URL + auto-probe ─────────────────────────────────

  useEffect(() => {
    setServiceUrl(backendUrl);
    void probe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isConnected,
    isProbing,
    backendUrl,
    startPolling,
    stopPolling,
    isPolling,
  };
}
