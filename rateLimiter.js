/**
 * Glitch - rateLimiter.js
 * Designed and Developed by Saketh Phaneendra
 *
 * Sliding-window limiter. Four-digit codes are only 10,000 possibilities, so
 * pairing and wishlist lookups are throttled per socket to make guessing
 * impractical.
 */

export class RateLimiter {
  constructor({ limit = 10, windowMs = 60_000 } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  /** Returns true when the action is allowed. */
  allow(key) {
    const now = Date.now();
    const recent = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  retryAfter(key) {
    const now = Date.now();
    const recent = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (recent.length === 0) return 0;
    return Math.ceil((this.windowMs - (now - recent[0])) / 1000);
  }

  clear(key) {
    this.hits.delete(key);
  }
}
