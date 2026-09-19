/**
 * Glitch - Mobile.jsx
 * Designed and Developed by Saketh Phaneendra
 *
 * The phone is the real player. It loads the YouTube IFrame player, reports
 * true playback state to the server once a second, advances the queue when a
 * song ends, and falls back to opening the video in Brave when YouTube refuses
 * to embed it.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { socket, ask, storage } from '../lib/socket.js';
import { clock, openExternally } from '../lib/util.js';
import {
  BackLink,
  CodeInput,
  Credit,
  Equalizer,
  Status,
  Toasts,
  useToasts,
} from '../components/Ui.jsx';

const KEY = 'glitch:mobile';

/** Loads the YouTube IFrame API exactly once. */
let apiPromise = null;
function loadYouTubeApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev();
      resolve(window.YT);
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    tag.onerror = () => reject(new Error('Could not reach YouTube.'));
    document.head.appendChild(tag);
    setTimeout(() => reject(new Error('YouTube took too long to load.')), 15000);
  });
  return apiPromise;
}

const ERRORS = {
  2: { message: 'That video link is not valid.', embeddable: true },
  5: { message: 'The player could not load this video.', embeddable: true },
  100: { message: 'Video unavailable, private or removed.', embeddable: true },
  101: { message: 'The owner does not allow this video outside YouTube.', embeddable: false },
  150: { message: 'The owner does not allow this video outside YouTube.', embeddable: false },
};

