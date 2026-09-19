/**
 * Glitch - util.js
 * Designed and Developed by Saketh Phaneendra
 */

export function clock(seconds) {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export const isAndroid = () => /android/i.test(navigator.userAgent);
export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * Best-effort deep link into Brave.
 *
 * Android: an intent:// URL naming Brave's package, with the normal https URL
 * as the browser_fallback_url so nothing breaks if Brave is not installed.
 * iOS: Brave registers the brave://open-url scheme.
 * Everything else: a plain new tab.
 *
 * There is no web API that can confirm Brave opened, and none that can then
 * control that tab - see the README.
 */
export function braveUrl(watchUrl) {
  if (isAndroid()) {
    const bare = watchUrl.replace(/^https?:\/\//, '');
    const fallback = encodeURIComponent(watchUrl);
    return `intent://${bare}#Intent;scheme=https;package=com.brave.browser;S.browser_fallback_url=${fallback};end`;
  }
  if (isIOS()) {
    return `brave://open-url?url=${encodeURIComponent(watchUrl)}`;
  }
  return watchUrl;
}

export function openExternally(watchUrl) {
  const target = braveUrl(watchUrl);
  // Same-tab navigation for the intent:// scheme, new tab for plain https.
  if (target.startsWith('intent://') || target.startsWith('brave://')) {
    window.location.href = target;
  } else {
    window.open(target, '_blank', 'noopener');
  }
}
