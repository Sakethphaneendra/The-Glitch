/**
 * Glitch - wishlistManager.js
 * Designed and Developed by Saketh Phaneendra
 *
 * Guest wishlists: up to five songs behind a 4-digit code. A wishlist can be
 * imported once per Master session; a second Add press is a no-op with a clear
 * message rather than a duplicated queue.
 */

import { MemoryStore, makeCode } from './store.js';

export const MAX_WISHLIST_SONGS = 5;
const WISHLIST_TTL_MS = 12 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

export class WishlistManager {
  constructor(store = new MemoryStore()) {
    this.store = store;
    this.timer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  create(songs) {
    if (!Array.isArray(songs) || songs.length === 0) {
      const err = new Error('Add at least one song before creating a code.');
      err.code = 'EMPTY_WISHLIST';
      throw err;
    }
    if (songs.length > MAX_WISHLIST_SONGS) {
      const err = new Error(`A wishlist holds ${MAX_WISHLIST_SONGS} songs at most.`);
      err.code = 'TOO_MANY_SONGS';
      throw err;
    }
    const code = makeCode(this.store);
    const wishlist = {
      code,
      songs,
      createdAt: Date.now(),
      importedBy: [], // master codes that already took this wishlist
    };
    this.store.set(code, wishlist);
    return wishlist;
  }

  get(code) {
    if (typeof code !== 'string' || !/^\d{4}$/.test(code)) return null;
    return this.store.get(code);
  }

  /** Returns the songs to import, or throws with a user-facing message. */
  claim(code, masterCode) {
    const wishlist = this.get(code);
    if (!wishlist) {
      const err = new Error('No wishlist with that code.');
      err.code = 'NO_WISHLIST';
      throw err;
    }
    if (wishlist.importedBy.includes(masterCode)) {
      const err = new Error('You already added this wishlist.');
      err.code = 'ALREADY_IMPORTED';
      throw err;
    }
    wishlist.importedBy.push(masterCode);
    return wishlist.songs.map((song) => ({ ...song, source: 'guest' }));
  }

  sweep() {
    const cutoff = Date.now() - WISHLIST_TTL_MS;
    for (const wishlist of this.store.values()) {
      if (wishlist.createdAt < cutoff) this.store.delete(wishlist.code);
    }
  }
}