export default function Mobile({ navigate, serverConnected }) {
  const [paired, setPaired] = useState(false);
  const [code, setCode] = useState('');
  const [pairing, setPairing] = useState(false);
  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState(null);
  const [armed, setArmed] = useState(false);
  const [mode, setMode] = useState('embedded');
  const [blocked, setBlocked] = useState(null);
  const { toasts, push, dismiss } = useToasts();

  const playerRef = useRef(null);
  const mountRef = useRef(null);
  const nonceRef = useRef(-1);
  const modeRef = useRef('embedded');
  const playerReadyRef = useRef(false);
  const pendingCommandsRef = useRef([]);
  const sessionRef = useRef(null);

  sessionRef.current = session;
  modeRef.current = mode;

  /* --------------------------------------------------------- pairing --- */
  const resume = useCallback(async () => {
    const saved = storage.read(KEY);
    if (!saved?.code || !saved?.mobileToken) {
      setChecking(false);
      return;
    }
    const res = await ask('mobile:resume', saved);
    if (res.ok) {
      setPaired(true);
      setSession(res.state);
    } else {
      storage.clear(KEY);
      push(res.error, 'error');
    }
    setChecking(false);
  }, [push]);

  useEffect(() => {
    if (socket.connected) resume();
    const onConnect = () => resume();
    socket.on('connect', onConnect);
    return () => socket.off('connect', onConnect);
  }, [resume]);

  const pair = async (entered) => {
    const value = (entered || code).trim();
    if (!/^\d{4}$/.test(value)) return push('Enter all four digits.', 'error');
    setPairing(true);
    const res = await ask('mobile:pair', { code: value });
    setPairing(false);
    if (!res.ok) return push(res.error, 'error');
    storage.write(KEY, { code: res.code, mobileToken: res.mobileToken });
    setPaired(true);
    setSession(res.state);
    push('Connected to master', 'ok');
  };

  const unpair = async () => {
    await ask('mobile:unpair');
    storage.clear(KEY);
    if (playerRef.current) {
      try {
        playerRef.current.destroy();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
      playerReadyRef.current = false;
      pendingCommandsRef.current = [];
    }
    setPaired(false);
    setSession(null);
    setArmed(false);
    setCode('');
  };

  /* ----------------------------------------------------- server state --- */
  useEffect(() => {
    const onState = (state) => setSession(state);
    const onToast = (t) => push(t.message, t.kind);
    const onEnded = () => {
      storage.clear(KEY);
      setPaired(false);
      setSession(null);
      push('The master ended the session.', 'info');
    };
    socket.on('state', onState);
    socket.on('toast', onToast);
    socket.on('session:ended', onEnded);
    return () => {
      socket.off('state', onState);
      socket.off('toast', onToast);
      socket.off('session:ended', onEnded);
    };
  }, [push]);

  /* ---------------------------------------------------------- player --- */
  const reportError = (info) => {
    setBlocked(info);
    setMode('external');
    socket.emit('mobile:error', info);
  };

  const executeCommand = useCallback((command) => {
    const { action, value, videoId, autoplay } = command || {};
    const player = playerRef.current;
    if (!player || !playerReadyRef.current) {
      pendingCommandsRef.current.push(command);
      return;
    }

    try {
      if (action === 'load' && videoId) {
        player.loadVideoById(videoId);
        if (autoplay !== false) player.playVideo();
        return;
      }
      if (action === 'play') player.playVideo();
      if (action === 'pause') player.pauseVideo();
      if (action === 'volume') player.setVolume(Math.min(100, Math.max(0, Number(value))));
      if (action === 'seek') player.seekTo(Math.max(0, Number(value)), true);
      if (action === 'nudge') {
        const target = Math.max(0, (player.getCurrentTime() || 0) + Number(value));
        player.seekTo(target, true);
      }
    } catch {
      pendingCommandsRef.current.push(command);
    }
  }, []);

  const buildPlayer = useCallback(
    async (videoId) => {
      const YT = await loadYouTubeApi().catch((err) => {
        push(err.message, 'error');
        return null;
      });
      if (!YT || !mountRef.current) return;

      playerRef.current = new YT.Player(mountRef.current, {
        videoId,
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (event) => {
            playerReadyRef.current = true;

            // Apply the server's current state instead of blindly playing.
            const currentPlayback = sessionRef.current?.playback;
            const shouldPlay = currentPlayback?.playing !== false;
            try {
              event.target.setVolume(
                Math.min(100, Math.max(0, Number(currentPlayback?.volume ?? 100)))
              );
              if (shouldPlay) event.target.playVideo();
              else event.target.pauseVideo();
            } catch {
              /* player may still be settling */
            }

            // Commands received while YouTube was loading are replayed now.
            const pending = pendingCommandsRef.current.splice(0);
            for (const command of pending) {
              executeCommand(command);
            }
          },
          onStateChange: (event) => {
            const YTS = window.YT.PlayerState;
            if (event.data === YTS.ENDED) {
              const current = sessionRef.current?.currentSong;
              socket.emit('mobile:ended', { videoId: current?.videoId });
            }
            if (event.data === YTS.PLAYING) {
              setBlocked(null);
              setMode('embedded');
            }
          },
          onError: (event) => {
            const info = ERRORS[event.data] || {
              message: 'This video cannot play here.',
              embeddable: true,
            };
            reportError(info);
          },
        },
      });
    },
    [push]
  );

  // Arm playback with a real tap: mobile browsers will not start audio without one.
  const start = async () => {
    setArmed(true);
    const current = session?.currentSong;
    if (!current) return;
    if (!playerRef.current) await buildPlayer(current.videoId);
    nonceRef.current = session.playbackNonce;
  };

  // Load a new song whenever the server bumps the playback nonce.
  useEffect(() => {
    if (!armed || !session?.currentSong) return;
    if (session.playbackNonce === nonceRef.current) return;
    nonceRef.current = session.playbackNonce;
    setBlocked(null);
    setMode('embedded');
    const player = playerRef.current;
    if (!player) {
      buildPlayer(session.currentSong.videoId);
      return;
    }
    try {
      player.loadVideoById(session.currentSong.videoId);
    } catch {
      buildPlayer(session.currentSong.videoId);
    }
  }, [armed, session, buildPlayer]);

  // Commands from the master. Commands are buffered while YouTube is loading.
  useEffect(() => {
    const onCommand = (command) => executeCommand(command);
    socket.on('command', onCommand);
    return () => socket.off('command', onCommand);
  }, [executeCommand]);

  // Heartbeat: the phone is the source of truth for position and duration.
  useEffect(() => {
    if (!paired) return undefined;
    const timer = setInterval(() => {
      const player = playerRef.current;
      if (modeRef.current === 'external') {
        socket.emit('mobile:state', {
          currentTime: 0,
          duration: 0,
          playing: false,
          status: 'external',
          mode: 'external',
        });
        return;
      }
      if (!player || typeof player.getCurrentTime !== 'function') return;
      const YTS = window.YT?.PlayerState || {};
      let state;
      try {
        state = player.getPlayerState();
      } catch {
        return;
      }
      const status =
        state === YTS.PLAYING
          ? 'playing'
          : state === YTS.PAUSED
          ? 'paused'
          : state === YTS.BUFFERING
          ? 'buffering'
          : state === YTS.ENDED
          ? 'ended'
          : 'loading';
      socket.emit('mobile:state', {
        currentTime: player.getCurrentTime() || 0,
        duration: player.getDuration() || 0,
        playing: state === YTS.PLAYING,
        status,
        mode: 'embedded',
        volume: typeof player.getVolume === 'function' ? player.getVolume() : undefined,
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [paired]);

  /* ------------------------------------------------------------ views --- */
  if (checking) {
    return (
      <main className="page page--mobile">
        <BackLink onClick={() => navigate('#/')} />
        <p className="muted">Checking for an existing pairing…</p>
      </main>
    );
  }

  if (!paired) {
    return (
      <main className="page page--mobile">
        <BackLink onClick={() => navigate('#/')} />
        <h1 className="wordmark wordmark--sm">GLITCH</h1>
        <p className="lead">Type the code shown on the desktop.</p>
        <CodeInput value={code} onChange={setCode} onComplete={pair} disabled={pairing} />
        <button className="btn btn--wide" onClick={() => pair()} disabled={pairing}>
          {pairing ? 'Connecting…' : 'Connect'}
        </button>
        <p className="muted small">
          Connect your Bluetooth speaker to this phone before you start. This phone plays the audio.
        </p>
        <Credit />
        <Toasts toasts={toasts} dismiss={dismiss} />
      </main>
    );
  }

  const current = session?.currentSong;
  const playback = session?.playback;

  return (
    <main className="page page--mobile">
      <header className="bar">
        <BackLink onClick={() => navigate('#/')} />
        <Status
          online={serverConnected}
          onlineText="Connected"
          offlineText="Reconnecting…"
        />
      </header>

      <p className="muted small">Paired to master {session?.code}</p>

      {!current && <p className="empty">Waiting for the master to add a song.</p>}

      {current && !armed && (
        <div className="panel panel--start">
          <img className="np__art" src={current.thumbnail} alt="" />
          <h2 className="np__title">{current.title}</h2>
          <p className="np__artist">{current.author}</p>
          <button className="btn btn--wide" onClick={start}>
            Start playback
          </button>
          <p className="muted small">
            Phone browsers need one tap before they will play audio. After this tap, Glitch moves
            through the queue on its own.
          </p>
        </div>
      )}

      <div className={`playerwrap ${armed && !blocked ? '' : 'playerwrap--hidden'}`}>
        <div ref={mountRef} />
      </div>

      {armed && current && !blocked && (
        <div className="panel">
          <h2 className="np__title">
            <Equalizer active={playback?.playing} />
            {current.title}
          </h2>
          <p className="np__artist">{current.author}</p>
          <p className="muted small">
            {clock(playback?.currentTime)} / {clock(playback?.duration)} · controlled from the
            desktop
          </p>
        </div>
      )}

      {blocked && current && (
        <div className="panel panel--blocked">
          <p className="label">Can’t play inside Glitch</p>
          <p>{blocked.message}</p>
          <button className="btn btn--wide" onClick={() => openExternally(current.url)}>
            Open in Brave
          </button>
          <button
            className="btn btn--ghost btn--wide"
            onClick={() => socket.emit('mobile:ended', { videoId: current.videoId })}
          >
            Skip to next song
          </button>
          <p className="muted small">
            Glitch cannot control or track a video playing in another browser. Come back to this tab
            and tap “Skip to next song” when it finishes.
          </p>
        </div>
      )}

      <button className="btn btn--ghost btn--wide" onClick={unpair}>
        Disconnect
      </button>

      <Credit />
      <Toasts toasts={toasts} dismiss={dismiss} />
    </main>
  );
}
