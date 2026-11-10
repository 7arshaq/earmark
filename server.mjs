// Earmark server — serves the PWA and turns links into MP3s with yt-dlp + ffmpeg.
// No framework, no database: audio is handed to the phone and stored there (IndexedDB).
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { shortTitle } from './lib/shorten.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const TMP = path.join(DATA, 'tmp');
const COOKIES = path.join(DATA, 'cookies.txt');

const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '0.0.0.0';
const ACCESS_KEY = process.env.ACCESS_KEY || '';
const DEMO = process.env.EARMARK_DEMO === '1';
const MAX_PARALLEL = Math.max(1, Number(process.env.MAX_PARALLEL) || 2);
const JOB_TTL = 60 * 60 * 1000;

let FFMPEG = process.env.FFMPEG_PATH || null;
if (!FFMPEG) {
  try {
    FFMPEG = (await import('ffmpeg-static')).default;
  } catch {
    FFMPEG = null;
  }
}
const YTDLP = process.env.YTDLP_PATH || path.join(ROOT, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

fs.mkdirSync(TMP, { recursive: true });
for (const f of fs.readdirSync(TMP)) fs.rmSync(path.join(TMP, f), { force: true, recursive: true });

/* ───────────────────────── yt-dlp capabilities ───────────────────────── */

const ytdlp = { version: null, extraArgs: [], checkedAt: 0 };

function run(bin, args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), err });
    });
  });
}

async function probeYtdlp() {
  const v = await run(YTDLP, ['--version']);
  ytdlp.version = v.ok ? v.stdout.trim() : null;
  ytdlp.extraArgs = [];
  if (ytdlp.version) {
    const help = (await run(YTDLP, ['--help'])).stdout;
    // Newer YouTube extraction needs a JS runtime; we already have one: this Node binary.
    if (help.includes('--js-runtimes')) ytdlp.extraArgs.push('--js-runtimes', `node:${process.execPath}`);
  }
  ytdlp.checkedAt = Date.now();
  return ytdlp;
}

/* ───────────────────────────── jobs ───────────────────────────── */

const jobs = new Map();
const waiting = [];
let active = 0;

const QUALITIES = { low: '64K', standard: '128K', high: '192K' };

function publicJob(j) {
  return {
    id: j.id,
    url: j.url,
    stage: j.stage,
    progress: Math.round(j.progress * 1000) / 1000,
    meta: j.meta,
    size: j.size,
    error: j.error,
  };
}

function friendlyError(raw) {
  const s = String(raw || '').replace(/^ERROR:\s*/i, '').replace(/\[[^\]]+\]\s*[\w-]+:\s*/, '');
  const rules = [
    [/unsupported url/i, "That link isn't supported."],
    [/not a bot|confirm you.?re not a bot/i, 'YouTube is asking this server to sign in. Add cookies (see README) and retry.'],
    [/sign in to confirm your age|age.?restricted/i, 'This video is age-restricted. Add cookies (see README) to fetch it.'],
    [/private video/i, 'This video is private.'],
    [/members.only|join this channel/i, 'This is members-only content.'],
    [/video unavailable|has been removed|does not exist/i, 'Video unavailable — it may be deleted or region-locked.'],
    [/no video could be found|no video formats|no media/i, "Couldn't find any audio or video in that post."],
    [/http error 404/i, 'Not found (404).'],
    [/http error 403/i, 'Access denied by the site (403). Try updating the downloader in Settings.'],
    [/premieres in|live event will begin/i, "This stream hasn't started yet."],
    [/is live|live stream/i, "Live streams can't be saved until they end."],
    [/timed out|getaddrinfo|network/i, 'Network problem on the server. Try again.'],
  ];
  for (const [re, msg] of rules) if (re.test(s)) return msg;
  return s.split('\n')[0].slice(0, 180) || 'Something went wrong.';
}

function createJob(url, quality) {
  const id = crypto.randomBytes(8).toString('hex');
  const job = {
    id,
    url,
    quality: QUALITIES[quality] || QUALITIES.standard,
    stage: 'queued',
    progress: 0,
    meta: null,
    size: 0,
    file: null,
    error: null,
    createdAt: Date.now(),
    proc: null,
    stderr: '',
  };
  jobs.set(id, job);
  waiting.push(job);
  pump();
  return job;
}

