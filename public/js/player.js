// Audio engine: one <audio> element, Media Session for lock-screen controls,
// queue + "play next", sleep timer, resume, listening stats.
import { state, emit, getTrack, getPlaylist, saveTrack, saveTrackSoon, saveSession, addListen, setSetting, continueTrack, MARK_COLORS } from './store.js';
import { get as dbGet } from './db.js';
import { artworkFor } from './artwork.js';
import { clamp, uid, device } from './util.js';

const audio = document.getElementById('audio');
export const audioEl = audio;

export const P = {
  id: null,
  ready: false,
  queue: [],
  context: { ids: [], label: 'Library' },
  history: [],
  sleep: { mode: 'off', endsAt: 0, total: 0 },
  volumeSupported: true,
};

let objectUrl = null;
let pendingSeek = 0;
let lastTick = 0;
let baseVolume = 1;
let sleepTimer = null;

export const current = () => (P.id ? getTrack(P.id) : null);
export const isPlaying = () => Boolean(P.id) && !audio.paused && !audio.ended;
export const time = () => (pendingSeek && !P.ready ? pendingSeek : audio.currentTime || 0);
export const duration = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : current()?.duration || 0);

// iOS ignores element volume (hardware buttons only) — detect instead of pretending.
try {
  const v = audio.volume;
  audio.volume = 0.42;
  P.volumeSupported = Math.abs(audio.volume - 0.42) < 0.01 && !device.ios;
  audio.volume = v;
} catch {
  P.volumeSupported = false;
}

/* ───────────── loading & transport ───────────── */

export function load(id, { autoplay = true, at = null, context = null, noHistory = false } = {}) {
  const t = getTrack(id);
  if (!t) return false;
  const blob = state.blobs.get(id);
  if (!blob) {
    // Not cached in memory (rare) — fetch from IndexedDB, then retry.
    dbGet('blobs', id).then((row) => {
      if (row?.blob) {
        state.blobs.set(id, row.blob);
        load(id, { autoplay, at, context, noHistory });
      } else emit('player:error', { message: 'Audio file missing on this device.' });
    });
    return false;
  }

  if (P.id && P.id !== id) {
    commitPosition();
    if (!noHistory) {
      P.history.push(P.id);
      if (P.history.length > 60) P.history.shift();
    }
  }
  if (context) P.context = { ids: context.ids.slice(0, 800), label: context.label || 'Library' };
  P.queue = P.queue.filter((q) => q !== id);

  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(blob);

  let start = at;
  if (start == null) start = t.finished ? 0 : t.position || 0;
  if (t.finished && at == null) {
    t.finished = false;
    t.position = 0;
  }
  P.id = id;
  P.ready = false;
  pendingSeek = start > 0.5 ? start : 0;

  audio.defaultPlaybackRate = state.settings.speed;
  audio.src = objectUrl;
  audio.playbackRate = state.settings.speed;
  audio.preservesPitch = true;
  if (pendingSeek) {
    try {
      audio.currentTime = pendingSeek;
    } catch {}
  }

  t.lastPlayedAt = Date.now();
  saveTrack(t, { silent: true });
  saveSession({ lastId: id, queue: P.queue, context: P.context });
  setMetadata(t);
  emit('player:load', t);
  emit('player:queue');
  if (autoplay) play();
  else emit('player:state');
  return true;
}

export function play() {
  if (!P.id) {
    const t = continueTrack(null);
    if (t) load(t.id, { autoplay: true });
    return;
  }
  const p = audio.play();
  p?.catch?.((err) => {
    if (err?.name === 'NotAllowedError') emit('player:blocked');
  });
}
export const pause = () => audio.pause();
export const toggle = () => (audio.paused ? play() : pause());

