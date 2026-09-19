/**
 * Glitch - Home.jsx
 * Designed and Developed by Saketh Phaneendra
 */
import React from 'react';
import { Credit } from '../components/Ui.jsx';

const MODES = [
  {
    hash: '#/master',
    mark: '◉',
    name: 'Master',
    line: 'Control the music',
    hint: 'Use this on the desktop',
  },
  {
    hash: '#/guest',
    mark: '♡',
    name: 'Guest',
    line: 'Create a wishlist',
    hint: 'Up to five songs',
  },
  {
    hash: '#/mobile',
    mark: '📱',
    name: 'Mobile device',
    line: 'Connect your phone',
    hint: 'This phone plays the audio',
  },
];

export default function Home({ navigate }) {
  return (
    <main className="home">
      <header className="home__head">
        <h1 className="wordmark">GLITCH</h1>
        <p className="home__sub">Music, without the mess.</p>
      </header>

      <div className="home__cards">
        {MODES.map((mode) => (
          <button key={mode.hash} className="mode" onClick={() => navigate(mode.hash)}>
            <span className="mode__mark" aria-hidden="true">
              {mode.mark}
            </span>
            <span className="mode__name">{mode.name}</span>
            <span className="mode__line">{mode.line}</span>
            <span className="mode__hint">{mode.hint}</span>
          </button>
        ))}
      </div>

      <Credit />
    </main>
  );
}
