/**
 * Glitch - server.js
 * Designed and Developed by Saketh Phaneendra
 *
 * Production server:
 * - Serves the built React/Vite client
 * - Runs the Express API
 * - Runs the Socket.IO hub
 * - Supports Render / other cloud hosting platforms
 */

import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { Server } from 'socket.io';

import { attachSockets } from './socket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/*
 * Render and other hosting platforms provide PORT through
 * the environment. Locally, we fall back to port 3000.
 */
const PORT = Number(process.env.PORT) || 3000;

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const CLIENT_DIST = path.join(__dirname, 'client', 'dist');

const app = express();

app.disable('x-powered-by');

app.use(
  express.json({
    limit: '32kb',
  })
);

/*
 * ---------------------------------------------------------
 * HEALTH CHECK
 * ---------------------------------------------------------
 *
 * Render can use this endpoint to confirm that the server
 * is alive.
 */
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    app: 'glitch',
    environment: IS_PRODUCTION ? 'production' : 'development',
    author: 'Saketh Phaneendra',
  });
});

/*
 * ---------------------------------------------------------
 * STATIC REACT CLIENT
 * ---------------------------------------------------------
 *
 * Vite creates the production website inside:
 *
 * client/dist
 *
 * Express serves those files publicly.
 */
app.use(
  express.static(CLIENT_DIST, {
    maxAge: IS_PRODUCTION ? '1h' : 0,
    index: false,
  })
);

/*
 * ---------------------------------------------------------
 * REACT SPA FALLBACK
 * ---------------------------------------------------------
 *
 * React handles frontend routes such as:
 *
 * /master
 * /guest
 * /mobile
 *
 * API and Socket.IO requests must NOT be redirected to
 * index.html.
 */
app.get(/^\/(?!api(?:\/|$)|socket\.io(?:\/|$)).*/, (_req, res) => {
  res.sendFile(path.join(CLIENT_DIST, 'index.html'), (err) => {
    if (err && !res.headersSent) {
      res
        .status(500)
        .type('text/plain')
        .send(
          'Client build not found. Run "npm run build" before starting the server.'
        );
    }
  });
});

/*
 * ---------------------------------------------------------
 * HTTP SERVER
 * ---------------------------------------------------------
 */
const server = http.createServer(app);

/*
 * ---------------------------------------------------------
 * SOCKET.IO
 * ---------------------------------------------------------
 *
 * In production the React client and Socket.IO server are
 * served from the same Render domain, so no external CORS
 * origin is required.
 *
 * In development we allow the Vite development server.
 */
const io = new Server(server, {
  cors: IS_PRODUCTION
    ? undefined
    : {
        origin: true,
        credentials: true,
      },

  pingTimeout: 20_000,
  pingInterval: 10_000,
});

/*
 * Attach all Glitch Socket.IO functionality.
 */
attachSockets(io);

/*
 * ---------------------------------------------------------
 * LOCAL NETWORK INFORMATION
 * ---------------------------------------------------------
 *
 * Useful during local development.
 * Render does not need these addresses.
 */
function localAddresses() {
  const addresses = [];

  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (
        entry.family === 'IPv4' &&
        !entry.internal
      ) {
        addresses.push(entry.address);
      }
    }
  }

  return addresses;
}

/*
 * ---------------------------------------------------------
 * START SERVER
 * ---------------------------------------------------------
 *
 * 0.0.0.0 is important for cloud hosting because the
 * hosting platform needs to reach the application.
 */
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('==============================================');
  console.log(' GLITCH');
  console.log(' Designed and Developed by Saketh Phaneendra');
  console.log('==============================================');
  console.log('');

  console.log(`Environment: ${IS_PRODUCTION ? 'production' : 'development'}`);
  console.log(`Port: ${PORT}`);

  if (!IS_PRODUCTION) {
    console.log(`Desktop: http://localhost:${PORT}`);

    for (const ip of localAddresses()) {
      console.log(`Phone:   http://${ip}:${PORT}`);
    }
  }

  if (IS_PRODUCTION) {
    console.log('Glitch production server is running.');
  }

  console.log('');
});

/*
 * ---------------------------------------------------------
 * GRACEFUL SHUTDOWN
 * ---------------------------------------------------------
 *
 * Allows Render / hosting platforms to shut the application
 * down cleanly.
 */
const shutdown = (signal) => {
  console.log(`\nReceived ${signal}. Shutting down...`);

  io.close();

  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forced shutdown.');
    process.exit(1);
  }, 5_000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));