export function seek(t) {
  if (!P.id) return;
  const d = duration();
  const target = clamp(t, 0, Math.max(0, d - 0.3));
  if (!P.ready) pendingSeek = target;
  try {
    audio.currentTime = target;
  } catch {}
  const tr = current();
  if (tr) {
    tr.position = target;
    if (tr.finished && target < d - 2) tr.finished = false;
  }
  commitPosition();
  emit('player:time', { seek: true });
  updatePositionState();
}

export function skip(dir) {
  const step = dir < 0 ? state.settings.skipBack : state.settings.skipFwd;
  seek(time() + dir * step);
  emit('player:skip', { dir, step });
}

function contextNext(from = P.id) {
  const ids = P.context.ids.filter((id) => getTrack(id));
  const i = ids.indexOf(from);
  for (let k = i + 1; k < ids.length; k++) if (!getTrack(ids[k]).finished) return ids[k];
  return null;
}

function nextId(auto) {
  while (P.queue.length) {
    const id = P.queue.shift();
    if (getTrack(id) && id !== P.id) return id;
  }
  if (auto && !state.settings.autoplay) return null;
  return contextNext();
}

export function next({ auto = false } = {}) {
  const id = nextId(auto);
  if (!id) {
    if (!auto) emit('player:end-of-queue');
    emit('player:queue');
    return false;
  }
  load(id, { autoplay: true });
  return true;
}

export function prev() {
  if (time() > 4) return seek(0);
  let id = null;
  while (P.history.length && !id) {
    const h = P.history.pop();
    if (getTrack(h) && h !== P.id) id = h;
  }
  if (!id) {
    const ids = P.context.ids.filter((x) => getTrack(x));
    const i = ids.indexOf(P.id);
    if (i > 0) id = ids[i - 1];
  }
  if (!id) return seek(0);
  load(id, { autoplay: true, noHistory: true });
}

export function unload() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  P.id = null;
  P.ready = false;
  if (ms) ms.metadata = null;
  saveSession({ lastId: null });
  emit('player:load', null);
  emit('player:state');
}

export function playFrom(id, ids, label) {
  if (P.id === id && P.ready) {
    toggle();
    return;
  }
  load(id, { autoplay: true, context: { ids, label } });
}

function commitPosition() {
  const t = current();
  if (!t) return;
  if (P.ready && !pendingSeek) t.position = audio.currentTime;
  saveTrack(t, { silent: true });
}

/* ───────────── queue ───────────── */

function queueChanged() {
  saveSession({ queue: P.queue, context: P.context });
  emit('player:queue');
}
export function playNext(id) {
  if (id === P.id) return;
  P.queue = [id, ...P.queue.filter((x) => x !== id)];
  queueChanged();
}
export function addToQueue(id) {
  if (id === P.id || P.queue.includes(id)) return;
  P.queue.push(id);
  queueChanged();
}
export function removeFromQueue(id) {
  P.queue = P.queue.filter((x) => x !== id);
  queueChanged();
}
export function moveInQueue(from, to) {
  const [x] = P.queue.splice(from, 1);
  P.queue.splice(to, 0, x);
  queueChanged();
}
export function clearQueue() {
  P.queue = [];
  queueChanged();
}
/** What plays after the queue runs out (autoplay preview). */
export function contextPreview(n = 5) {
  const out = [];
  let from = P.id;
  const seen = new Set([P.id, ...P.queue]);
  for (let i = 0; i < 400 && out.length < n; i++) {
    const id = contextNext(from);
    if (!id) break;
    if (!seen.has(id)) out.push(id);
    seen.add(id);
    from = id;
  }
  return out;
}

/* ───────────── rate / volume ───────────── */

export function setSpeed(r) {
  r = clamp(Math.round(r * 100) / 100, 0.5, 3);
  audio.playbackRate = r;
  audio.defaultPlaybackRate = r;
  setSetting('speed', r);
  emit('player:rate', r);
  updatePositionState();
}

