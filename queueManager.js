/**
 * Glitch - queueManager.js
 * Designed and Developed by Saketh Phaneendra
 *
 * Pure queue logic. It never touches sockets, so it is easy to reason about
 * and easy to test: every function takes a session and mutates its queue.
 */

const MAX_QUEUE = 200;

let counter = 0;
function nextId() {
  counter += 1;
  return `s${Date.now().toString(36)}${counter.toString(36)}`;
}

export function addSongs(session, songs) {
  const room = MAX_QUEUE - session.queue.length;
  if (room <= 0) {
    const err = new Error('The queue is full. Remove a few songs first.');
    err.code = 'QUEUE_FULL';
    throw err;
  }
  const accepted = songs.slice(0, room).map((song) => ({ ...song, id: nextId() }));
  const wasEmpty = session.queue.length === 0;
  session.queue.push(...accepted);

  // First song ever added starts playing immediately.
  if (wasEmpty) {
    session.currentIndex = 0;
    session.playback.playing = true;
    session.playbackNonce += 1;
  } else if (session.currentIndex === -1) {
    session.currentIndex = session.queue.length - accepted.length;
    session.playback.playing = true;
    session.playbackNonce += 1;
  }

  return accepted;
}

export function removeSong(session, songId) {
  const index = session.queue.findIndex((s) => s.id === songId);
  if (index === -1) {
    const err = new Error('That song is no longer in the queue.');
    err.code = 'NOT_IN_QUEUE';
    throw err;
  }

  const wasCurrent = index === session.currentIndex;
  session.queue.splice(index, 1);

  if (session.queue.length === 0) {
    session.currentIndex = -1;
    resetPlayback(session);
    return { removedIndex: index, wasCurrent };
  }

  if (wasCurrent) {
    // The next song slides into this index. Clamp if we removed the last one.
    session.currentIndex = Math.min(index, session.queue.length - 1);
    startCurrent(session);
  } else if (index < session.currentIndex) {
    session.currentIndex -= 1;
  }

  return { removedIndex: index, wasCurrent };
}

export function currentSong(session) {
  if (session.currentIndex < 0 || session.currentIndex >= session.queue.length) return null;
  return session.queue[session.currentIndex];
}

export function goTo(session, index) {
  if (!Number.isInteger(index) || index < 0 || index >= session.queue.length) {
    const err = new Error('That queue position does not exist.');
    err.code = 'BAD_INDEX';
    throw err;
  }
  session.currentIndex = index;
  startCurrent(session);
}

export function next(session, { auto = false } = {}) {
  if (session.queue.length === 0) return false;
  const last = session.currentIndex >= session.queue.length - 1;
  if (last) {
    if (auto) {
      // Queue finished. Stay on the last song, stopped.
      session.playback.playing = false;
      session.playback.currentTime = 0;
      session.playback.status = 'ended';
      return false;
    }
    return false;
  }
  session.currentIndex += 1;
  startCurrent(session);
  return true;
}

export function previous(session) {
  if (session.queue.length === 0) return false;
  // Standard music-player behaviour: restart the song if we are past 3 seconds.
  if (session.playback.currentTime > 3 || session.currentIndex <= 0) {
    startCurrent(session);
    return true;
  }
  session.currentIndex -= 1;
  startCurrent(session);
  return true;
}

export function startCurrent(session) {
  session.playback.currentTime = 0;
  session.playback.duration = 0;
  session.playback.playing = true;
  session.playback.status = 'loading';
  session.playback.error = null;
  session.playbackNonce += 1;
}

export function resetPlayback(session) {
  session.playback.currentTime = 0;
  session.playback.duration = 0;
  session.playback.playing = false;
  session.playback.status = 'idle';
  session.playback.error = null;
  session.playbackNonce += 1;
}
