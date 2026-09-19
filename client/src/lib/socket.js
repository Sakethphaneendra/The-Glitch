/**
 * Glitch - socket.js (client)
 * Designed and Developed by Saketh Phaneendra
 *
 * One shared Socket.IO connection. Reconnection is left on with an unlimited
 * retry count: that is what lets a phone walk through a dead zone and come
 * back without retyping the master code.
 */
import { io } from 'socket.io-client';

export const socket = io({
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 700,
  reconnectionDelayMax: 4000,
  timeout: 8000,
});

/** Promise wrapper around an acknowledged emit. */
export function ask(event, payload = {}, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: 'The server did not answer. Check your connection.' });
    }, timeoutMs);

    socket.emit(event, payload, (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res || { ok: false, error: 'Empty response from server.' });
    });
  });
}

export const storage = {
  read(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode - pairing simply will not survive a reload */
    }
  },
  clear(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
