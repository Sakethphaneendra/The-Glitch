/**
 * Glitch - Guest.jsx
 * Designed and Developed by Saketh Phaneendra
 */
import React, { useState } from 'react';
import { ask } from '../lib/socket.js';
import { BackLink, CodeDigits, Credit, Toasts, useToasts } from '../components/Ui.jsx';

const SLOTS = 5;

export default function Guest({ navigate }) {
  const [urls, setUrls] = useState(Array(SLOTS).fill(''));
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const { toasts, push, dismiss } = useToasts();

  const setAt = (index, value) =>
    setUrls((list) => list.map((item, i) => (i === index ? value : item)));

  const create = async (event) => {
    event.preventDefault();
    const filled = urls.map((u) => u.trim()).filter(Boolean);
    if (filled.length === 0) return push('Add at least one song.', 'error');
    setBusy(true);
    const res = await ask('wishlist:create', { urls: filled });
    setBusy(false);
    if (!res.ok) return push(res.error, 'error');
    setResult(res);
    if (res.errors?.length) {
      push(`${res.errors.length} link${res.errors.length === 1 ? '' : 's'} skipped`, 'error');
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.code);
      push('Code copied', 'ok');
    } catch {
      push('Copy blocked by the browser. Read the digits out instead.', 'error');
    }
  };

  if (result) {
    return (
      <main className="page page--guest">
        <BackLink onClick={() => navigate('#/')} />
        <p className="label">Your wishlist code</p>
        <CodeDigits code={result.code} />
        <p className="lead">Give this code to the master.</p>
        <button className="btn btn--wide" onClick={copy}>
          Copy code
        </button>

        <ol className="queue">
          {result.songs.map((song) => (
            <li key={song.videoId} className="qitem">
              <span className="qitem__main">
                <img className="qitem__art" src={song.thumbnail} alt="" />
                <span className="qitem__text">
                  <span className="qitem__title">{song.title}</span>
                  <span className="qitem__artist">{song.author}</span>
                </span>
              </span>
            </li>
          ))}
        </ol>

        {result.errors?.length > 0 && (
          <div className="panel panel--blocked">
            <p className="label">Skipped links</p>
            {result.errors.map((e) => (
              <p key={e.url} className="small">
                {e.url} — {e.message}
              </p>
            ))}
          </div>
        )}

        <button className="btn btn--ghost btn--wide" onClick={() => setResult(null)}>
          Make another wishlist
        </button>
        <Credit />
        <Toasts toasts={toasts} dismiss={dismiss} />
      </main>
    );
  }

  return (
    <main className="page page--guest">
      <BackLink onClick={() => navigate('#/')} />
      <h1 className="wordmark wordmark--sm">Guest wishlist</h1>
      <p className="lead">Pick up to five songs. The master decides when they play.</p>

      <form onSubmit={create}>
        {urls.map((value, index) => (
          <input
            key={index}
            className="input input--stacked"
            type="url"
            placeholder={`YouTube link ${index + 1}`}
            value={value}
            onChange={(e) => setAt(index, e.target.value)}
          />
        ))}
        <button className="btn btn--wide" type="submit" disabled={busy}>
          {busy ? 'Checking links…' : 'Create wishlist code'}
        </button>
      </form>

      <Credit />
      <Toasts toasts={toasts} dismiss={dismiss} />
    </main>
  );
}
