# Earmark

Paste a YouTube / X (Twitter) / Instagram / TikTok / SoundCloud… link → get the audio as an MP3 → listen to it like a podcast.
It installs to your phone's home screen like an app, keeps playing on the lock screen, and remembers where you left off.

- **Phone app (PWA)** in `public/` — bento-tile UI, everything animated, works offline once audio is saved.
- **Tiny server** in `server.mjs` — uses [yt-dlp](https://github.com/yt-dlp/yt-dlp) + ffmpeg to turn a link into an MP3.
  The MP3 is streamed to your phone and stored **on the phone** (IndexedDB); the server deletes its copy.

---

## 1 · Run it on your computer

Requires Node 18+.

```bash
npm install
```

```bash
npm run setup
```

`setup` downloads the official standalone **yt-dlp** binary (no Python needed) from its GitHub releases into `bin/`.
ffmpeg comes from the `ffmpeg-static` npm package (installed by `npm install`).

```bash
npm start
```

Open <http://localhost:5173>. The terminal also prints your Wi-Fi address (e.g. `http://192.168.1.20:5173`).

**Try it without yt-dlp:** `npm run demo`, then paste `demo:Any Long Title (Official Video) | Channel|120`
(the number is seconds). It generates a test tone so you can try every feature.

## 2 · Put it on your phone

Installing to the home screen, lock-screen controls and offline mode need **HTTPS**
(browsers only allow them on secure sites). Pick one:

| Option | How | Notes |
| --- | --- | --- |
| **Tailscale** (recommended) | Install Tailscale on the PC and the phone, sign in to both, then run `tailscale serve --bg 5173` on the PC. Open the `https://<pc-name>.<tailnet>.ts.net` address it prints. | Private, free, stable address. Best for an installed app. |
| **Cloudflare quick tunnel** | `npx cloudflared tunnel --url http://localhost:5173` and open the `https://…trycloudflare.com` link. | Public link that **changes every run** — set an `ACCESS_KEY` (below). Fine for a quick try; not great for an installed app. |
| Same Wi-Fi, no HTTPS | Open `http://192.168.x.x:5173` | Downloading and playing work, but no install / lock-screen controls. |

Then open the app on your phone → **Settings → Add to Home Screen**. It detects iPhone vs Android
and walks you through it (on Android Chrome there's also an **Install now** button).

> Your library lives on the phone, tied to the address you installed from. Keep using the same address
> (that's why Tailscale is recommended). Listening works with the server off; only *fetching new links* needs it.

### Sharing links straight into the app
- **Android:** after installing, Earmark appears in the share sheet. YouTube → Share → Earmark, and it starts fetching.
- **iPhone:** make a Shortcut: *Receive URLs from Share Sheet* → *Open URL* `https://YOUR-ADDRESS/?add=` + *Shortcut Input*.

## 3 · iPhone with no computer

The `public/` folder works on its own on any static host (GitHub Pages included, root or sub-folder).
Without a server, the iPhone does the downloading itself:

1. Install **a-Shell** (free) and run `pip install -U yt-dlp yt-dlp-ejs yt-dlp-apple-webkit-jsi` in it.
2. Make a Shortcut named **Earmark** with a-Shell's *Execute Command* (run in app). The exact command, with a
   copy button, is in Earmark → Settings → iPhone downloader.
3. Paste a link in Earmark → Shortcuts downloads it into *On My iPhone › a-Shell › Earmark* → back in Earmark,
   tap **Import** and pick the file.

Files are named `Title [Youtube-ID].m4a`, so Import gets back the short title and the original link.
Settings → Downloader switches between **Auto** (server if one answers, otherwise the Shortcut on iPhone),
**Shortcut** and **Server**. Any audio file can also be imported with the folder button, or dropped on the window.

The YouTube part relies on a community plugin for a-Shell; if YouTube stops working, run step 1 again.

## Features

- Paste → fetch automatically (or tap the big arrow). Several downloads can run at once.
- Short, calm titles generated from noisy video titles (`lib/shorten.mjs`); rename any time.
- Playlists without friction: one-tap chips after saving, and **auto-filing** — a new video from a channel goes into the playlist that channel usually lives in (with Undo).
- **Continue** tile resumes exactly where you stopped; every audio remembers its position.
- Player: skip back/forward (3–30 s, set in Settings), next/previous, **play next** & queue (drag to reorder), speed 0.5–3× (pitch kept), volume, **sleep timer** dial (5–60 min, end of audio, 90 min, 2 h, gentle fade), favourites, share (link, link at the current time, the MP3 itself).
- **Bookmarks** with names and colours, shown on the timeline; **notes** with optional timestamps; a Marks view across everything.
- Library views: **list, tiles, compact**; filters, search, sort.
- Collapsible player (mini bar ↔ full sheet — swipe or tap), plus a **focus view** with just the time and big controls.
- Lock screen / notification / headphone / car controls via Media Session, with on-theme artwork generated per audio.
- Listening stats (this week vs last week), storage overview, offline shell.
- Keyboard (desktop): Space play/pause · ←/→ skip · Shift+→ next · M mark · F favourite · P open player · Esc back.

## Server options (environment variables)

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `5173` | Port to listen on |
| `HOST` | `0.0.0.0` | Interface to bind |
| `ACCESS_KEY` | – | If set, the API requires this key (enter it in **Settings → Server**). Use it whenever the server is reachable from the internet. |
| `MAX_PARALLEL` | `2` | Simultaneous downloads |
| `YTDLP_PATH` / `FFMPEG_PATH` | bundled | Use your own binaries |
| `AUTO_UPDATE` | on | yt-dlp self-updates when it's older than 5 days (`AUTO_UPDATE=0` to stop). Settings also has an **Update downloader** button. |
| `EARMARK_DEMO` | – | `1` enables `demo:` links (what `npm run demo` does) |

PowerShell example: `$env:ACCESS_KEY="pick-something-long"; npm start`

**Age-restricted videos, or "Sign in to confirm you're not a bot":** export your browser's YouTube cookies
(Netscape `cookies.txt` format, e.g. with a "Get cookies.txt" extension) to `data/cookies.txt`. The server picks it up automatically.

## Good to know

- **iPhone volume:** iOS doesn't let web apps change volume, so the slider is hidden there — use the side buttons. The sleep fade also only works where volume can be set (Android / desktop).
- **Background playback** works for the installed app on iOS and Android. Close the app from the app switcher and playback stops (that's the OS).
- Audio is MP3 (64 / 128 / 192 kbps — Settings → Downloads). A 1-hour talk at 128 kbps is about 55 MB.
- Only download things you have the right to keep, and respect each site's terms.

## Project layout

```
server.mjs              HTTP server, job queue, yt-dlp/ffmpeg runner, static files
lib/shorten.mjs         title shortener (node lib/shorten.mjs runs its self-check)
scripts/setup.mjs       fetches the yt-dlp binary
scripts/icons.mjs       renders the app icons (npm run icons)
public/index.html       app shell
public/css/app.css      design system, layouts, motion
public/js/              app.js (boot) · store/db (state + IndexedDB) · player (audio engine,
                        media session, sleep, queue) · downloads/api · anim (motion helpers) · ui/*
public/sw.js            offline shell
```
