import { sprite } from './icons.js';
import { load, state, on, emit, updateTrack } from './store.js';
import * as player from './player.js';
import * as api from './api.js';
import { initNav, closeTop } from './nav.js';
import { mountHome, handleResult, runImport } from './ui/home.js';
import { restorePending, pendingLinks } from './importer.js';
import { repairLibrary, repairTrack, tidyTitles } from './repair.js';
import { initFx } from './fx.js';
import { mountPlayer, openPlayer } from './ui/player-ui.js';
import { addLink } from './downloads.js';
import { extractUrl, fmtTime, $ } from './util.js';
import { toast } from './ui/toast.js';

document.body.insertAdjacentHTML('afterbegin', sprite());
initNav();

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__installPrompt = e;
  emit('installable');
});
addEventListener('appinstalled', () => {
  window.__installPrompt = null;
  emit('installable');
});

// On plain static hosting (e.g. GitHub Pages) there is no /api: stop asking after the first 404.
let noServerHere = false;

async function checkServer(force = false) {
  // Shortcut-only phones have no server to ask about.
  if (state.settings.fetchVia === 'shortcut' && !state.settings.server) {
    state.server = { online: false, skipped: true };
    emit('server');
    return;
  }
  if (noServerHere && !force && !state.settings.server) return;
  try {
    const r = await api.health();
    state.server = { ...r, online: true };
    noServerHere = false;
  } catch (err) {
    if (/ 404$/.test(err?.message || '') && !state.settings.server) noServerHere = true;
    state.server = { online: false };
  }
  emit('server');
}

function handleIncoming() {
  const q = new URLSearchParams(location.search);
  const raw = [q.get('url'), q.get('text'), q.get('add'), q.get('title')].filter(Boolean).join(' ');
  if (!raw) return;
  history.replaceState({ em: 0 }, '', location.pathname);
  const url = extractUrl(raw);
  if (url) addLink(url).then(handleResult);
  else toast("That share didn't include a link", { icon: 'info' });
}

function keyboard() {
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t.matches?.('input, textarea, select, [contenteditable]')) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    if (e.key === 'Escape') return closeTop();
    if (!player.P.id) return;
    const onControl = t.closest?.('.scrub, .dial, [role="slider"]');
    switch (e.key) {
      case ' ':
      case 'k':
        if (t.closest?.('button') && e.key === ' ') return;
        e.preventDefault();
        player.toggle();
        break;
      case 'ArrowLeft':
      case 'j':
        if (onControl) return;
        e.preventDefault();
        player.skip(-1);
        break;
      case 'ArrowRight':
      case 'l':
        if (onControl) return;
        e.preventDefault();
        if (e.shiftKey) player.next();
        else player.skip(1);
        break;
      case 'm': {
        const m = player.addMark();
        if (m) toast(`Marked ${fmtTime(m.t)}`, { icon: 'mark', duration: 1600 });
        break;
      }
      case 'f': {
        const cur = player.current();
        if (cur) updateTrack(cur.id, { favorite: !cur.favorite }).then(() => emit('fav', { id: cur.id }));
        break;
      }
      case 'p':
        openPlayer();
        break;
    }
  });
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!secure) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

async function boot() {
  try {
    await load();
  } catch (err) {
    console.error(err);
    toast('Storage is unavailable here (private browsing?). Audio won’t be kept.', { icon: 'info', duration: 8000 });
  }
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 700))]);
  initFx();
  mountHome($('#home'));
  mountPlayer();
  player.restore();
  document.documentElement.classList.add('ready');

  // iOS often reloads the app while you're in Shortcuts: pick the hand-off back up.
  await restorePending();
  const waiting = pendingLinks()[0];
  if (waiting && Date.now() - waiting.at < 3600e3) {
    toast('Got the audio from Shortcuts?', { icon: 'download', duration: 9000, action: { label: 'Import', fn: runImport } });
  }

  checkServer();
  setInterval(checkServer, 45000);
  on('server:recheck', () => checkServer(true));
  addEventListener('online', checkServer);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkServer();
  });

  handleIncoming();
  keyboard();
  registerSW();

  // Saved audio from before this version: clean the names, make every file skippable.
  tidyTitles().catch(() => {});
  repairLibrary(state.session.lastId)
    .then((n) => n && toast(n === 1 ? 'Skipping now works on your saved audio' : `Skipping now works on ${n} saved audios`, { icon: 'check', duration: 4200 }))
    .catch(() => {});
  on('player:noseek', async ({ id }) => {
    const fixed = await repairTrack(id, { force: true });
    if (!fixed) toast('Couldn’t jump in this audio. Close the app fully and open it again.', { icon: 'info', duration: 6000 });
  });
}

boot();