function pump() {
  while (active < MAX_PARALLEL && waiting.length) {
    const job = waiting.shift();
    if (job.stage !== 'queued') continue;
    active++;
    const runner = DEMO && job.url.startsWith('demo:') ? runDemo : runYtdlp;
    runner(job)
      .catch((e) => fail(job, e?.message || String(e)))
      .finally(() => {
        active--;
        pump();
      });
  }
}

function fail(job, message) {
  if (job.stage === 'cancelled') return;
  job.stage = 'error';
  job.error = friendlyError(message);
}

function setMeta(job, raw) {
  const meta = {
    key: raw.extractor_key && raw.id ? `${String(raw.extractor_key).toLowerCase()}:${raw.id}` : null,
    title: raw.title || raw.fulltitle || 'Untitled',
    shortTitle: shortTitle(raw),
    uploader: raw.uploader || raw.channel || raw.creator || null,
    duration: Number(raw.duration) || null,
    source: raw.extractor_key || null,
    description: raw.description ? String(raw.description).slice(0, 1200) : null,
    webpage: raw.webpage_url || job.url,
    date: raw.upload_date || null,
  };
  job.meta = meta;
}

async function runYtdlp(job) {
  if (!ytdlp.version) await probeYtdlp();
  if (!ytdlp.version) throw new Error('The downloader (yt-dlp) is not installed on the server. Run: npm run setup');

  job.stage = 'starting';
  const out = path.join(TMP, `${job.id}.%(ext)s`);
  const args = [
    '--no-playlist',
    '--newline',
    '--progress',
    '--no-mtime',
    '--no-colors',
    '-f', 'bestaudio/best',
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', job.quality,
    '-o', out,
    '--print', 'before_dl:META %(.{id,title,fulltitle,uploader,channel,creator,duration,extractor_key,description,webpage_url,upload_date})j',
    '--print', 'after_move:FILE %(filepath)s',
    '--no-simulate',
    '--progress-template', 'download:PROG %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.status)s',
    ...ytdlp.extraArgs,
  ];
  if (FFMPEG) args.push('--ffmpeg-location', FFMPEG);
  if (fs.existsSync(COOKIES)) args.push('--cookies', COOKIES);
  args.push('--', job.url);

  await new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, args, { windowsHide: true });
    job.proc = proc;
    let lastErr = '';

    const onLine = (line) => {
      line = line.trim();
      if (!line) return;
      if (line.startsWith('META ')) {
        try {
          setMeta(job, JSON.parse(line.slice(5)));
        } catch {}
        if (job.stage === 'starting') job.stage = 'downloading';
      } else if (line.startsWith('PROG ')) {
        const [done, total, est, status] = line.slice(5).split(' ');
        const t = Number(total) || Number(est) || 0;
        const d = Number(done) || 0;
        job.stage = 'downloading';
        if (t > 0) job.progress = Math.min(0.999, d / t);
        if (status === 'finished') {
          job.stage = 'converting';
          job.progress = 1;
        }
      } else if (line.startsWith('FILE ')) {
        job.file = line.slice(5).trim();
      } else if (/^\[(ExtractAudio|ffmpeg|FixupM)/.test(line)) {
        job.stage = 'converting';
      } else if (/^ERROR:/i.test(line)) {
        lastErr = line;
      }
    };

    const wire = (stream, isErr) => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        if (isErr) job.stderr = (job.stderr + chunk).slice(-4000);
        buf += chunk;
        const lines = buf.split(/\r?\n|\r/);
        buf = lines.pop();
        lines.forEach(onLine);
      });
      stream.on('end', () => buf && onLine(buf));
    };
    wire(proc.stdout, false);
    wire(proc.stderr, true);

    proc.on('error', reject);
    proc.on('close', (code) => {
      job.proc = null;
      if (job.stage === 'cancelled') return resolve();
      if (code === 0) return resolve();
      reject(new Error(lastErr || job.stderr.split('\n').filter(Boolean).pop() || `yt-dlp exited with ${code}`));
    });
  });

  if (job.stage === 'cancelled') return;
  await finishFile(job);
}

