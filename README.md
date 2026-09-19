# Glitch

**Designed and Developed by Saketh Phaneendra**

Your desktop has no Bluetooth. Your phone does. Glitch lets you sit at the desktop, paste YouTube links, and run the queue — while the phone does the actual playing through your Bluetooth speaker.

---

## What it is

Three modes, one job.

| Mode | Where you open it | What it does |
| --- | --- | --- |
| **Master** | Desktop | Shows a 4-digit code, holds the queue, runs the controls |
| **Mobile device** | Phone | Plays the audio, reports real playback position back |
| **Guest** | Anywhere | Builds a 5-song wishlist behind a code, hands it to the master |

The master never plays a note. It sends commands; the phone plays.

---

## Architecture

```
            GLITCH SERVER  (Express + Socket.IO)
                     │
           ┌─────────┴─────────┐
           │                   │
        MASTER              MOBILE
      (desktop)             (phone)
      controls              YouTube player
           │                   │
           └──── room master:7429 ────┘
                     │
                  Bluetooth
                     │
                  Speaker
```

Each session is a Socket.IO room named `master:<code>`. The master emits a command, the server validates it, the phone carries it out, and the phone's real playback state comes back up the same pipe once a second. The master's progress bar is never simulated — if the phone says 2:35, the master says 2:35, and if the phone says nothing, the master shows nothing.

### Files

```
glitch/
├── server.js                 Express + Socket.IO entry point
├── package.json
├── README.md
├── .gitignore
├── src/
│   ├── socket.js             every socket event, validated in one place
│   ├── sessionManager.js     session lifetime, pairing tokens, reconnects
│   ├── queueManager.js       pure queue logic (add, remove, next, prev)
│   ├── wishlistManager.js    guest wishlists and one-time claiming
│   ├── youtube.js            URL parsing + oEmbed metadata
│   ├── rateLimiter.js        sliding-window limits on code guessing
│   └── store.js              in-memory key/value store (swap for Redis later)
└── client/                   React + Vite
    ├── index.html
    └── src/
        ├── App.jsx           hash routing, connection banner
        ├── styles.css        the whole design system
        ├── lib/              socket singleton, localStorage, Brave links
        ├── components/Ui.jsx toasts, code boxes, status dot, equalizer
        └── pages/            Home, Master, Mobile, Guest
```

`store.js` is deliberately a four-method interface (`get/set/has/delete`). Swapping in Redis or SQLite means writing one new class, not touching the managers.

---

## Features

- 4-digit master code pairs exactly one phone
- Paste a YouTube link, get title, artist and thumbnail (no API key needed)
- Queue plays straight through — when a song ends, the next one starts on its own
- Previous, −10s, play/pause, +10s, next, seek and volume, all acting on the phone
- Real position and duration streamed from the phone to the master every second
- Guest wishlists: up to 5 songs behind a code, importable once per session
- Remove any queued song, including the one playing
- Silent reconnect: a dropped phone rejoins without retyping the code
- Master survives a browser reload with its queue intact
- Rate-limited code entry, validated URLs, no server internals sent to the browser

---

## Install and run

You need Node 18 or newer.

```bash
npm install     # installs the server and the client
npm start       # builds the client, then serves everything on port 3000
```

Development, with hot reload:

```bash
npm run dev     # server on :3000, Vite client on :5173
```

In dev mode, open the client on **:5173** — it proxies sockets to the server. In production, everything is on **:3000**.

To change the port: `PORT=8080 npm start`.

### Opening it on your phone

The phone and the desktop must be on the same Wi-Fi.

When the server starts it prints the address to use:

```
  Desktop   http://localhost:3000
  Phone     http://192.168.1.24:3000
```

If you want to find it yourself:

- **Windows** — `ipconfig`, look for IPv4 Address
- **macOS / Linux** — `ipconfig getifaddr en0` or `hostname -I`

Type that `http://192.168.x.x:3000` into the phone's browser. If it won't load, your firewall is blocking port 3000 — allow Node through it.

---

## Using it

**Master (desktop).** Open Glitch, choose Master. A 4-digit code appears. Paste a YouTube link and press `+`. The first song starts as soon as the phone is ready.

