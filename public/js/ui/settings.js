// Settings: skip seconds, playback, downloads, install guide (device-aware), storage, server.
import { state, on, emit, setSetting, deleteTrack } from '../store.js';
import * as player from '../player.js';
import * as api from '../api.js';
import { icon, tulip } from '../icons.js';
import { h, esc, device, fmtBytes, haptic, BUILD } from '../util.js';
import { Roller, stagger, swap, reveal } from '../anim.js';
import { sfx } from '../fx.js';
import { closeView } from '../views.js';
import { confirmSheet } from './sheet.js';
import { toast } from './toast.js';
import { fetchMode, NAME_TEMPLATE } from '../importer.js';

export const tone = 'tone-navy';

const GUIDES = {
  ios: {
    name: 'iPhone & iPad',
    steps: [
      { ic: 'ios-share', t: 'Tap Share', d: 'In Safari, tap the Share button (square with an arrow). On iOS 26 it lives inside the ••• menu.' },
      { ic: 'add-box', t: 'Add to Home Screen', d: 'Scroll the share list and choose “Add to Home Screen”.' },
      { ic: 'check', t: 'Keep “Open as Web App” on', d: 'Then tap Add in the top corner.' },
      { ic: 'phone', t: 'Open it from your Home Screen', d: 'Earmark runs full-screen and keeps playing on the lock screen.' },
    ],
  },
  android: {
    name: 'Android',
    steps: [
      { ic: 'dots', t: 'Open Chrome’s menu', d: 'Tap ⋮ at the top right of Chrome.' },
      { ic: 'install', t: 'Install app', d: 'Choose “Add to Home screen”, then “Install”.' },
      { ic: 'check', t: 'Confirm', d: 'Tap Install — Earmark lands in your app drawer.' },
      { ic: 'share', t: 'Share links straight in', d: 'From YouTube or X, tap Share → Earmark and it starts fetching.' },
    ],
  },
};

// One-time setup for downloading on the iPhone itself (a-Shell runs yt-dlp; the Shortcut connects it to Earmark).
const SETUP_CMD = 'pip install -U yt-dlp yt-dlp-ejs yt-dlp-apple-webkit-jsi';
const shortcutCmd = () =>
  ['mkdir -p ~/Documents/Earmark', 'cd ~/Documents/Earmark', `yt-dlp --no-playlist -f "bestaudio[ext=m4a]/bestaudio/best" -o "${NAME_TEMPLATE}" "LINK"`].join('\n');

const codeBlock = (id, text) =>
  `<div class="code"><pre id="${id}">${esc(text)}</pre><button class="icon-btn sm press code-copy" type="button" data-copy="${id}" aria-label="Copy">${icon('clip')}</button></div>`;

function shortcutGuide(name) {
  const n = esc(name || 'Earmark');
  return [
    { ic: 'download', t: 'Get a-Shell', d: 'Free on the App Store. It runs the downloader on your iPhone.', extra: `<a class="btn ghost sm press" href="https://apps.apple.com/app/id1473805438" target="_blank" rel="noopener">${icon('external')}<span>Open in App Store</span></a>` },
    { ic: 'bolt', t: 'Install the downloader', d: 'Open a-Shell, paste this and press return. It takes about a minute.', extra: codeBlock('cmdSetup', SETUP_CMD) },
    { ic: 'plus', t: `Make a Shortcut called “${n}”`, d: 'In the Shortcuts app tap +, add a-Shell’s “Execute Command” action and paste this. Replace LINK with Shortcut Input, and set the action to run in the app.', extra: codeBlock('cmdShortcut', shortcutCmd()) },
    { ic: 'share', t: 'Turn on the Share Sheet', d: 'Optional. In the Shortcut’s ⓘ details turn on “Show in Share Sheet”, so YouTube or X → Share → Earmark works too.' },
    { ic: 'folder', t: 'Paste, then Import', d: 'Paste a link here and Shortcuts downloads it. Come back, tap Import, and pick the file from On My iPhone › a-Shell › Earmark.' },
  ]
    .map((st, i) => `<li class="step"><span class="st-n">${i + 1}</span><span class="st-ic">${icon(st.ic)}</span><span class="st-txt"><b>${st.t}</b><small>${esc(st.d)}</small>${st.extra || ''}</span></li>`)
    .join('');
}