async function finishFile(job) {
  let file = job.file && fs.existsSync(job.file) ? job.file : null;
  if (!file) {
    const hit = (await fsp.readdir(TMP)).find((f) => f.startsWith(job.id) && f.endsWith('.mp3'));
    if (hit) file = path.join(TMP, hit);
  }
  if (!file) throw new Error('Conversion finished but no MP3 was produced.');
  job.file = file;
  job.size = (await fsp.stat(file)).size;
  job.progress = 1;
  job.stage = 'ready';
  if (job.meta && !job.meta.duration) job.meta.duration = await probeDuration(file);
}

function probeDuration(file) {
  if (!FFMPEG) return Promise.resolve(null);
  return run(FFMPEG, ['-hide_banner', '-i', file], 15000).then(({ stderr }) => {
    const m = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  });
}

// Demo mode (EARMARK_DEMO=1): "demo:Some long title|seconds" makes a test tone so the
// whole pipeline can be exercised without hitting any real site.
async function runDemo(job) {
  if (!FFMPEG) throw new Error('ffmpeg missing');
  const spec = job.url.slice(5);
  const cut = spec.lastIndexOf('|');
  const rawTitle = cut > 0 ? spec.slice(0, cut) : spec;
  const secs = cut > 0 ? spec.slice(cut + 1) : '';
  const duration = Math.min(3600, Math.max(5, Number(secs) || 95));
  job.stage = 'starting';
  await sleep(500);
  setMeta(job, {
    id: crypto.createHash('md5').update(job.url).digest('hex').slice(0, 11),
    title: decodeURIComponent(rawTitle || 'Demo Audio — A Very Long Podcast Title (Official Video) [4K] | Demo Channel'),
    uploader: 'Demo Channel',
    duration,
    extractor_key: 'Demo',
    description: 'A generated test tone.',
    webpage_url: 'https://example.com/demo',
  });
  job.stage = 'downloading';
  for (let i = 1; i <= 12; i++) {
    if (job.stage === 'cancelled') return;
    job.progress = i / 12;
    await sleep(160);
  }
  job.stage = 'converting';
  const file = path.join(TMP, `${job.id}.mp3`);
  const f = 180 + (parseInt(job.id.slice(0, 2), 16) % 200);
  const r = await run(
    FFMPEG,
    ['-hide_banner', '-y', '-f', 'lavfi', '-i', `sine=frequency=${f}:duration=${duration}:sample_rate=44100`, '-af', 'volume=0.15', '-ac', '2', '-b:a', '64k', file],
    120000,
  );
  if (!r.ok) throw new Error('demo ffmpeg failed: ' + r.stderr.slice(-300));
  job.file = file;
  await finishFile(job);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function removeJob(job) {
  if (job.proc) {
    job.stage = 'cancelled';
    try {
      job.proc.kill();
    } catch {}
  }
  jobs.delete(job.id);
  const prefix = job.id;
  setTimeout(() => {
    fsp
      .readdir(TMP)
      .then((files) => Promise.all(files.filter((f) => f.startsWith(prefix)).map((f) => fsp.rm(path.join(TMP, f), { force: true }))))
      .catch(() => {});
  }, 1500);
}

setInterval(() => {
  const now = Date.now();
  for (const job of jobs.values()) if (now - job.createdAt > JOB_TTL) removeJob(job);
}, 5 * 60 * 1000).unref();

/* ───────────────────────────── http ───────────────────────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  const isObj = body && typeof body === 'object' && !Buffer.isBuffer(body);
  const payload = isObj ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Access-Key');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length');
}

function authorized(req, url) {
  if (!ACCESS_KEY) return true;
  const given = String(req.headers['x-access-key'] || url.searchParams.get('key') || '');
  const a = Buffer.from(given);
  const b = Buffer.from(ACCESS_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function validUrl(s) {
  if (DEMO && typeof s === 'string' && s.startsWith('demo:')) return s;
  try {
    const u = new URL(String(s).trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

async function api(req, res, url) {
  cors(res);
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

  if (parts[1] === 'health' && req.method === 'GET') {
    if (!ytdlp.version && Date.now() - ytdlp.checkedAt > 15000) await probeYtdlp();
    return send(res, 200, {
      ok: true,
      name: 'earmark',
      ytdlp: ytdlp.version,
      ffmpeg: Boolean(FFMPEG),
      demo: DEMO,
      locked: Boolean(ACCESS_KEY),
      authorized: authorized(req, url),
    });
  }

  if (!authorized(req, url)) return send(res, 401, { error: 'This server needs an access key. Add it in Settings → Server.' });

  if (parts[1] === 'jobs' && parts.length === 2 && req.method === 'POST') {
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
    const link = validUrl(body.url);
    if (!link) return send(res, 400, { error: "That doesn't look like a link." });
    const job = createJob(link, body.quality);
    return send(res, 201, publicJob(job));
  }

  if (parts[1] === 'jobs' && parts[2]) {
    const job = jobs.get(parts[2]);
    if (!job) return send(res, 404, { error: 'Job not found (it may have expired).' });

    if (parts.length === 3 && req.method === 'GET') return send(res, 200, publicJob(job));

    if (parts.length === 3 && req.method === 'DELETE') {
      removeJob(job);
      return send(res, 200, { ok: true });
    }

    if (parts[3] === 'file' && req.method === 'GET') {
      if (job.stage !== 'ready' || !job.file) return send(res, 409, { error: 'Not ready yet.' });
      const stat = await fsp.stat(job.file).catch(() => null);
      if (!stat) return send(res, 410, { error: 'File is gone.' });
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${job.id}.mp3"`,
      });
      fs.createReadStream(job.file).pipe(res);
      return;
    }
  }

  if (parts[1] === 'update' && req.method === 'POST') {
    if (!ytdlp.version) return send(res, 400, { error: 'yt-dlp is not installed. Run: npm run setup' });
    const r = await run(YTDLP, ['-U'], 120000);
    await probeYtdlp();
    return send(res, r.ok ? 200 : 500, { ok: r.ok, version: ytdlp.version, log: (r.stdout + r.stderr).trim().split('\n').slice(-4).join('\n') });
  }

  return send(res, 404, { error: 'Not found' });
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');

  let stat = await fsp.stat(file).catch(() => null);
  if (!stat || stat.isDirectory()) {
    // SPA fallback for navigations
    if (!path.extname(rel)) {
      file = path.join(PUBLIC, 'index.html');
      stat = await fsp.stat(file).catch(() => null);
    }
    if (!stat) return send(res, 404, 'Not found');
  }

  const ext = path.extname(file).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': ext === '.woff2' || ext === '.png' ? 'public, max-age=604800' : 'no-cache',
    'Last-Modified': stat.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
  };
  if (req.headers['if-modified-since'] && new Date(req.headers['if-modified-since']) >= new Date(stat.mtime.toUTCString())) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return await serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'Server error' });
  }
});

await probeYtdlp();

// Keep yt-dlp fresh — sites change often. Skipped when AUTO_UPDATE=0.
if (ytdlp.version && process.env.AUTO_UPDATE !== '0' && !process.env.YTDLP_PATH) {
  const age = Date.now() - fs.statSync(YTDLP).mtimeMs;
  if (age > 5 * 24 * 3600 * 1000) run(YTDLP, ['-U'], 120000).then(probeYtdlp);
}

server.listen(PORT, HOST, () => {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${PORT}`);
  console.log(`\n  Earmark is running`);
  console.log(`  ─ this computer:  http://localhost:${PORT}`);
  ips.forEach((u) => console.log(`  ─ same Wi-Fi:      ${u}`));
  console.log(`  ─ yt-dlp:         ${ytdlp.version || 'NOT INSTALLED — run: npm run setup'}`);
  console.log(`  ─ ffmpeg:         ${FFMPEG ? 'ok' : 'missing'}${DEMO ? '\n  ─ demo mode:      on (paste  demo:Title|seconds)' : ''}${ACCESS_KEY ? '\n  ─ access key:     required' : ''}\n`);
});
