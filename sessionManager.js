/**
 * Glitch - sessionManager.js
 * Designed and Developed by Saketh Phaneendra
 *
 * Owns the lifetime of a Master session. A session survives socket drops on
 * purpose: the phone keeps its pairing token in localStorage and rejoins
 * silently, so a lift-tunnel or a Wi-Fi hiccup never asks for the code again.
 */

import { MemoryStore, makeCode, makeToken } from './store.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours idle
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

export class SessionManager {
  constructor(store = new MemoryStore()) {
    this.store = store;
    this.timer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  createSession() {
    const code = makeCode(this.store);
    const session = {
      code,
      room: `master:${code}`,
      mobileRoom: `master:${code}:mobile`,
      masterToken: makeToken(),
      mobileToken: null,
      masterSocketId: null,
      mobileSocketId: null,
      queue: [],
      currentIndex: -1,
      playbackNonce: 0,
      playback: {
        currentTime: 0,
        duration: 0,
        playing: false,
        status: 'idle', // idle | loading | playing | paused | buffering | ended | external | error
        volume: 100,
        error: null,
        mode: 'embedded', // embedded | external
      },
      importedWishlists: [],
      createdAt: Date.now(),
      touchedAt: Date.now(),
    };
    this.store.set(code, session);
    return session;
  }

  get(code) {
    if (typeof code !== 'string' || !/^\d{4}$/.test(code)) return null;
    const session = this.store.get(code);
    if (session) session.touchedAt = Date.now();
    return session;
  }

  /** Master reclaims its own session after a page reload. */
  resumeMaster(code, token, socketId) {
    const session = this.get(code);
    if (!session || session.masterToken !== token) return null;
    session.masterSocketId = socketId;
    return session;
  }

  attachMaster(session, socketId) {
    session.masterSocketId = socketId;
    session.touchedAt = Date.now();
  }

  /** First-time pairing: phone types the 4-digit code. */
  pairMobile(code, socketId) {
    const session = this.get(code);
    if (!session) {
      const err = new Error('No session with that code. Check the digits on the desktop.');
      err.code = 'NO_SESSION';
      throw err;
    }
    if (session.mobileToken && session.mobileSocketId && session.mobileSocketId !== socketId) {
      const err = new Error('Another phone is already paired to this code.');
      err.code = 'ALREADY_PAIRED';
      throw err;
    }
    session.mobileToken = session.mobileToken || makeToken();
    session.mobileSocketId = socketId;
    session.touchedAt = Date.now();
    return session;
  }

  /** Silent reconnect: phone presents the token it was given when it paired. */
  resumeMobile(code, token, socketId) {
    const session = this.get(code);
    if (!session || !session.mobileToken || session.mobileToken !== token) return null;
    session.mobileSocketId = socketId;
    session.touchedAt = Date.now();
    return session;
  }

  detachSocket(socketId) {
    const touched = [];
    for (const session of this.store.values()) {
      if (session.masterSocketId === socketId) {
        session.masterSocketId = null;
        touched.push({ session, role: 'master' });
      }
      if (session.mobileSocketId === socketId) {
        session.mobileSocketId = null;
        touched.push({ session, role: 'mobile' });
      }
    }
    return touched;
  }

  /** Explicit unpair from the phone - the only thing that clears the token. */
  unpairMobile(session) {
    session.mobileToken = null;
    session.mobileSocketId = null;
    session.touchedAt = Date.now();
  }

  endSession(session) {
    this.store.delete(session.code);
  }

  sweep() {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const session of this.store.values()) {
      if (session.touchedAt < cutoff) this.store.delete(session.code);
    }
  }
}

/**
 * The only shape of session data that ever leaves the server.
 * Tokens and socket ids are deliberately not included.
 */
export function publicSession(session) {
  return {
    code: session.code,
    queue: session.queue.map((song, index) => ({
      id: song.id,
      videoId: song.videoId,
      title: song.title,
      author: song.author,
      thumbnail: song.thumbnail,
      position: index + 1,
      isCurrent: index === session.currentIndex,
      source: song.source || 'master',
    })),
    currentIndex: session.currentIndex,
    currentSong:
      session.currentIndex >= 0 && session.currentIndex < session.queue.length
        ? session.queue[session.currentIndex]
        : null,
    playback: { ...session.playback },
    playbackNonce: session.playbackNonce,
    mobileOnline: Boolean(session.mobileSocketId),
    mobilePaired: Boolean(session.mobileToken),
    masterOnline: Boolean(session.masterSocketId),
    importedWishlists: [...session.importedWishlists],
  };
}