export function setVolume(v) {
  baseVolume = clamp(v, 0, 1);
  audio.volume = baseVolume;
  if (audio.muted && v > 0) audio.muted = false;
  emit('player:volume');
}
export const commitVolume = () => setSetting('volume', baseVolume);
export function toggleMute() {
  audio.muted = !audio.muted;
  emit('player:volume');
}

/* ───────────── sleep timer ───────────── */

export function setSleep(minutes) {
  clearInterval(sleepTimer);
  restoreVolume();
  if (minutes === 'end') P.sleep = { mode: 'end', endsAt: 0, total: 0 };
  else if (minutes > 0) {
    P.sleep = { mode: 'time', endsAt: Date.now() + minutes * 60000, total: minutes * 60000 };
    sleepTimer = setInterval(checkSleep, 1000);
  } else P.sleep = { mode: 'off', endsAt: 0, total: 0 };
  emit('player:sleep');
}
export function extendSleep(minutes) {
  if (P.sleep.mode !== 'time') return setSleep(minutes);
  P.sleep.endsAt += minutes * 60000;
  P.sleep.total += minutes * 60000;
  restoreVolume();
  emit('player:sleep');
}
export const sleepLeft = () => (P.sleep.mode === 'time' ? Math.max(0, P.sleep.endsAt - Date.now()) : 0);

function checkSleep() {
  if (P.sleep.mode !== 'time') return;
  const left = sleepLeft();
  if (left <= 0) {
    pause();
    clearInterval(sleepTimer);
    P.sleep = { mode: 'off', endsAt: 0, total: 0 };
    setTimeout(restoreVolume, 400);
    emit('player:sleep');
    emit('player:sleep-done');
    return;
  }
  if (state.settings.sleepFade && P.volumeSupported && left < 30000 && !audio.paused) {
    audio.volume = baseVolume * Math.max(0.04, left / 30000);
  }
  emit('player:sleep-tick');
}
function restoreVolume() {
  if (P.volumeSupported) audio.volume = baseVolume;
}

/* ───────────── marks & notes ───────────── */

export function addMark(trackId = P.id, at = time(), name = '') {
  const t = getTrack(trackId);
  if (!t) return null;
  const n = t.marks.length;
  const m = { id: uid(), t: at, name: name || `Mark ${n + 1}`, color: MARK_COLORS[n % MARK_COLORS.length], at: Date.now() };
  t.marks = [...t.marks, m].sort((a, b) => a.t - b.t);
  saveTrack(t, { silent: true });
  emit('marks', { trackId, added: m.id });
  return m;
}
export function updateMark(trackId, markId, patch) {
  const t = getTrack(trackId);
  const m = t?.marks.find((x) => x.id === markId);
  if (!m) return;
  Object.assign(m, patch);
  saveTrack(t, { silent: true });
  emit('marks', { trackId, changed: markId });
}
export function removeMark(trackId, markId) {
  const t = getTrack(trackId);
  if (!t) return;
  t.marks = t.marks.filter((m) => m.id !== markId);
  saveTrack(t, { silent: true });
  emit('marks', { trackId, removed: markId });
}
export function addNote(trackId, text, at = null) {
  const t = getTrack(trackId);
  if (!t || !text.trim()) return null;
  const n = { id: uid(), text: text.trim().slice(0, 2000), t: at, at: Date.now() };
  t.notes = [...(t.notes || []), n];
  saveTrack(t, { silent: true });
  emit('notes', { trackId, added: n.id });
  return n;
}
export function removeNote(trackId, noteId) {
  const t = getTrack(trackId);
  if (!t) return;
  t.notes = t.notes.filter((n) => n.id !== noteId);
  saveTrack(t, { silent: true });
  emit('notes', { trackId, removed: noteId });
}

/* ───────────── media session (lock screen, headphones, car) ───────────── */

const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;

export function setMetadata(t = current()) {
  if (!ms || !t) return;
  const pl = t.playlists.map(getPlaylist).find(Boolean);
  try {
    ms.metadata = new MediaMetadata({
      title: t.title,
      artist: t.uploader || t.source || 'Earmark',
      album: pl?.name || 'Earmark',
      artwork: [{ src: artworkFor(t), sizes: '512x512', type: 'image/png' }],
    });
  } catch {}
}

