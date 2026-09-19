/**
 * Glitch - App.jsx
 * Designed and Developed by Saketh Phaneendra
 */
import React, { useEffect, useState } from 'react';
import { socket } from './lib/socket.js';
import Home from './pages/Home.jsx';
import Master from './pages/Master.jsx';
import Guest from './pages/Guest.jsx';
import Mobile from './pages/Mobile.jsx';

const ROUTES = { '#/master': Master, '#/guest': Guest, '#/mobile': Mobile };

function currentRoute() {
  return ROUTES[window.location.hash] ? window.location.hash : '#/';
}

export function navigate(hash) {
  window.location.hash = hash;
}

export default function App() {
  const [route, setRoute] = useState(currentRoute);
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    socket.on('connect', on);
    socket.on('disconnect', off);
    socket.io.on('reconnect', on);
    return () => {
      socket.off('connect', on);
      socket.off('disconnect', off);
      socket.io.off('reconnect', on);
    };
  }, []);

  const Page = ROUTES[route] || Home;

  return (
    <div className="app">
      {!connected && <div className="serverbar">Reconnecting to Glitch…</div>}
      <Page navigate={navigate} serverConnected={connected} />
    </div>
  );
}
