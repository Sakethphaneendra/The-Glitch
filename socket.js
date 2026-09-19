/**
 * Glitch - socket.js
 * Designed and Developed by Saketh Phaneendra
 *
 * Every event the browsers can send is implemented here, validated here, and
 * answered here. Nothing from a client is trusted: codes are format-checked,
 * queue references are looked up by id, numbers are clamped, and tokens are
 * compared before a socket is allowed to act as a Master or a phone.
 */

import { SessionManager, publicSession } from './sessionManager.js';
import { WishlistManager, MAX_WISHLIST_SONGS } from './wishlistManager.js';
import { RateLimiter } from './rateLimiter.js';
import * as queue from './queueManager.js';
import { resolveSong } from './youtube.js';

const CONTROL_ACTIONS = new Set([
  'play',
  'pause',
  'toggle',
  'next',
  'prev',
  'seek',
  'nudge',
  'volume',
]);

function reply(cb, payload) {
  if (typeof cb === 'function') cb(payload);
}

function fail(cb, message, code = 'ERROR') {
  reply(cb, { ok: false, error: message, code });
}

export function attachSockets(io) {
  const sessions = new SessionManager();
  const wishlists = new WishlistManager();

  const codeLimiter = new RateLimiter({ limit: 8, windowMs: 60_000 });
  const addLimiter = new RateLimiter({ limit: 40, windowMs: 60_000 });
  const createLimiter = new RateLimiter({ limit: 12, windowMs: 60_000 });

  const broadcast = (session) => {
    io.to(session.room).emit('state', publicSession(session));
  };

  const toMobile = (session, event, payload) => {
    if (!session.mobileSocketId) return false;
    io.to(session.mobileSocketId).emit(event, payload);
    return true;
  };

  const toast = (socket, kind, message) => socket.emit('toast', { kind, message });

  io.on('connection', (socket) => {
    // socket.data.role: 'master' | 'mobile' | undefined
    socket.data.role = null;
    socket.data.code = null;

    const session = () => (socket.data.code ? sessions.get(socket.data.code) : null);

    const requireMaster = (cb) => {
      const s = session();
      if (!s || socket.data.role !== 'master' || s.masterSocketId !== socket.id) {
        fail(cb, 'This session is no longer active. Reload to start a new one.', 'NO_SESSION');
        return null;
      }
      return s;
    };

    /* ---------------------------------------------------------- MASTER --- */

    socket.on('master:create', (_payload, cb) => {
      if (!createLimiter.allow(socket.handshake.address)) {
        return fail(cb, 'Too many sessions from this device. Wait a minute.', 'RATE_LIMIT');
      }
      const s = sessions.createSession();
      sessions.attachMaster(s, socket.id);
      socket.join(s.room);
      socket.data.role = 'master';
      socket.data.code = s.code;
      reply(cb, {
        ok: true,
        code: s.code,
        masterToken: s.masterToken,
        state: publicSession(s),
      });
    });

    socket.on('master:resume', (payload, cb) => {
      const { code, masterToken } = payload || {};
      const s = sessions.resumeMaster(code, masterToken, socket.id);
      if (!s) return fail(cb, 'That session has ended.', 'NO_SESSION');
      socket.join(s.room);
      socket.data.role = 'master';
      socket.data.code = s.code;
      reply(cb, { ok: true, code: s.code, state: publicSession(s) });
      broadcast(s);
    });

    socket.on('master:end', (_payload, cb) => {
      const s = requireMaster(cb);
      if (!s) return;
      io.to(s.room).emit('session:ended');
      sessions.endSession(s);
      socket.leave(s.room);
      socket.data.role = null;
      socket.data.code = null;
      reply(cb, { ok: true });
    });

    socket.on('queue:add', async (payload, cb) => {
      const s = requireMaster(cb);
      if (!s) return;
      if (!addLimiter.allow(socket.id)) {
        return fail(cb, 'Slow down a moment before adding more songs.', 'RATE_LIMIT');
      }
      try {
        const song = await resolveSong(payload?.url);
        queue.addSongs(s, [{ ...song, source: 'master' }]);
        broadcast(s);
        reply(cb, { ok: true, song });
      } catch (err) {
        fail(cb, err.message || 'Could not add that song.', err.code);
      }
    });

    socket.on('queue:remove', (payload, cb) => {
      const s = requireMaster(cb);
      if (!s) return;
      try {
        queue.removeSong(s, String(payload?.songId || ''));
        broadcast(s);
        reply(cb, { ok: true });
      } catch (err) {
        fail(cb, err.message, err.code);
      }
    });

    socket.on('queue:jump', (payload, cb) => {
      const s = requireMaster(cb);
      if (!s) return;
      const index = s.queue.findIndex((song) => song.id === String(payload?.songId || ''));
      try {
        queue.goTo(s, index);
        broadcast(s);
        reply(cb, { ok: true });
      } catch (err) {
        fail(cb, err.message, err.code);
      }
    });

    socket.on('wishlist:import', (payload, cb) => {
      const s = requireMaster(cb);
      if (!s) return;
      const code = String(payload?.code || '').trim();
      if (!/^\d{4}$/.test(code)) {
        return fail(cb, 'A wishlist code is four digits.', 'BAD_CODE');
      }
      if (!codeLimiter.allow(`wl:${socket.id}`)) {
        return fail(
          cb,
          `Too many code attempts. Try again in ${codeLimiter.retryAfter(`wl:${socket.id}`)}s.`,
          'RATE_LIMIT'
        );
      }
      try {
        const songs = wishlists.claim(code, s.code);
        const added = queue.addSongs(s, songs);
        s.importedWishlists.push(code);
        broadcast(s);
        reply(cb, { ok: true, added: added.length });
      } catch (err) {
        fail(cb, err.message, err.code);
      }
    });

    socket.on('control', (payload, cb) => {
      const s = requireMaster(cb);
      if (!s) return;
      const action = String(payload?.action || '');
      if (!CONTROL_ACTIONS.has(action)) return fail(cb, 'Unknown control.', 'BAD_ACTION');
      if (s.queue.length === 0) return fail(cb, 'The queue is empty.', 'EMPTY_QUEUE');
      if (!s.mobileSocketId) return fail(cb, 'Your phone is offline.', 'MOBILE_OFFLINE');

      switch (action) {
        case 'play':
          s.playback.playing = true;
          toMobile(s, 'command', { action: 'play' });
          break;
        case 'pause':
          s.playback.playing = false;
          toMobile(s, 'command', { action: 'pause' });
          break;
        case 'toggle':
          s.playback.playing = !s.playback.playing;
          toMobile(s, 'command', { action: s.playback.playing ? 'play' : 'pause' });
          break;
        case 'next': {
          const moved = queue.next(s, { auto: false });
          if (!moved) return fail(cb, 'Already at the end of the queue.', 'QUEUE_END');
          const song = queue.currentSong(s);
          toMobile(s, 'command', { action: 'load', videoId: song.videoId, autoplay: true });
          break;
        }
        case 'prev': {
          const moved = queue.previous(s);
          if (!moved) return fail(cb, 'There is no previous song.', 'QUEUE_START');
          const song = queue.currentSong(s);
          toMobile(s, 'command', { action: 'load', videoId: song.videoId, autoplay: true });
          break;
        }
        case 'seek': {
          const time = Number(payload?.value);
          if (!Number.isFinite(time) || time < 0) return fail(cb, 'Bad seek position.', 'BAD_VALUE');
          toMobile(s, 'command', { action: 'seek', value: Math.min(time, 86_400) });
          break;
        }
        case 'nudge': {
          const delta = Number(payload?.value);
          if (![10, -10].includes(delta)) return fail(cb, 'Bad skip amount.', 'BAD_VALUE');
          toMobile(s, 'command', { action: 'nudge', value: delta });
          break;
        }
        case 'volume': {
          const vol = Math.round(Number(payload?.value));
          if (!Number.isFinite(vol) || vol < 0 || vol > 100) {
            return fail(cb, 'Volume must be between 0 and 100.', 'BAD_VALUE');
          }
          s.playback.volume = vol;
          toMobile(s, 'command', { action: 'volume', value: vol });
          break;
        }
        default:
          break;
      }

      broadcast(s);
      reply(cb, { ok: true });
    });

    /* ---------------------------------------------------------- MOBILE --- */

    socket.on('mobile:pair', (payload, cb) => {
      const code = String(payload?.code || '').trim();
      if (!/^\d{4}$/.test(code)) return fail(cb, 'A master code is four digits.', 'BAD_CODE');
      if (!codeLimiter.allow(`pair:${socket.handshake.address}`)) {
        return fail(
          cb,
          `Too many attempts. Try again in ${codeLimiter.retryAfter(
            `pair:${socket.handshake.address}`
          )}s.`,
          'RATE_LIMIT'
        );
      }
      try {
        const s = sessions.pairMobile(code, socket.id);
        socket.join(s.room);
        socket.data.role = 'mobile';
        socket.data.code = s.code;
        codeLimiter.clear(`pair:${socket.handshake.address}`);
        reply(cb, { ok: true, code: s.code, mobileToken: s.mobileToken, state: publicSession(s) });
        broadcast(s);
      } catch (err) {
        fail(cb, err.message, err.code);
      }
    });

    socket.on('mobile:resume', (payload, cb) => {
      const { code, mobileToken } = payload || {};
      const s = sessions.resumeMobile(code, mobileToken, socket.id);
      if (!s) return fail(cb, 'This pairing has ended. Enter the master code again.', 'NO_SESSION');
      socket.join(s.room);
      socket.data.role = 'mobile';
      socket.data.code = s.code;
      reply(cb, { ok: true, code: s.code, state: publicSession(s) });
      broadcast(s);
    });

    socket.on('mobile:unpair', (_payload, cb) => {
      const s = session();
      if (!s || socket.data.role !== 'mobile') return reply(cb, { ok: true });
      sessions.unpairMobile(s);
      socket.leave(s.room);
      socket.data.role = null;
      socket.data.code = null;
      reply(cb, { ok: true });
      broadcast(s);
    });

    // The phone is the single source of truth for real playback position.
    socket.on('mobile:state', (payload) => {
      const s = session();
      if (!s || socket.data.role !== 'mobile' || s.mobileSocketId !== socket.id) return;
      const p = payload || {};
      const currentTime = Number(p.currentTime);
      const duration = Number(p.duration);
      s.playback.currentTime = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
      s.playback.duration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
      s.playback.playing = Boolean(p.playing);
      s.playback.status = typeof p.status === 'string' ? p.status.slice(0, 20) : 'idle';
      s.playback.mode = p.mode === 'external' ? 'external' : 'embedded';
      if (Number.isFinite(Number(p.volume))) {
        s.playback.volume = Math.min(100, Math.max(0, Math.round(Number(p.volume))));
      }
      if (s.playback.status !== 'error') s.playback.error = null;
      s.touchedAt = Date.now();
      if (s.masterSocketId) io.to(s.masterSocketId).emit('state', publicSession(s));
    });

    // Song finished on the phone -> advance the queue. This is the auto-advance.
    socket.on('mobile:ended', (payload) => {
      const s = session();
      if (!s || socket.data.role !== 'mobile' || s.mobileSocketId !== socket.id) return;
      const current = queue.currentSong(s);
      if (!current || (payload?.videoId && payload.videoId !== current.videoId)) return;
      const advanced = queue.next(s, { auto: true });
      if (!advanced) s.playback.status = 'ended';
      broadcast(s);
    });

    socket.on('mobile:error', (payload) => {
      const s = session();
      if (!s || socket.data.role !== 'mobile' || s.mobileSocketId !== socket.id) return;
      const current = queue.currentSong(s);
      if (!current) return;
      s.playback.status = 'error';
      s.playback.playing = false;
      s.playback.error = {
        videoId: current.videoId,
        message: String(payload?.message || 'This video cannot play here.').slice(0, 160),
        embeddable: payload?.embeddable === true,
      };
      broadcast(s);
    });

    /* ----------------------------------------------------------- GUEST --- */

    socket.on('wishlist:create', async (payload, cb) => {
      if (!createLimiter.allow(`wl:${socket.handshake.address}`)) {
        return fail(cb, 'Too many wishlists from this device. Wait a minute.', 'RATE_LIMIT');
      }
      const urls = Array.isArray(payload?.urls) ? payload.urls : [];
      const cleaned = urls.map((u) => String(u || '').trim()).filter(Boolean);
      if (cleaned.length === 0) return fail(cb, 'Add at least one song.', 'EMPTY_WISHLIST');
      if (cleaned.length > MAX_WISHLIST_SONGS) {
        return fail(cb, `A wishlist holds ${MAX_WISHLIST_SONGS} songs at most.`, 'TOO_MANY_SONGS');
      }

      const songs = [];
      const errors = [];
      for (const url of cleaned) {
        try {
          songs.push(await resolveSong(url));
        } catch (err) {
          errors.push({ url, message: err.message });
        }
      }
      if (songs.length === 0) {
        return fail(cb, errors[0]?.message || 'None of those links worked.', 'NO_VALID_SONGS');
      }
      try {
        const wishlist = wishlists.create(songs);
        reply(cb, { ok: true, code: wishlist.code, songs, errors });
      } catch (err) {
        fail(cb, err.message, err.code);
      }
    });

    /* ------------------------------------------------------ DISCONNECT --- */

    socket.on('disconnect', () => {
      // Sessions are intentionally kept alive here. The phone's pairing token
      // lets it rejoin without retyping the code.
      const touched = sessions.detachSocket(socket.id);
      for (const { session: s } of touched) broadcast(s);
    });
  });

  return { sessions, wishlists };
}
