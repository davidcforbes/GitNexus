import { beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Node v25 ships an experimental built-in `localStorage` / `sessionStorage`
// global that intercepts the bare identifiers regardless of jsdom's window
// (https://nodejs.org/api/all.html#all_globals_localstorage). It implements
// the spec but its instance does not match what jsdom exposes via window —
// most production code reads/writes via window.{storage}, while tests that
// touch the bare globals end up writing to a *different* Storage. To restore
// a single coherent Storage per test, install in-memory shims that delegate
// to a Map and re-bind both globals before any test runs.
const makeMemoryStorage = (): Storage => {
  const store = new Map<string, string>();
  const api: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
  };
  return api;
};

const installStorage = (name: 'localStorage' | 'sessionStorage') => {
  const shim = makeMemoryStorage();
  // Replace the global so bare `localStorage` references resolve to the shim
  Object.defineProperty(globalThis, name, {
    value: shim,
    writable: true,
    configurable: true,
  });
  // And the window binding so `window.localStorage` matches
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, name, {
      value: shim,
      writable: true,
      configurable: true,
    });
  }
};

installStorage('localStorage');
installStorage('sessionStorage');

// Reset storage between tests
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
