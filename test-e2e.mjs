/**
 * Glitch - test-e2e.mjs
 * Designed and Developed by Saketh Phaneendra
 *
 * Drives the real server over real sockets: pairing, queueing, wishlist
 * import, auto-advance, controls, removal and silent reconnect.
 */
import { io } from 'socket.io-client';

const URL = 'http://localhost:3000';
const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass, extra });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

const ask = (sock, event, payload = {}) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 8000);
    sock.emit(event, payload, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });

const connect = () =>
  new Promise((resolve) => {
    const sock = io(URL, { transports: ['websocket'] });
    sock.on('connect', () => resolve(sock));
  });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return true;
    await wait(60);
  }
  return false;
};

const V = [
  'https://www.youtube.com/watch?v=aaaaaaaaaaa',
  'https://youtu.be/bbbbbbbbbbb',
  'https://www.youtube.com/shorts/ccccccccccc',
  'https://music.youtube.com/watch?v=ddddddddddd&list=xyz',
  'https://www.youtube.com/watch?v=eeeeeeeeeee',
];

const run = async () => {
  const master = await connect();
  let mState = null;
  master.on('state', (s) => (mState = s));

  // Test 1: master session
  const created = await ask(master, 'master:create');
  check('T1 master session created with 4-digit code', created.ok && /^\d{4}$/.test(created.code), created.code);

  // Test 2: phone pairs
  const phone = await connect();
  let pState = null;
  phone.on('state', (s) => (pState = s));
  const bad = await ask(phone, 'mobile:pair', { code: '99999' });
  check('T2a bad code rejected', !bad.ok, bad.error);
  const paired = await ask(phone, 'mobile:pair', { code: created.code });
  check('T2b phone paired, token issued', paired.ok && Boolean(paired.mobileToken));
  check('T2c master sees phone online', await until(() => mState?.mobileOnline));

  // Test 3/4: queue
  const badUrl = await ask(master, 'queue:add', { url: 'https://vimeo.com/123' });
  check('T3a non-YouTube link rejected', !badUrl.ok, badUrl.error);
  const a = await ask(master, 'queue:add', { url: V[0] });
  const b = await ask(master, 'queue:add', { url: V[1] });
  const c = await ask(master, 'queue:add', { url: V[2] });
  check('T3b three songs accepted', a.ok && b.ok && c.ok);
  check('T4a phone received queue of 3', await until(() => pState?.queue.length === 3));
  check('T4b first song is current and playing', mState.currentIndex === 0 && mState.playback.playing);

  // Test 5: auto-advance
  phone.emit('mobile:ended', { videoId: mState.currentSong.videoId });
  check('T5a song 2 started automatically', await until(() => mState?.currentIndex === 1));
  phone.emit('mobile:ended', { videoId: mState.currentSong.videoId });
  check('T5b song 3 started automatically', await until(() => mState?.currentIndex === 2));
  phone.emit('mobile:ended', { videoId: mState.currentSong.videoId });
  await wait(250);
  check('T5c queue end stops cleanly', mState.currentIndex === 2 && mState.playback.playing === false);

  // Test 6: controls reach the phone
  const commands = [];
  phone.on('command', (cmd) => commands.push(cmd));
  await ask(master, 'control', { action: 'prev' });
  check('T6a prev moved back', await until(() => mState?.currentIndex === 1));
  await ask(master, 'control', { action: 'next' });
  check('T6b next moved forward', await until(() => mState?.currentIndex === 2));
  await ask(master, 'control', { action: 'toggle' });
  await ask(master, 'control', { action: 'nudge', value: -10 });
  await ask(master, 'control', { action: 'nudge', value: 10 });
  await ask(master, 'control', { action: 'seek', value: 42 });
  await ask(master, 'control', { action: 'volume', value: 55 });
  const badNudge = await ask(master, 'control', { action: 'nudge', value: 999 });
  await until(() => commands.length >= 5);
  check('T6c phone got play/pause, -10, +10, seek, volume',
    commands.some((c) => c.action === 'play' || c.action === 'pause') &&
      commands.filter((c) => c.action === 'nudge').length === 2 &&
      commands.some((c) => c.action === 'seek' && c.value === 42) &&
      commands.some((c) => c.action === 'volume' && c.value === 55));
  check('T6d invalid skip amount rejected', !badNudge.ok, badNudge.error);

  // Real playback state flows phone -> master, never faked
  phone.emit('mobile:state', { currentTime: 155, duration: 261, playing: true, status: 'playing', mode: 'embedded', volume: 55 });
  check('T6e master shows the phone\'s real position',
    await until(() => Math.round(mState?.playback.currentTime) === 155 && mState.playback.duration === 261));

  // Test 7/8: guest wishlist
  const guest = await connect();
  const tooMany = await ask(guest, 'wishlist:create', { urls: [...V, V[0]] });
  check('T7a more than 5 songs rejected', !tooMany.ok, tooMany.error);
  const wl = await ask(guest, 'wishlist:create', { urls: V });
  check('T7b wishlist code created', wl.ok && /^\d{4}$/.test(wl.code), wl.code);
  const before = mState.queue.length;
  const imported = await ask(master, 'wishlist:import', { code: wl.code });
  check('T8a 5 guest songs imported', imported.ok && imported.added === 5);
  check('T8b queue grew by 5', await until(() => mState?.queue.length === before + 5));
  const again = await ask(master, 'wishlist:import', { code: wl.code });
  check('T8c same wishlist cannot be added twice', !again.ok, again.error);
  const missing = await ask(master, 'wishlist:import', { code: '0001' });
  check('T8d unknown wishlist code reported', !missing.ok, missing.error);

  // Removal, including the currently playing song
  const currentId = mState.currentSong.id;
  const lenBefore = mState.queue.length;
  await ask(master, 'queue:remove', { songId: currentId });
  check('T8e removing the playing song advances cleanly',
    await until(() => mState?.queue.length === lenBefore - 1 && mState.currentSong && mState.currentSong.id !== currentId));

  // Test 9: silent reconnect
  phone.disconnect();
  check('T9a master sees phone offline', await until(() => mState?.mobileOnline === false));
  const phone2 = await connect();
  const resumed = await ask(phone2, 'mobile:resume', { code: created.code, mobileToken: paired.mobileToken });
  check('T9b phone resumed without the master code', resumed.ok && resumed.state.queue.length === mState.queue.length);
  check('T9c master sees phone back online', await until(() => mState?.mobileOnline === true));
  const forged = await connect();
  const stolen = await ask(forged, 'mobile:resume', { code: created.code, mobileToken: 'not-the-token' });
  check('T9d forged resume token rejected', !stolen.ok, stolen.error);

  // Test 10: master reload
  master.disconnect();
  const master2 = await connect();
  let m2State = null;
  master2.on('state', (s) => (m2State = s));
  const back = await ask(master2, 'master:resume', { code: created.code, masterToken: created.masterToken });
  check('T10a master reload restores the same session', back.ok && back.code === created.code);
  check('T10b queue survived the reload', back.state.queue.length > 0);
  const notMine = await ask(forged, 'control', { action: 'next' });
  check('T10c stranger cannot control the session', !notMine.ok, notMine.error);

  // Rate limiting on code guessing
  let blockedAt = 0;
  for (let i = 0; i < 12; i += 1) {
    const r = await ask(forged, 'mobile:pair', { code: String(1000 + i) });
    if (!r.ok && r.code === 'RATE_LIMIT') { blockedAt = i + 1; break; }
  }
  check('T11 code guessing is rate limited', blockedAt > 0, `blocked after ${blockedAt} tries`);

  // Offline phone rejects controls
  phone2.disconnect();
  await until(() => m2State?.mobileOnline === false);
  const offline = await ask(master2, 'control', { action: 'play' });
  check('T12 controls report an offline phone', !offline.ok, offline.error);

  for (const s of [master2, guest, forged]) s.disconnect();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
