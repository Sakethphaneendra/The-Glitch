/**
 * Glitch - store.js
 * Designed and Developed by Saketh Phaneendra
 *
 * A tiny key/value store with a deliberately narrow interface so that the
 * in-memory implementation can later be swapped for Redis, SQLite or Postgres
 * without touching the managers that sit on top of it.
 */

export class MemoryStore {
  constructor() {
    this.map = new Map();
  }

  get(key) {
    return this.map.get(key) ?? null;
  }

  set(key, value) {
    this.map.set(key, value);
    return value;
  }

  has(key) {
    return this.map.has(key);
  }

  delete(key) {
    return this.map.delete(key);
  }

  values() {
    return [...this.map.values()];
  }

  size() {
    return this.map.size;
  }
}

/** Generates a 4-digit code that is not already taken in `store`. */
export function makeCode(store) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    if (!store.has(code)) return code;
  }
  throw new Error('No free codes available');
}

/** Opaque token used to prove a reconnecting device owns a session slot. */
export function makeToken() {
  return (
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    Date.now().toString(36)
  );
}
