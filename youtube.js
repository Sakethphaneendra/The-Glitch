/**
 * Glitch - youtube.js
 * Designed and Developed by Saketh Phaneendra
 *
 * Parses YouTube URLs and fetches public metadata through the oEmbed endpoint.
 * oEmbed needs no API key and no quota, but it only returns title, author and
 * thumbnail - there is no duration. Duration comes from the phone's player
 * once the video actually loads.
 */

const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/**
 * Extracts an 11-character video id from any common YouTube URL shape.
 * Returns null when the input is not a YouTube video link.
 */
export function parseVideoId(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || raw.length > 2048) return null;

  // Bare video id pasted on its own.
  if (ID_PATTERN.test(raw)) return raw;

  let url;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;

  if (url.hostname.toLowerCase().endsWith('youtu.be')) {
    const id = url.pathname.slice(1).split('/')[0];
    return ID_PATTERN.test(id) ? id : null;
  }

  const v = url.searchParams.get('v');
  if (v && ID_PATTERN.test(v)) return v;

  const parts = url.pathname.split('/').filter(Boolean);
  const prefixes = ['embed', 'shorts', 'live', 'v'];
  if (parts.length >= 2 && prefixes.includes(parts[0])) {
    return ID_PATTERN.test(parts[1]) ? parts[1] : null;
  }

  return null;
}

export function watchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function thumbnailUrl(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

async function fetchOEmbed(videoId, timeoutMs = 6000) {
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    watchUrl(videoId)
  )}&format=json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, { signal: controller.signal });
    // YouTube answers 401 for private/restricted and 404 for removed videos.
    // Anything else (including a 403 from a corporate proxy) is treated as a
    // lookup failure so a flaky network never blocks the queue.
    if (res.status === 401 || res.status === 404) {
      return { ok: false, reason: 'unavailable' };
    }
    if (!res.ok) return { ok: false, reason: 'lookup-failed' };
    const data = await res.json();
    return { ok: true, data };
  } catch {
    return { ok: false, reason: 'lookup-failed' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turns a user-supplied URL into a queue-ready song object.
 * Throws an Error with a user-facing message when the link cannot be used.
 */
export async function resolveSong(input) {
  const videoId = parseVideoId(input);
  if (!videoId) {
    const err = new Error('That is not a YouTube link. Paste a youtube.com or youtu.be URL.');
    err.code = 'INVALID_URL';
    throw err;
  }

  const result = await fetchOEmbed(videoId);

  if (!result.ok && result.reason === 'unavailable') {
    const err = new Error('This video is unavailable, private or removed.');
    err.code = 'VIDEO_UNAVAILABLE';
    throw err;
  }

  // A lookup failure (offline server, YouTube hiccup) should not block the
  // queue - the phone is the thing that actually has to load the video.
  const meta = result.ok ? result.data : {};

  return {
    videoId,
    url: watchUrl(videoId),
    title: typeof meta.title === 'string' ? meta.title.slice(0, 200) : `Video ${videoId}`,
    author: typeof meta.author_name === 'string' ? meta.author_name.slice(0, 120) : 'Unknown artist',
    thumbnail:
      typeof meta.thumbnail_url === 'string' ? meta.thumbnail_url : thumbnailUrl(videoId),
    metadataResolved: Boolean(result.ok),
  };
}
