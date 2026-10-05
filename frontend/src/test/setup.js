import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { webcrypto } from 'node:crypto';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom me crypto.subtle nahi hota, Node ka webcrypto laga do.
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
