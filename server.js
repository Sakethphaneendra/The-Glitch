/**
 * Glitch - server.js
 * Designed and Developed by Saketh Phaneendra
 *
 * Serves the built React client and runs the Socket.IO hub that connects the
 * desktop Master to the phone that actually plays the music.
 */

import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { attachSockets } from './socket.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const CLIENT_DIST = path.join(__dirname, 'client', 'dist');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'glitch', author: 'Saketh Phaneendra' });
});

app.use(express.static(CLIENT_DIST, { maxAge: '1h', index: false }));

// Single-page app fallback (skip anything under /api or /socket.io).
app.get(/^\/(?!api|socket\.io).*/, (_req, res) => {
  res.sendFile(path.join(CLIENT_DIST, 'index.html'), (err) => {
    if (err) {
      res
        .status(500)
        .type('text/plain')
        .send('Client build not found. Run "npm run build" first, then "npm start".');
    }
  });
});

const server = http.createServer(app);
const io = new Server(server, {
  // Dev mode serves the client from Vite on another port.
  cors: process.env.NODE_ENV === 'production' ? {} : { origin: true, credentials: true },
  pingTimeout: 20000,
  pingInterval: 10000,
});

attachSockets(io);

function localAddresses() {
  const out = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) out.push(entry.address);
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  GLITCH  -  Designed and Developed by Saketh Phaneendra\n');
  console.log(`  Desktop   http://localhost:${PORT}`);
  for (const ip of localAddresses()) {
    console.log(`  Phone     http://${ip}:${PORT}`);
  }
  console.log('');
});

const shutdown = () => {
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