function updatePositionState() {
  if (!ms?.setPositionState) return;
  const d = audio.duration;
  if (!Number.isFinite(d) || d <= 0) return;
  try {
    ms.setPositionState({ duration: d, playbackRate: audio.playbackRate || 1, position: clamp(audio.currentTime, 0, d) });
  } catch {}
}

if (ms) {
  const set = (action, fn) => {
    try {
      ms.setActionHandler(action, fn);
    } catch {}
  };
  set('play', () => play());
  set('pause', () => pause());
  set('stop', () => pause());
  set('seekbackward', (d) => seek(time() - (d?.seekOffset || state.settings.skipBack)));
  set('seekforward', (d) => seek(time() + (d?.seekOffset || state.settings.skipFwd)));
  set('seekto', (d) => {
    if (d.fastSeek && 'fastSeek' in audio) audio.fastSeek(d.seekTime);
    else seek(d.seekTime);
  });
  set('previoustrack', () => prev());
  set('nexttrack', () => next());
}

/* ───────────── element events ───────────── */

audio.addEventListener('loadedmetadata', () => {
  P.ready = true;
  if (pendingSeek && Math.abs(audio.currentTime - pendingSeek) > 1) {
    try {
      audio.currentTime = pendingSeek;
    } catch {}
  }
  pendingSeek = 0;
  audio.playbackRate = state.settings.speed;
  const t = current();
  if (t && Number.isFinite(audio.duration) && Math.abs((t.duration || 0) - audio.duration) > 1) {
    t.duration = audio.duration;
    saveTrack(t, { silent: true });
  }
  updatePositionState();
  emit('player:time');
});

audio.addEventListener('timeupdate', () => {
  const t = current();
  if (!t || !P.ready) return;
  t.position = audio.currentTime;
  saveTrackSoon(t);
  const now = performance.now();
  if (!audio.paused && lastTick) {
    const dt = (now - lastTick) / 1000;
    if (dt > 0 && dt < 2.5) addListen(dt);
  }
  lastTick = audio.paused ? 0 : now;
  checkSleep();
  emit('player:time');
});

audio.addEventListener('play', () => {
  lastTick = performance.now();
  if (ms) ms.playbackState = 'playing';
  updatePositionState();
  emit('player:state');
});
audio.addEventListener('pause', () => {
  lastTick = 0;
  commitPosition();
  if (ms) ms.playbackState = 'paused';
  emit('player:state');
});
audio.addEventListener('waiting', () => emit('player:state'));
audio.addEventListener('playing', () => emit('player:state'));
audio.addEventListener('ratechange', updatePositionState);
audio.addEventListener('ended', () => {
  const t = current();
  if (t) {
    t.finished = true;
    t.position = 0;
    t.plays = (t.plays || 0) + 1;
    saveTrack(t);
  }
  if (P.sleep.mode === 'end') {
    setSleep(0);
    emit('player:sleep-done');
    emit('player:state');
    return;
  }
  if (!next({ auto: true })) emit('player:state');
});
audio.addEventListener('error', () => {
  if (P.id) emit('player:error', { message: "This audio couldn't be played." });
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) commitPosition();
});
addEventListener('pagehide', commitPosition);

/* ───────────── boot ───────────── */

export function restore() {
  baseVolume = state.settings.volume ?? 1;
  if (P.volumeSupported) audio.volume = baseVolume;
  const s = state.session;
  P.queue = (s.queue || []).filter((id) => getTrack(id));
  if (s.context?.ids) P.context = { ids: s.context.ids.filter((id) => getTrack(id)), label: s.context.label || 'Library' };
  if (s.lastId && getTrack(s.lastId)) load(s.lastId, { autoplay: false });
}
