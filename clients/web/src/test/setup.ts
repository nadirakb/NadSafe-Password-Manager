import { beforeEach } from "vitest";

/**
 * Vitest global setup — runs before every test file.
 *
 * Node 22+ has an experimental localStorage that is undefined unless
 * --localstorage-file is passed. Polyfill it with a simple in-memory
 * implementation so tests that touch localStorage work without DOM.
 */

class MemoryStorage implements Storage {
  private store: Record<string, string> = {};

  get length() { return Object.keys(this.store).length; }

  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }
  setItem(key: string, value: string): void { this.store[key] = String(value); }
  removeItem(key: string): void { delete this.store[key]; }
  clear(): void { this.store = {}; }
  key(index: number): string | null { return Object.keys(this.store)[index] ?? null; }
}

// Override Node's experimental (undefined) localStorage with a working in-memory one.
// Using defineProperty so it also works when Node defines localStorage as non-writable.
Object.defineProperty(globalThis, "localStorage", {
  value: new MemoryStorage(),
  writable: true,
  configurable: true,
});

// Clear between tests — each test file calls this via beforeEach as needed,
// but also reset here in case a test file forgets.
beforeEach(() => {
  (globalThis.localStorage as MemoryStorage).clear();
});
