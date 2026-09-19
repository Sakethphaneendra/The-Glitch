/**
 * Glitch - Master.jsx
 * Designed and Developed by Saketh Phaneendra
 *
 * The desktop controller. It never plays audio. Everything it shows about
 * playback position comes from the phone through the server.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { socket, ask, storage } from '../lib/socket.js';
import { clock } from '../lib/util.js';
import {
  BackLink,
  CodeDigits,
  Credit,
  Equalizer,
  Status,
  Toasts,
  useToasts,
} from '../components/Ui.jsx';

const KEY = 'glitch:master';

export default function Master({ navigate, serverConnected }) {
  const [session, setSession] = useState(null);
  const [starting, setStarting] = useState(true);
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [wishCode, setWishCode] = useState('');
  const [scrub, setScrub] = useState(null); // local position while dragging
  const { toasts, push, dismiss } = useToasts();
  const codeRef = useRef(null);

  /* ------------------------------------------------- session bootstrap --- */
  const boot = useCallback(async () => {
    setStarting(true);
    const saved = storage.read(KEY);
    if (saved?.code && saved?.masterToken) {
      const resumed = await ask('master:resume', saved);
      if (resumed.ok) {
        codeRef.current = saved.code;
        setSession(resumed.state);
        setStarting(false);
        return;
      }
      storage.clear(KEY);
    }
    const created = await ask('master:create');
    if (!created.ok) {
      push(created.error, 'error');
      setStarting(false);
      return;
    }
    storage.write(KEY, { code: created.code, masterToken: created.masterToken });
    codeRef.current = created.code;
    setSession(created.state);
    setStarting(false);
  }, [push]);

  useEffect(() => {
    if (socket.connected) boot();
    const onConnect = () => boot();
    socket.on('connect', onConnect);
    return () => socket.off('connect', onConnect);
  }, [boot]);

  useEffect(() => {
    const onState = (state) => setSession(state);
    const onToast = (t) => push(t.message, t.kind);
    const onEnded = () => {
      storage.clear(KEY);
      setSession(null);
      navigate('#/');
    };
    socket.on('state', onState);
    socket.on('toast', onToast);
    socket.on('session:ended', onEnded);
    return () => {
      socket.off('state', onState);
      socket.off('toast', onToast);
      socket.off('session:ended', onEnded);
    };
  }, [navigate, push]);

  /* ------------------------------------------------------------ actions --- */
  const control = async (action, value) => {
    const res = await ask('control', { action, value });
    if (!res.ok) push(res.error, 'error');
  };

  const addSong = async (event) => {
    event.preventDefault();
    const value = url.trim();
    if (!value) return;
    setAdding(true);
    const res = await ask('queue:add', { url: value });
    setAdding(false);
    if (res.ok) {
      setUrl('');
      push(`Added ${res.song.title}`, 'ok');
    } else {
      push(res.error, 'error');
    }
  };

  const importWishlist = async (event) => {
    event.preventDefault();
    const code = wishCode.trim();
    if (!/^\d{4}$/.test(code)) return push('A wishlist code is four digits.', 'error');
    const res = await ask('wishlist:import', { code });
    if (res.ok) {
      setWishCode('');
      push(`Added ${res.added} song${res.added === 1 ? '' : 's'} from the wishlist`, 'ok');
    } else {
      push(res.error, 'error');
    }
  };

  const remove = async (songId) => {
    const res = await ask('queue:remove', { songId });
    if (!res.ok) push(res.error, 'error');
  };

  const jump = async (songId) => {
    const res = await ask('queue:jump', { songId });
    if (!res.ok) push(res.error, 'error');
  };

  const endSession = async () => {
    await ask('master:end');
    storage.clear(KEY);
    navigate('#/');
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(session.code);
      push('Master code copied', 'ok');
    } catch {
      push('Copy blocked by the browser. Read the digits out instead.', 'error');
    }
  };

  /* --------------------------------------------------------------- view --- */
  if (starting || !session) {
    return (
      <main className="page page--master">
        <BackLink onClick={() => navigate('#/')} />
        <p className="muted">
          {serverConnected ? 'Starting a session…' : 'Waiting for the Glitch server…'}
        </p>
      </main>
    );
  }

  const { playback, currentSong, queue } = session;
  const duration = playback.duration || 0;
  const position = scrub ?? playback.currentTime ?? 0;
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  const external = playback.mode === 'external';

  return (
    <main className="page page--master">
      <header className="bar">
        <BackLink onClick={() => navigate('#/')} />
        <Status
          online={session.mobileOnline}
          onlineText="Phone connected"
          offlineText={session.mobilePaired ? 'Phone offline' : 'Waiting for phone'}
        />
      </header>

      <section className="panel panel--code">
        <div>
          <p className="label">Master code</p>
          <CodeDigits code={session.code} />
          <p className="muted small">
            {session.mobilePaired
              ? 'Paired. The phone rejoins on its own after a network drop.'
              : 'Open Glitch on your phone, choose Mobile device, and type these digits.'}
          </p>
        </div>
        <div className="panel__actions">
          <button className="btn btn--ghost" onClick={copyCode}>
            Copy code
          </button>
          <button className="btn btn--ghost" onClick={endSession}>
            End session
          </button>
        </div>
      </section>

      <div className="grid">
        <section className="panel">
          <p className="label">Now playing</p>

          {!currentSong && <p className="empty">Queue is empty. Paste a YouTube link below.</p>}

          {currentSong && (
            <div className="np">
              <img className="np__art" src={currentSong.thumbnail} alt="" />
              <div className="np__meta">
                <h2 className="np__title">
                  <Equalizer active={playback.playing && !external} />
                  {currentSong.title}
                </h2>
                <p className="np__artist">{currentSong.author}</p>
                <p className="np__state">
                  {playback.status === 'error'
                    ? playback.error?.message || 'This video will not play.'
                    : external
                    ? 'Playing in Brave on the phone — position is not reported'
                    : playback.status === 'loading'
                    ? 'Loading on the phone…'
                    : playback.status === 'buffering'
                    ? 'Buffering…'
                    : playback.playing
                    ? 'Playing on the phone'
                    : 'Paused'}
                </p>
              </div>
            </div>
          )}

          <div className={`seek ${external || !currentSong ? 'seek--dead' : ''}`}>
            <span className="seek__time">{clock(position)}</span>
            <div className="seek__track">
              <div className="seek__fill" style={{ width: `${pct}%` }} />
              <input
                className="seek__range"
                type="range"
                min={0}
                max={Math.max(duration, 1)}
                step={1}
                value={Math.min(position, Math.max(duration, 1))}
                disabled={external || !currentSong || duration <= 0}
                onChange={(e) => setScrub(Number(e.target.value))}
                onMouseUp={(e) => {
                  control('seek', Number(e.target.value));
                  setScrub(null);
                }}
                onTouchEnd={(e) => {
                  control('seek', Number(e.target.value));
                  setScrub(null);
                }}
                onKeyUp={(e) => {
                  control('seek', Number(e.target.value));
                  setScrub(null);
                }}
                aria-label="Seek"
              />
            </div>
            <span className="seek__time">{clock(duration)}</span>
          </div>

          <div className="controls">
            <button className="btn btn--round" onClick={() => control('prev')} title="Previous">
              ⏮
            </button>
            <button className="btn btn--round" onClick={() => control('nudge', -10)} title="Back 10 seconds">
              −10
            </button>
            <button
              className="btn btn--play"
              onClick={() => control('toggle')}
              title={playback.playing ? 'Pause' : 'Play'}
            >
              {playback.playing ? '❚❚' : '▶'}
            </button>
            <button className="btn btn--round" onClick={() => control('nudge', 10)} title="Forward 10 seconds">
              +10
            </button>
            <button className="btn btn--round" onClick={() => control('next')} title="Next">
              ⏭
            </button>
          </div>

          <div className="volume">
            <span className="label">Volume</span>
            <input
              type="range"
              min={0}
              max={100}
              value={playback.volume}
              onChange={(e) => control('volume', Number(e.target.value))}
              aria-label="Volume"
            />
            <span className="muted small">{playback.volume}</span>
          </div>

          {external && (
            <p className="note">
              This song opened in Brave because YouTube blocks embedding it. Transport controls only
              work for songs playing inside Glitch on the phone.
            </p>
          )}
        </section>

        <section className="panel">
          <form className="row" onSubmit={importWishlist}>
            <div className="row__grow">
              <p className="label">Guest wishlist</p>
              <input
                className="input"
                inputMode="numeric"
                placeholder="4-digit code"
                maxLength={4}
                value={wishCode}
                onChange={(e) => setWishCode(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <button className="btn" type="submit">
              Add
            </button>
          </form>

          <form className="row" onSubmit={addSong}>
            <div className="row__grow">
              <p className="label">Add a song</p>
              <input
                className="input"
                type="url"
                placeholder="https://youtube.com/watch?v=…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <button className="btn" type="submit" disabled={adding}>
              {adding ? '…' : '+'}
            </button>
          </form>

          <p className="label">Queue · {queue.length}</p>
          {queue.length === 0 && <p className="empty">Nothing queued yet.</p>}
          <ol className="queue">
            {queue.map((song) => (
              <li key={song.id} className={`qitem ${song.isCurrent ? 'qitem--now' : ''}`}>
                <button className="qitem__main" onClick={() => jump(song.id)} title="Play this now">
                  <span className="qitem__no">{String(song.position).padStart(2, '0')}</span>
                  <img className="qitem__art" src={song.thumbnail} alt="" />
                  <span className="qitem__text">
                    <span className="qitem__title">{song.title}</span>
                    <span className="qitem__artist">
                      {song.author}
                      {song.source === 'guest' ? ' · from a guest' : ''}
                    </span>
                  </span>
                  {song.isCurrent && <span className="qitem__tag">Now playing</span>}
                </button>
                <button
                  className="qitem__x"
                  onClick={() => remove(song.id)}
                  aria-label={`Remove ${song.title}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <Credit />
      <Toasts toasts={toasts} dismiss={dismiss} />
    </main>
  );
}