export function mount(el) {
  const s = state.settings;
  const os = device.os;
  let guide = os === 'android' ? 'android' : 'ios';
  let stepTimer = null;

  el.innerHTML = `
    <header class="vh" data-stagger>
      <button class="back-btn press" type="button" aria-label="Back">${tulip()}</button>
      <div class="vh-titles"><h2 class="v-title">Settings</h2><span class="v-sub">Saved instantly</span></div>
    </header>
    <div class="v-body"><div class="set-cols">

      <section class="set-card tone-orange" data-stagger>
        <h3 class="tile-h">Skip buttons</h3>
        <p class="set-hint">How far ↺ and ↻ jump — in the app, on the lock screen and with headphones.</p>
        <div class="skip-set">
          <div class="skip-head"><span>${icon('back')} Back</span><span class="skip-big"><span id="sbVal">${s.skipBack}</span><em>s</em></span></div>
          <input class="range" type="range" min="3" max="30" step="1" value="${s.skipBack}" id="sbRange" aria-label="Skip back seconds">
          <div class="skip-head"><span>${icon('fwd')} Forward</span><span class="skip-big"><span id="sfVal">${s.skipFwd}</span><em>s</em></span></div>
          <input class="range" type="range" min="3" max="30" step="1" value="${s.skipFwd}" id="sfRange" aria-label="Skip forward seconds">
          <div class="range-scale"><span>3s</span><span>10s</span><span>20s</span><span>30s</span></div>
        </div>
      </section>

      <section class="set-card tone-stone install" data-stagger>
        <div class="inst-head">
          <h3 class="tile-h">Add to Home Screen</h3>
          <span class="inst-detect">${device.standalone ? `${icon('check')} Installed` : os === 'desktop' ? 'On a computer' : `Detected: ${os === 'ios' ? 'iPhone' : 'Android'}`}</span>
        </div>
        ${device.standalone ? `<p class="set-hint">You're running Earmark as an app. Nice.</p>` : ''}
        <div class="seg inv" id="instTabs" ${os !== 'desktop' && !device.standalone ? 'data-solo="1"' : ''}>
          <i class="seg-pill" aria-hidden="true"></i>
          <button type="button" data-g="ios">${icon('phone')} iPhone</button>
          <button type="button" data-g="android">${icon('phone')} Android</button>
        </div>
        <ol class="steps" id="instSteps"></ol>
        <button class="btn solid press" type="button" id="instNow" hidden>${icon('install')}<span>Install now</span></button>
        ${os === 'desktop' ? `<p class="set-hint">On a computer: in Chrome or Edge, click the install icon at the right end of the address bar.</p>` : ''}
      </section>

      <section class="set-card tone-khaki sc-guide" data-stagger id="scGuide" ${os === 'android' && s.fetchVia !== 'shortcut' ? 'hidden' : ''}>
        <div class="inst-head"><h3 class="tile-h">iPhone downloader</h3><span class="inst-detect">No computer needed</span></div>
        <p class="set-hint">Downloads happen on the phone with two free apps. One-time setup, about five minutes.</p>
        <ol class="steps sc-steps" id="scSteps">${shortcutGuide(s.shortcutName)}</ol>
        <p class="set-hint">If YouTube stops working, run step 2 again to update the downloader.</p>
      </section>

      <section class="set-card tone-paper2" data-stagger>
        <h3 class="tile-h">Playback</h3>
        <label class="row-toggle"><span><b>Autoplay next</b><small>Keep going through the list when one ends</small></span><span class="switch"><input type="checkbox" data-k="autoplay" ${s.autoplay ? 'checked' : ''}><i></i></span></label>
        ${player.P.volumeSupported ? `<label class="row-toggle"><span><b>Fade out on sleep</b><small>Volume eases down in the last 30 seconds</small></span><span class="switch"><input type="checkbox" data-k="sleepFade" ${s.sleepFade ? 'checked' : ''}><i></i></span></label>` : ''}
        <label class="row-toggle"><span><b>Sound effects</b><small>Soft clicks when you tap things</small></span><span class="switch"><input type="checkbox" data-k="sfx" ${s.sfx ? 'checked' : ''}><i></i></span></label>
        ${
          os === 'ios'
            ? `<div class="row-toggle col"><span><b>Lock screen buttons</b><small>An iPhone shows one pair beside play. Skips use your seconds from above.</small></span>
          <div class="seg full" id="lockSeg"><i class="seg-pill" aria-hidden="true"></i>
            <button type="button" data-l="skip">${icon('back')} Skip</button>
            <button type="button" data-l="tracks">${icon('next')} Prev / Next</button>
          </div></div>`
            : ''
        }
        <div class="row-toggle"><span><b>Speed</b><small>Applies to everything you play</small></span><span class="speed-pills" id="speedPills">${[1, 1.25, 1.5, 2].map((v) => `<button type="button" class="chip sm press ${s.speed === v ? 'on' : ''}" data-v="${v}">${v}×</button>`).join('')}</span></div>
      </section>

      <section class="set-card tone-silver" data-stagger>
        <h3 class="tile-h">Downloads</h3>
        <div class="row-toggle col"><span><b>Audio quality</b><small>Smaller files fit more on your phone</small></span>
          <div class="seg full" id="qualSeg"><i class="seg-pill" aria-hidden="true"></i>
            <button type="button" data-q="low">Saver<small>64k</small></button>
            <button type="button" data-q="standard">Standard<small>128k</small></button>
            <button type="button" data-q="high">High<small>192k</small></button>
          </div>
        </div>
        <label class="row-toggle"><span><b>Fetch on paste</b><small>Start the moment a link lands in the box</small></span><span class="switch"><input type="checkbox" data-k="autoFetch" ${s.autoFetch ? 'checked' : ''}><i></i></span></label>
        <label class="row-toggle"><span><b>Auto-file by channel</b><small>New audio joins the playlist its channel usually goes in</small></span><span class="switch"><input type="checkbox" data-k="autoFile" ${s.autoFile ? 'checked' : ''}><i></i></span></label>
      </section>

      <section class="set-card tone-sage" data-stagger>
        <h3 class="tile-h">On this device</h3>
        <div class="store-big"><span id="stUsed">—</span></div>
        <div class="store-bar"><i id="stBar"></i></div>
        <p class="set-hint" id="stHint">Audio is stored on this device, so it plays offline.</p>
        <div class="btn-row">
          <button class="btn ghost sm press" type="button" id="stPersist" hidden>${icon('check')}<span>Protect storage</span></button>
          <button class="btn ghost sm press" type="button" id="stClean">${icon('trash')}<span>Remove finished</span></button>
        </div>
      </section>

      <section class="set-card tone-clay" data-stagger>
        <h3 class="tile-h">Downloader</h3>
        <div class="seg inv full" id="viaSeg"><i class="seg-pill" aria-hidden="true"></i>
          <button type="button" data-via="auto">Auto</button>
          <button type="button" data-via="shortcut">Shortcut</button>
          <button type="button" data-via="server">Server</button>
        </div>
        <p class="set-hint" id="viaHint"></p>
        <div class="via-grp" id="grpShortcut">
          <label class="fld"><span>Shortcut name</span><input class="field" id="scName" type="text" value="${esc(s.shortcutName)}" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="done"></label>
        </div>
        <div class="via-grp" id="grpServer">
        <div class="srv-status" id="srvStatus"></div>
        <label class="fld"><span>Server address</span><input class="field" id="srvUrl" type="url" inputmode="url" placeholder="Same as this page" value="${esc(s.server)}" autocapitalize="none" autocorrect="off" spellcheck="false"></label>
        <label class="fld"><span>Access key</span><input class="field" id="srvKey" type="password" placeholder="Only if the server asks" value="${esc(s.accessKey)}" autocomplete="off"></label>
        <div class="btn-row">
          <button class="btn ghost sm press" type="button" id="srvCheck">${icon('restart')}<span>Check</span></button>
          <button class="btn ghost sm press" type="button" id="srvUpdate">${icon('bolt')}<span>Update downloader</span></button>
        </div>
        </div>
      </section>

      <section class="set-card tone-ink about" data-stagger>
        <h3 class="tile-h">Earmark</h3>
        <p class="set-hint">Paste a link, keep the audio, listen like a podcast. Your library, marks and notes live only on this device.</p>
        ${os === 'desktop' ? '<p class="set-hint dim">Keys: Space play/pause · ← → skip · Shift → next · M mark · F favourite</p>' : ''}
        <div class="btn-row">
          <button class="btn ghost sm press" type="button" id="copyReport">${icon('clip')}<span>Copy player report</span></button>
          <span class="build">Build ${BUILD}</span>
        </div>
      </section>
    </div></div>`;

  const q = (sel) => el.querySelector(sel);
  el.querySelector('.back-btn').addEventListener('click', closeView);

  /* skip sliders */
  const sbRoll = new Roller(q('#sbVal'));
  const sfRoll = new Roller(q('#sfVal'));
  const wireRange = (range, roll, key) => {
    const paint = () => range.style.setProperty('--p', (range.value - 3) / 27);
    paint();
    let last = Number(range.value);
    range.addEventListener('input', () => {
      const v = Number(range.value);
      roll.set(String(v), { dir: v > last ? 1 : -1 });
      if (v % 5 === 0) haptic(4);
      last = v;
      paint();
      setSetting(key, v);
    });
  };
  wireRange(q('#sbRange'), sbRoll, 'skipBack');
  wireRange(q('#sfRange'), sfRoll, 'skipFwd');

  /* toggles */
  el.addEventListener('change', (e) => {
    const k = e.target.dataset?.k;
    if (!k) return;
    setSetting(k, e.target.checked).then(() => k === 'sfx' && e.target.checked && sfx('on'));
  });
  q('#speedPills').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    player.setSpeed(Number(c.dataset.v));
    q('#speedPills').querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c));
  });

  /* segmented controls */
  const placeSeg = (seg, btn, animate = true) => {
    const pill = seg.querySelector('.seg-pill');
    if (!animate) pill.style.transition = 'none';
    pill.style.width = `${btn.offsetWidth}px`;
    pill.style.transform = `translateX(${btn.offsetLeft}px)`;
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    if (!animate) requestAnimationFrame(() => (pill.style.transition = ''));
  };
  const qual = q('#qualSeg');
  qual.addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    setSetting('quality', b.dataset.q);
    placeSeg(qual, b);
  });

  /* lock-screen buttons (iPhone) */
  const lock = q('#lockSeg');
  lock?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-l]');
    if (!b) return;
    setSetting('lockButtons', b.dataset.l);
    placeSeg(lock, b);
  });

  /* troubleshooting snapshot */
  q('#copyReport').addEventListener('click', async () => {
    const text = `Earmark build ${BUILD} · ${navigator.userAgent}\n${player.report()}`;
    try {
      await navigator.clipboard.writeText(text);
      toast('Report copied. Paste it in a message.', { icon: 'check', duration: 2600 });
    } catch {
      const { openSheet } = await import('./sheet.js');
      openSheet({ title: 'Player report', body: h(`<pre class="report">${esc(text)}</pre>`) });
    }
  });

  /* install guide */
  const tabs = q('#instTabs');
  const stepsEl = q('#instSteps');
  function renderSteps(animate) {
    const g = GUIDES[guide];
    stepsEl.innerHTML = g.steps
      .map((st, i) => `<li class="step" data-i="${i}"><span class="st-n">${i + 1}</span><span class="st-ic">${icon(st.ic)}</span><span class="st-txt"><b>${esc(st.t)}</b><small>${esc(st.d)}</small></span></li>`)
      .join('');
    if (animate) stagger(stepsEl.children, { y: 8, step: 50 });
    cycle(0);
  }
  function cycle(i) {
    clearInterval(stepTimer);
    let cur = i;
    const mark = () => stepsEl.querySelectorAll('.step').forEach((s, k) => s.classList.toggle('on', k === cur));
    mark();
    if (device.standalone) return;
    stepTimer = setInterval(() => {
      cur = (cur + 1) % GUIDES[guide].steps.length;
      mark();
    }, 2600);
  }
  stepsEl.addEventListener('click', (e) => {
    const st = e.target.closest('.step');
    if (st) cycle(Number(st.dataset.i));
  });
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-g]');
    if (!b || b.dataset.g === guide) return;
    guide = b.dataset.g;
    placeSeg(tabs, b);
    swap(stepsEl, () => renderSteps(true));
  });
  const instNow = q('#instNow');
  const showInstall = () => reveal(instNow, Boolean(window.__installPrompt) && !device.standalone);
  instNow.addEventListener('click', async () => {
    const p = window.__installPrompt;
    if (!p) return;
    p.prompt();
    const r = await p.userChoice.catch(() => null);
    if (r?.outcome === 'accepted') toast('Installing Earmark…', { icon: 'install' });
    window.__installPrompt = null;
    showInstall();
  });
  showInstall();

  /* storage */
  async function renderStorage() {
    const mine = [...state.blobs.values()].reduce((n, b) => n + (b?.size || 0), 0);
    q('#stUsed').innerHTML = `${fmtBytes(mine).replace(/ (\w+)$/, '<em> $1</em>')}`;
    let quota = 0;
    let persisted = false;
    try {
      const est = await navigator.storage?.estimate?.();
      quota = est?.quota || 0;
      persisted = (await navigator.storage?.persisted?.()) || false;
    } catch {}
    q('#stBar').style.transform = `scaleX(${quota ? Math.min(1, Math.max(0.01, mine / quota)) : 0.01})`;
    q('#stHint').textContent = `${state.tracks.length} audio${state.tracks.length === 1 ? '' : 's'}${quota ? ` · about ${fmtBytes(Math.max(0, quota - mine))} free for the app` : ''}${persisted ? ' · protected from cleanup' : ''}`;
    reveal(q('#stPersist'), !persisted && Boolean(navigator.storage?.persist));
  }
  q('#stPersist').addEventListener('click', async () => {
    const ok = await navigator.storage.persist().catch(() => false);
    toast(ok ? 'Storage protected' : 'The browser said not yet — installing the app usually helps', { icon: ok ? 'check' : 'info' });
    renderStorage();
  });
  q('#stClean').addEventListener('click', async () => {
    const done = state.tracks.filter((t) => t.finished);
    if (!done.length) return toast('Nothing finished to remove', { icon: 'info', duration: 1800 });
    const size = done.reduce((n, t) => n + (state.blobs.get(t.id)?.size || 0), 0);
    const ok = await confirmSheet({ title: `Remove ${done.length} finished?`, message: `Frees ${fmtBytes(size)}. Their marks and notes go too.`, ok: 'Remove' });
    if (!ok) return;
    for (const t of done) {
      if (player.P.id === t.id) player.unload();
      player.removeFromQueue(t.id);
      await deleteTrack(t.id);
    }
    toast(`Removed ${done.length}`, { icon: 'trash', duration: 1800 });
    renderStorage();
  });

  /* downloader: auto / iPhone Shortcut / server */
  const via = q('#viaSeg');
  const grpS = q('#grpShortcut');
  const grpV = q('#grpServer');
  function renderVia(animate) {
    const mode = fetchMode();
    const set = state.settings.fetchVia || 'auto';
    const hint =
      set === 'shortcut'
        ? 'Links open your Shortcut, which downloads on this phone. Then tap Import.'
        : set === 'server'
          ? 'A computer running Earmark does the downloading.'
          : `Uses a server when one answers, otherwise the iPhone Shortcut. Right now: ${mode === 'shortcut' ? 'Shortcut' : 'server'}.`;
    const showS = mode === 'shortcut' || set === 'shortcut';
    const showV = set !== 'shortcut';
    const apply = () => {
      q('#viaHint').textContent = hint;
      grpS.hidden = !showS;
      grpV.hidden = !showV;
    };
    if (animate && (grpS.hidden === showS || grpV.hidden === showV)) swap(via.parentElement, apply);
    else apply();
    if (os === 'android') q('#scGuide').hidden = set !== 'shortcut';
  }
  via.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-via]');
    if (!b) return;
    placeSeg(via, b);
    await setSetting('fetchVia', b.dataset.via);
    renderVia(true);
    emit('server:recheck');
  });
  q('#scName').addEventListener('change', async (e) => {
    const name = e.target.value.trim() || 'Earmark';
    e.target.value = name;
    await setSetting('shortcutName', name);
    q('#scSteps').innerHTML = shortcutGuide(name);
  });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    const pre = q(`#${b.dataset.copy}`);
    try {
      await navigator.clipboard.writeText(pre?.textContent || '');
      b.innerHTML = icon('check');
      setTimeout(() => (b.innerHTML = icon('clip')), 1400);
      toast('Copied', { icon: 'check', duration: 1400 });
    } catch {
      const r = document.createRange();
      r.selectNodeContents(pre);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      toast('Selected. Tap Copy.', { icon: 'clip', duration: 2000 });
    }
  });

  /* server */
  function renderServer() {
    const sv = state.server;
    const ok = sv.online && (sv.ytdlp || sv.demo) && (!sv.locked || sv.authorized);
    const html =
      sv.online === null
        ? `<i class="dot"></i>Checking…`
        : sv.online
          ? `<i class="dot ${ok ? 'ok' : 'warn'}"></i>${ok ? 'Connected' : sv.locked && !sv.authorized ? 'Needs the access key' : 'Connected, but yt-dlp is missing'}<small>${sv.ytdlp ? `yt-dlp ${esc(sv.ytdlp)}` : sv.demo ? 'demo mode' : 'run: npm run setup'}${sv.ffmpeg ? ' · ffmpeg ✓' : ''}</small>`
          : `<i class="dot bad"></i>Can't reach the server<small>Listening works offline. Fetching needs the server.</small>`;
    const box = q('#srvStatus');
    if (box.dataset.sig === html) return;
    const first = !box.dataset.sig;
    box.dataset.sig = html;
    if (first) box.innerHTML = html;
    else swap(box, () => (box.innerHTML = html));
  }
  const saveSrv = async () => {
    await setSetting('server', q('#srvUrl').value.trim());
    await setSetting('accessKey', q('#srvKey').value.trim());
    emit('server:recheck');
  };
  q('#srvUrl').addEventListener('change', saveSrv);
  q('#srvKey').addEventListener('change', saveSrv);
  q('#srvCheck').addEventListener('click', () => emit('server:recheck'));
  q('#srvUpdate').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.querySelector('span').textContent = 'Updating…';
    try {
      const r = await api.updateDownloader();
      toast(r.ok ? `Downloader is up to date (${r.version})` : 'Update failed', { icon: r.ok ? 'check' : 'info', duration: 3500 });
    } catch (err) {
      toast(err.message, { icon: 'info' });
    }
    b.disabled = false;
    b.querySelector('span').textContent = 'Update downloader';
    emit('server:recheck');
  });

  const offs = [on('server', renderServer), on('server', () => renderVia(false)), on('installable', showInstall), on('tracks', renderStorage)];
  renderSteps(false);
  renderServer();
  renderVia(false);
  renderStorage();
  requestAnimationFrame(() => {
    placeSeg(qual, qual.querySelector(`[data-q="${s.quality}"]`) || qual.querySelector('[data-q="standard"]'), false);
    placeSeg(tabs, tabs.querySelector(`[data-g="${guide}"]`), false);
    placeSeg(via, via.querySelector(`[data-via="${s.fetchVia || 'auto'}"]`), false);
    if (lock) placeSeg(lock, lock.querySelector(`[data-l="${s.lockButtons === 'tracks' ? 'tracks' : 'skip'}"]`), false);
  });

  return {
    unmount() {
      clearInterval(stepTimer);
      offs.forEach((o) => o());
    },
  };
}