**Mobile device (phone).** Connect your Bluetooth speaker to the phone *first*. Open Glitch on the phone, choose Mobile device, type the code, and tap **Start playback** once. That one tap is required by every mobile browser before it will play audio — after it, Glitch moves through the queue by itself.

**Guest (anywhere).** Choose Guest, paste up to five links, press Create wishlist code, and read the four digits to whoever is on the master. They type it into the Guest wishlist box and the songs land at the end of the queue.

---

## Limitations, stated honestly

### YouTube can refuse a video

Some videos are unavailable, private, removed, region-locked, age-restricted, or sign-in-only. Some owners disable playback outside youtube.com entirely. Glitch does not pretend otherwise:

- An unavailable or private link is rejected the moment you paste it, with a message saying so.
- A video that loads but then refuses to play shows a card on the phone: **Open in Brave**, or **Skip to next song**.

### The Brave fallback, and what it cannot do

When a video refuses to embed, the phone offers a deep link into Brave:

- **Android** — `intent://…;package=com.brave.browser;…` with the ordinary https link as `browser_fallback_url`, so nothing breaks if Brave isn't installed
- **iOS** — `brave://open-url?url=…`
- **Anything else** — a plain new tab

**Once that video is playing in Brave, Glitch cannot control it or watch it.** No web API lets one page read the position of a video in a different browser, pause it, seek it, or find out when it ended. Browsers forbid it on purpose. So Glitch does not draw a fake progress bar or fake transport buttons for external playback. Instead:

- the master's seek bar and controls grey out and say the song is playing in Brave
- the phone shows a **Skip to next song** button you press when the track finishes, which resumes the automatic queue

That is why the embedded player is tried first: everything works there. Brave is the graceful exit, not the happy path.

### Other things worth knowing

- **One tap to start.** Mobile browsers block autoplay without a user gesture. Glitch asks for exactly one tap, at the start.
- **Keep the tab awake.** If the phone's screen locks or you switch apps, the browser may throttle or suspend the player. Keep the Glitch tab open and the screen on for a long session.
- **State lives in memory.** Restarting the server clears every session, queue and wishlist. Sessions also expire after 12 idle hours.
- **One phone per code.** A second phone trying the same code is told another device is already paired.

---

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Phone can't load the page | Same Wi-Fi? Firewall allowing port 3000? Use the IP the server printed, not `localhost`. |
| "No session with that code" | The master tab was closed or the server restarted. Reopen Master for a fresh code. |
| "Another phone is already paired" | Tap **Disconnect** on the first phone, or start a new master session. |
| Nothing comes out of the speaker | The speaker must be paired to the **phone**, not the desktop. Check the phone's own volume too. |
| Controls do nothing | The master says "Phone offline" — check the phone's Wi-Fi. |
| Song won't play, Brave card appears | That video blocks embedding. Open in Brave, then press Skip when it's done. |
| "Client build not found" | Run `npm run build`, or just use `npm start`. |

---

## Deploying it

Glitch is designed for your own Wi-Fi, but it runs anywhere Node runs.

```bash
npm install
npm run build
NODE_ENV=production PORT=3000 node server.js
```

Put it behind a reverse proxy that forwards WebSocket upgrades:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
}
```

Use a process manager (`pm2 start server.js --name glitch`) and serve it over HTTPS — some phone browser features, including reliable clipboard access, only work on a secure origin.

Before running it on the open internet, replace the in-memory store with Redis so sessions survive a restart and more than one server process can share them.

---

## Tests

The acceptance workflow is covered by a script that drives the real server over real sockets: pairing, queueing, auto-advance, every control, wishlist import and double-import, removing the playing song, phone reconnect with a forged-token check, master reload, rate limiting and offline handling — 32 checks.

```bash
node server.js &          # in one terminal
npm install --no-save socket.io-client
node test-e2e.mjs         # in another
```

The script uses placeholder video ids, so it exercises the metadata-fallback path rather than live YouTube lookups.

---

Designed and Developed by **Saketh Phaneendra**.


## Project structure

- Backend files live in the project root.
- React/Vite frontend lives in `client/`.
- Frontend source is under `client/src/` with `pages/`, `components/`, and `lib/`.
- Run `npm install` from the root, then `npm start`.
