// Mini player (collapsed) + full player sheet with marks, notes, queue, speed and sleep.
import { state, on, getTrack, getPlaylist, setSetting, SWATCHES, MARK_COLORS, swatchSoft } from '../store.js';
import * as player from '../player.js';
import { icon } from '../icons.js';
import { $, h, esc, fmtTime, fmtDur, clockAt, relDay, throttle, haptic, clamp, device } from '../util.js';
import { Roller, stagger, pop, swap, morph, collapseOut, dragDismiss, animateList, setText } from '../anim.js';
import { sfx } from '../fx.js';
import { pushLayer } from '../nav.js';
import { openSheet } from './sheet.js';
import { toast } from './toast.js';
import { createScrubber } from './scrubber.js';
import { createDial } from './dial.js';
import { trackMenu, toggleFavorite, shareTrack, playlistPicker, renameTrack } from './track-actions.js';

const PP = `<span class="pp" data-on="0"><svg class="ic pp-a" aria-hidden="true"><use href="#i-play"/></svg><svg class="ic pp-b" aria-hidden="true"><use href="#i-pause"/></svg></span>`;

let sheet;
let mini;
let wrap;
let scrub;
let isOpen = false;
let closeFn = null;
let tab = 'marks';
let rafId = 0;
let lastSec = -1;
const R = {};

const fmtRate = (r) => (Math.round(r * 100) / 100).toFixed(2).replace(/0$/, '');
const swatchOf = (t) => SWATCHES[(t?.color || 0) % SWATCHES.length];

export function mountPlayer() {
  wrap = $('#miniWrap');
  mini = $('#mini');
  sheet = $('#player');

  mini.innerHTML = `
    <button class="mini-main" type="button" data-a="open" data-sfx="none" aria-label="Open player">
      <span class="mini-sw" id="miSw"><i class="eq" aria-hidden="true"><b></b><b></b><b></b></i></span>
      <span class="mini-text"><span class="mini-title" id="miTitle"></span><span class="mini-time" id="miTime">0:00</span></span>
    </button>
    <div class="mini-ctl">
      <button class="mini-btn press skip" type="button" data-a="back" data-fx="spin-l" data-sfx="none" aria-label="Skip back">${icon('back')}<b class="n" data-n="back"></b></button>
      <button class="mini-btn mini-play press" type="button" data-a="toggle" data-fx="pop" aria-label="Play or pause">${PP}</button>
      <button class="mini-btn press" type="button" data-a="next" data-fx="nudge-r" aria-label="Next audio">${icon('next')}</button>
    </div>
    <i class="mini-prog" aria-hidden="true"><i id="miProg"></i></i>`;

  // Top to bottom = far from the thumb to under it: what it is, what you saved in it,
  // the occasional settings, then the timeline and the transport you touch all the time.
  sheet.innerHTML = `
    <div class="pl-scroll" id="plScroll">
      <div class="pl-grid" id="plGrid">
        <header class="pl-head" id="plHead">
          <i class="grab" aria-hidden="true"></i>
          <button class="icon-btn press" type="button" data-a="collapse" data-fx="drop" data-sfx="none" aria-label="Minimise player">${icon('chev-down')}</button>
          <div class="pl-head-mid"><span class="eyebrow">Playing from</span><span class="pl-ctx" id="plCtx">Library</span></div>
          <button class="icon-btn press" type="button" data-a="focus" data-fx="none" aria-label="Switch view">${icon('focus', 'f-a')}${icon('unfocus', 'f-b')}</button>
          <button class="icon-btn press" type="button" data-a="more" aria-label="More">${icon('more')}</button>
        </header>

        <section class="tile pl-title" id="plTitle">
          <div class="pt-chips" id="plChips"></div>
          <button class="pt-fav press" type="button" data-a="fav" data-fx="none" aria-label="Favourite">${icon('star', 's-a')}${icon('star-fill', 's-b')}</button>
          <h2 class="pt-name" id="plName" data-a="rename" role="button" tabindex="0" title="Rename"></h2>
        </section>

        <section class="tile tone-gray pl-panel" id="plPanel">
          <div class="seg" id="plTabs" role="tablist">
            <i class="seg-pill" aria-hidden="true"></i>
            <button type="button" role="tab" data-tab="marks">Marks <b id="cMarks"></b></button>
            <button type="button" role="tab" data-tab="notes">Notes <b id="cNotes"></b></button>
            <button type="button" role="tab" data-tab="queue">Up next <b id="cQueue"></b></button>
          </div>
          <div class="panel-body" id="plBody"></div>
        </section>

        <section class="tile tone-silver pl-vol" id="plVol">
          <button class="icon-btn press" type="button" data-a="mute" data-fx="none" aria-label="Mute">${icon('volume', 'v-a')}${icon('mute', 'v-b')}</button>
          <input class="range" type="range" min="0" max="1" step="0.01" id="volRange" aria-label="Volume">
          <span class="vol-val" id="volVal">100</span>
        </section>

        <section class="pl-acts">
          <button class="act tone-orange press" type="button" data-a="speed" data-fx="wiggle"><span class="act-lbl">Speed</span><span class="act-val" id="actSpeed">1×</span>${icon('gauge')}</button>
          <button class="act tone-navy press" type="button" data-a="sleep" data-fx="tilt"><span class="act-lbl">Sleep</span><span class="act-val" id="actSleep">Off</span>${icon('moon')}</button>
          <button class="act tone-khaki press" type="button" data-a="mark" data-fx="stamp" data-sfx="none"><span class="act-lbl">Mark</span><span class="act-val" id="actMark">+</span>${icon('mark-plus')}</button>
          <button class="act tone-sage press" type="button" data-a="share" data-fx="lift"><span class="act-lbl">Share</span><span class="act-val">Send</span>${icon('share')}</button>
        </section>

        <section class="tile tone-paper pl-time">
          <div class="ptm-row">
            <div class="ptm-clock"><span class="ptm-big" id="plElapsed">0:00</span><span class="ptm-total" id="plTotal">/ 0:00</span></div>
            <span class="ptm-pct">≈<span id="plPct">0</span>%</span>
          </div>
          <div class="ptm-scrub" id="plScrub"></div>
          <div class="ptm-foot"><span id="plLeft">-0:00</span><span id="plEnds"></span></div>
        </section>

        <section class="pl-ctl">
          <button class="ctl press" type="button" data-a="prev" data-fx="nudge-l" aria-label="Previous">${icon('prev')}</button>
          <button class="ctl skip press" type="button" data-a="back" data-fx="spin-l" data-sfx="none" aria-label="Skip back">${icon('back')}<b class="n" data-n="back"></b></button>
          <button class="ctl ctl-play press" type="button" data-a="toggle" data-fx="pop" aria-label="Play or pause">${PP}</button>
          <button class="ctl skip press" type="button" data-a="fwd" data-fx="spin-r" data-sfx="none" aria-label="Skip forward">${icon('fwd')}<b class="n" data-n="fwd"></b></button>
          <button class="ctl press" type="button" data-a="next" data-fx="nudge-r" aria-label="Next">${icon('next')}</button>
        </section>
      </div>
    </div>`;

  for (const id of ['miTitle', 'miTime', 'miProg', 'miSw', 'plCtx', 'plName', 'plChips', 'plTitle', 'plElapsed', 'plTotal', 'plPct', 'plLeft', 'plEnds', 'actSpeed', 'actSleep', 'actMark', 'plBody', 'plTabs', 'volRange', 'volVal', 'plVol', 'cMarks', 'cNotes', 'cQueue', 'plScroll']) {
    R[id] = document.getElementById(id);
  }
  R.elapsedRoll = new Roller(R.plElapsed);
  R.pctRoll = new Roller(R.plPct);
  R.speedRoll = new Roller(R.actSpeed);
  R.markRoll = new Roller(R.actMark);

  scrub = createScrubber({
    onScrub: (t) => {
      R.elapsedRoll.set(fmtTime(t), { animate: false });
    },
    onSeek: (t) => {
      player.seek(t);
      haptic(6);
    },
    onMark: (t) => player.seek(t),
  });
  $('#plScrub').append(scrub.el);

  // actions
  const act = (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    const t = player.current();
    switch (a) {
      case 'open':
        return openPlayer();
      case 'collapse':
        return closeFn?.();
      case 'focus':
        return toggleFocus();
      case 'more':
        return t && trackMenu(b, t, { inPlayer: true });
      case 'fav':
        return t && toggleFavorite(t, b);
      case 'rename':
        return t && renameTrack(t);
      case 'toggle':
        return player.toggle();
      case 'back':
        return player.skip(-1);
      case 'fwd':
        return player.skip(1);
      case 'next':
        return player.next();
      case 'prev':
        return player.prev();
      case 'speed':
        return openSpeed();
      case 'sleep':
        return openSleep();
      case 'mark':
        return quickMark(b);
      case 'share':
        return t && shareTrack(b, t);
      case 'lists':
        return t && playlistPicker(t);
      case 'mute':
        return player.toggleMute();
    }
  };
  mini.addEventListener('click', act);
  sheet.addEventListener('click', act);
  sheet.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-a="rename"]')) act(e);
  });

  // swipe the mini player up to expand
  let y0 = null;
  mini.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.mini-ctl')) return;
    y0 = e.clientY;
  });
  mini.addEventListener('pointermove', (e) => {
    if (y0 === null) return;
    const dy = e.clientY - y0;
    if (dy < 0) mini.style.transform = `translateY(${Math.max(dy, -40) * 0.5}px)`;
    if (dy < -28) {
      y0 = null;
      mini.style.transform = '';
      openPlayer();
    }
  });
  const resetMini = () => {
    y0 = null;
    mini.style.transform = '';
  };
  mini.addEventListener('pointerup', resetMini);
  mini.addEventListener('pointercancel', resetMini);

  // Pull the player down from anywhere to put it away; the home screen rises back as it goes.
  const app = $('#app');
  dragDismiss(sheet, {
    mouseHandle: $('#plHead'),
    canStart: (e) => isOpen && !e.target.closest('.scrub, input, textarea, .q-grip, .mk-tick'),
    onDismiss: () => closeFn?.(),
    onProgress: (p, live) => {
      app.style.transition = live ? 'none' : '';
      app.style.transform = live ? `scale(${0.94 + 0.06 * p})` : '';
      app.style.opacity = live ? String(0.5 + 0.5 * p) : '';
    },
  });

  // tabs
  R.plTabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b && b.dataset.tab !== tab) setTab(b.dataset.tab, true);
  });
  wirePanel();

  // volume: phones have real buttons for it (and an iPhone ignores anything else), so the
  // slider only appears where there is a mouse.
  if (!player.P.volumeSupported || device.coarse) {
    R.plVol.hidden = true;
    sheet.classList.add('no-vol');
  }
  R.volRange.addEventListener('input', () => {
    player.setVolume(Number(R.volRange.value));
  });
  R.volRange.addEventListener('change', player.commitVolume);

  if (state.settings.playerFocus) sheet.classList.add('focus');

  // events
  on('player:load', (t) => {
    renderVisibility();
    if (!t) return closeFn?.();
    renderTrack();
    renderTime(true);
    if (isOpen) renderPanel();
  });
  on('player:state', () => {
    renderState();
    loop();
  });
  on('player:time', () => renderTime());
  on('player:rate', renderRate);
  on('player:volume', renderVolume);
  on('player:queue', () => {
    renderCounts();
    if (isOpen && tab === 'queue') renderPanel();
  });
  on('player:sleep', renderSleep);
  on('player:sleep-tick', throttle(renderSleep, 1000));
  on('player:sleep-done', () => toast('Sleep timer: paused. Good night.', { icon: 'moon', duration: 5000 }));
  on('player:end-of-queue', () => toast("That's the end. Nothing queued after this.", { icon: 'queue', duration: 2400 }));
  on('player:blocked', () => toast('Tap play to start', { icon: 'play', duration: 2400 }));
  on('player:error', (d) => toast(d?.message || 'Playback error', { icon: 'info' }));
  on('marks', (d) => {
    if (d?.trackId !== player.P.id) return;
    renderMarksOnScrub(d.added);
    renderCounts();
    if (isOpen && tab === 'marks') renderPanel(d.added);
  });
  on('notes', (d) => {
    if (d?.trackId !== player.P.id) return;
    renderCounts();
    if (isOpen && tab === 'notes' && !d.added) renderPanel();
  });
  on('tracks', (d) => {
    if (!player.P.id || (d?.id && d.id !== player.P.id)) return;
    renderTrack();
  });
  on('fav', (d) => d?.id === player.P.id && renderTrack());
  on('playlists', renderTrack);
  on('settings', (d) => {
    if (d.k === 'skipBack' || d.k === 'skipFwd') renderSkips();
    if (d.k === 'autoplay' && isOpen && tab === 'queue') renderPanel();
  });

  renderSkips();
  renderRate();
  renderVolume();
  renderSleep();
}

/* ───────────── open / close ───────────── */

export function openPlayer() {
  if (isOpen || !player.P.id) return;
  isOpen = true;
  renderTrack();
  renderTime(true);
  setTab(tab, false);
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  sheet.inert = false;
  document.documentElement.classList.add('player-open');
  R.plScroll.scrollTop = 0;
  sfx('open');
  stagger(sheet.querySelectorAll('.pl-grid > *:not([hidden])'), { y: 26, step: 34, delay: 80, duration: 560 });
  closeFn = pushLayer(closePlayer, 'player');
  loop();
}

function closePlayer() {
  isOpen = false;
  closeFn = null;
  sfx('close');
  sheet.classList.remove('open');
  sheet.style.transform = '';
  sheet.setAttribute('aria-hidden', 'true');
  sheet.inert = true;
  document.documentElement.classList.remove('player-open');
}

export const playerIsOpen = () => isOpen;

function toggleFocus() {
  const on = !sheet.classList.contains('focus');
  morph(() => sheet.classList.toggle('focus', on), sheet.querySelectorAll('.pl-grid > *'));
  setSetting('playerFocus', on);
}

/* ───────────── render ───────────── */

function renderVisibility() {
  const has = Boolean(player.P.id);
  wrap.classList.toggle('show', has);
  document.documentElement.classList.toggle('has-mini', has);
}

function renderSkips() {
  document.querySelectorAll('[data-n="back"]').forEach((n) => (n.textContent = state.settings.skipBack));
  document.querySelectorAll('[data-n="fwd"]').forEach((n) => (n.textContent = state.settings.skipFwd));
}

function renderTrack() {
  const t = player.current();
  if (!t) return;
  const sw = swatchOf(t);
  for (const el of [R.plTitle, R.miSw]) {
    el.style.setProperty('--sw', sw.bg);
    el.style.setProperty('--sw-ink', sw.ink);
    el.style.setProperty('--sw-dim', sw.dim);
    el.style.setProperty('--sw-soft', swatchSoft(sw));
  }
  // The name appears once, and it's the short one. No source, no channel.
  setText(R.miTitle, t.title);
  setText(R.plName, t.title);
  setText(R.plCtx, player.P.context?.label || 'Library');
  sheet.querySelector('.pt-fav').classList.toggle('on', Boolean(t.favorite));
  const chips = t.playlists
    .map(getPlaylist)
    .filter(Boolean)
    .map((p) => `<button type="button" class="chip sm press" data-a="lists" data-k="${p.id}"><i class="sw" style="--sw:${SWATCHES[p.color % SWATCHES.length].bg}"></i>${esc(p.name)}</button>`)
    .join('');
  const html = chips + `<button type="button" class="chip sm ghost press" data-a="lists" data-k="+">${icon('plus')}${t.playlists.length ? '' : 'Playlist'}</button>`;
  if (R.plChips.dataset.sig !== html) {
    R.plChips.dataset.sig = html;
    animateList(R.plChips, () => (R.plChips.innerHTML = html), { selector: '.chip', key: (e) => e.dataset.k, y: 0 });
  }
  renderMarksOnScrub();
  renderCounts();
  renderState();
}

function renderMarksOnScrub(freshId) {
  const t = player.current();
  if (!t) return;
  scrub.marks(t.marks, player.duration(), freshId);
}

function renderCounts() {
  const t = player.current();
  if (!t) return;
  setText(R.cMarks, t.marks.length || '');
  setText(R.cNotes, t.notes?.length || '');
  setText(R.cQueue, player.P.queue.length || '');
  R.markRoll.set(t.marks.length ? `${t.marks.length}` : '+');
}

function renderState() {
  const playing = player.isPlaying();
  document.querySelectorAll('.pp').forEach((p) => (p.dataset.on = playing ? '1' : '0'));
  mini.classList.toggle('playing', playing);
  sheet.classList.toggle('playing', playing);
  document.querySelectorAll('.ctl-play, .mini-play').forEach((b) => b.setAttribute('aria-label', playing ? 'Pause' : 'Play'));
}

function renderTime(force = false) {
  const t = player.current();
  if (!t) return;
  const pos = player.time();
  const d = player.duration();
  const sec = Math.floor(pos);
  if (!scrub.dragging) scrub.set(pos, d);
  R.miProg.style.transform = `scaleX(${d ? pos / d : 0})`;
  if (sec === lastSec && !force) return;
  lastSec = sec;
  R.miTime.textContent = `${fmtTime(pos)} / ${fmtTime(d)}`;
  if (!scrub.dragging) R.elapsedRoll.set(fmtTime(pos), { animate: isOpen });
  R.plTotal.textContent = `/ ${fmtTime(d)}`;
  R.pctRoll.set(String(d ? Math.round((pos / d) * 100) : 0), { animate: isOpen });
  const rate = player.audioEl.playbackRate || 1;
  R.plLeft.textContent = `-${fmtTime(Math.max(0, d - pos))}`;
  R.plEnds.textContent = d ? `ends ${clockAt(((d - pos) / rate) * 1000)}` : '';
  const at = $('#markAt');
  if (at) at.textContent = fmtTime(pos);
  const nat = $('#noteAtTime');
  if (nat) nat.textContent = fmtTime(pos);
  if (force) renderMarksOnScrub();
}

function renderRate() {
  const r = state.settings.speed;
  R.speedRoll.set(`${fmtRate(r)}×`);
  sheet.querySelector('[data-a="speed"]').classList.toggle('active', r !== 1);
}

function renderVolume() {
  const a = player.audioEl;
  const v = a.muted ? 0 : a.volume;
  R.volRange.value = v;
  R.volRange.style.setProperty('--p', v);
  R.volVal.textContent = Math.round(v * 100);
  R.plVol.classList.toggle('muted', a.muted || v === 0);
}

function renderSleep() {
  const sl = player.P.sleep;
  const b = sheet.querySelector('[data-a="sleep"]');
  b.classList.toggle('active', sl.mode !== 'off');
  const label = sl.mode === 'time' ? fmtTime(player.sleepLeft() / 1000) : sl.mode === 'end' ? 'End' : 'Off';
  // A countdown just ticks; switching the timer on or off gets a crossfade.
  if (b.dataset.mode === sl.mode) R.actSleep.textContent = label;
  else setText(R.actSleep, label);
  b.dataset.mode = sl.mode;
}

/* smooth progress while playing */
function loop() {
  cancelAnimationFrame(rafId);
  if (!player.isPlaying()) return;
  const frame = () => {
    const d = player.duration();
    const pos = player.time();
    R.miProg.style.transform = `scaleX(${d ? pos / d : 0})`;
    if (isOpen && !scrub.dragging) scrub.set(pos, d);
    if (player.isPlaying()) rafId = requestAnimationFrame(frame);
  };
  rafId = requestAnimationFrame(frame);
}

/* ───────────── panel: marks / notes / queue ───────────── */

function setTab(name, animate) {
  tab = name;
  const btn = R.plTabs.querySelector(`[data-tab="${name}"]`);
  R.plTabs.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', b === btn ? 'true' : 'false'));
  const pill = R.plTabs.querySelector('.seg-pill');
  requestAnimationFrame(() => {
    pill.style.width = `${btn.offsetWidth}px`;
    pill.style.transform = `translateX(${btn.offsetLeft}px)`;
  });
  if (animate) swap(R.plBody, () => paintPanel());
  else paintPanel();
}

/** Same tab, new contents: rows glide, arrive and leave instead of blinking. */
function renderPanel(freshId) {
  animateList(R.plBody, () => paintPanel(freshId), { selector: 'li[data-id]' });
}

function paintPanel(freshId) {
  const t = player.current();
  if (!t) return;
  if (tab === 'marks') {
    R.plBody.innerHTML = `
      <button class="add-row press" type="button" data-p="add-mark" data-fx="stamp" data-sfx="none">${icon('mark-plus')}<span>Mark this moment</span><b id="markAt">${fmtTime(player.time())}</b></button>
      ${
        t.marks.length
          ? `<ul class="mk-list">${t.marks
              .map(
                (m) => `<li class="mk ${m.id === freshId ? 'fresh' : ''}" data-id="${m.id}">
                <button type="button" class="mk-dot press" style="--c:${m.color}" aria-label="Change colour"></button>
                <button type="button" class="mk-name" title="Rename">${esc(m.name)}</button>
                <button type="button" class="mk-t press">${fmtTime(m.t)}</button>
                <button type="button" class="icon-btn sm mk-x" aria-label="Delete mark">${icon('close')}</button>
              </li>`,
              )
              .join('')}</ul>`
          : `<p class="panel-empty">Marks pin a moment — a quote, a step, the good part. They show up on the timeline and in the Marks view.</p>`
      }`;
  } else if (tab === 'notes') {
    const notes = [...(t.notes || [])].reverse();
    R.plBody.innerHTML = `
      <form class="note-form" id="noteForm">
        <textarea class="field note-input" rows="2" maxlength="2000" placeholder="A thought, a quote, a to-do…"></textarea>
        <div class="note-row">
          <button type="button" class="chip sm press on" id="noteAt" aria-pressed="true">${icon('mark')}<span>at <span id="noteAtTime">${fmtTime(player.time())}</span></span></button>
          <button class="btn solid sm press" type="submit">Add note</button>
        </div>
      </form>
      ${
        notes.length
          ? `<ul class="note-list">${notes
              .map(
                (n) => `<li class="note" data-id="${n.id}"><p>${esc(n.text)}</p><div class="note-meta">
                  ${n.t != null ? `<button type="button" class="note-t press">${icon('play')}${fmtTime(n.t)}</button>` : ''}
                  <span>${relDay(n.at)}</span>
                  <button type="button" class="icon-btn sm note-x" aria-label="Delete note">${icon('trash')}</button></div></li>`,
              )
              .join('')}</ul>`
          : `<p class="panel-empty">Notes stay with this audio. Attach the current time to jump back later.</p>`
      }`;
  } else {
    const q = player.P.queue.map(getTrack).filter(Boolean);
    const auto = player.contextPreview(6).map(getTrack).filter(Boolean);
    const row = (t, queued) => `<li class="qrow" data-id="${t.id}">
        ${queued ? `<button type="button" class="q-grip" aria-label="Drag to reorder">${icon('grip')}</button>` : ''}
        <button type="button" class="q-main"><span class="q-title">${esc(t.title)}</span><span class="q-meta">${fmtDur(t.duration)}</span></button>
        ${queued ? `<button type="button" class="icon-btn sm q-x" aria-label="Remove from queue">${icon('close')}</button>` : `<button type="button" class="icon-btn sm q-add" aria-label="Play next">${icon('play-next')}</button>`}
      </li>`;
    R.plBody.innerHTML = `
      <div class="q-sec"><span class="eyebrow">Queue</span>${q.length ? `<button type="button" class="chip sm press" data-p="clear-q">Clear</button>` : ''}</div>
      ${q.length ? `<ul class="q-list" id="qList">${q.map((t) => row(t, true)).join('')}</ul>` : `<p class="panel-empty">Nothing queued. “Play next” on any audio jumps it to the front.</p>`}
      <div class="q-sec"><span class="eyebrow">Then from ${esc(player.P.context?.label || 'Library')}</span>
        <label class="switch sm"><input type="checkbox" data-p="autoplay" ${state.settings.autoplay ? 'checked' : ''}><i></i><span class="sr-only">Autoplay</span></label></div>
      <ul class="q-list auto ${state.settings.autoplay ? '' : 'off'}">${auto.map((t) => row(t, false)).join('') || '<li class="panel-empty">End of the line.</li>'}</ul>`;
  }
}

function wirePanel() {
  const body = R.plBody;
  body.addEventListener('click', async (e) => {
    const t = player.current();
    if (!t) return;
    const li = e.target.closest('li[data-id]');
    if (e.target.closest('[data-p="add-mark"]')) return quickMark();
    if (e.target.closest('[data-p="clear-q"]')) return player.clearQueue();
    if (e.target.closest('#noteAt')) {
      const b = e.target.closest('#noteAt');
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('on', on);
      return;
    }
    if (!li) return;
    const id = li.dataset.id;
    // marks
    if (e.target.closest('.mk-dot')) {
      const m = t.marks.find((x) => x.id === id);
      const next = MARK_COLORS[(MARK_COLORS.indexOf(m.color) + 1) % MARK_COLORS.length];
      player.updateMark(t.id, id, { color: next });
      const dot = e.target.closest('.mk-dot');
      dot.style.setProperty('--c', next);
      pop(dot, 1.35);
      renderMarksOnScrub();
      return;
    }
    if (e.target.closest('.mk-name')) return renameMark(t, id);
    if (e.target.closest('.mk-t')) {
      const m = t.marks.find((x) => x.id === id);
      player.seek(m.t);
      if (!player.isPlaying()) player.play();
      return;
    }
    if (e.target.closest('.mk-x')) {
      const m = t.marks.find((x) => x.id === id);
      await collapseOut(li);
      player.removeMark(t.id, id);
      renderMarksOnScrub();
      toast(`Removed ${m.name}`, {
        icon: 'trash',
        duration: 3500,
        action: {
          label: 'Undo',
          fn: () => {
            t.marks = [...t.marks, m].sort((a, b) => a.t - b.t);
            player.updateMark(t.id, m.id, {});
            renderMarksOnScrub(m.id);
            if (tab === 'marks') renderPanel(m.id);
          },
        },
      });
      return;
    }
    // notes
    if (e.target.closest('.note-t')) {
      const n = t.notes.find((x) => x.id === id);
      player.seek(n.t);
      if (!player.isPlaying()) player.play();
      return;
    }
    if (e.target.closest('.note-x')) {
      await collapseOut(li);
      player.removeNote(t.id, id);
      return;
    }
    // queue
    if (e.target.closest('.q-x')) {
      await collapseOut(li);
      player.removeFromQueue(id);
      return;
    }
    if (e.target.closest('.q-add')) {
      player.playNext(id);
      toast('Plays next', { icon: 'play-next', duration: 1500 });
      return;
    }
    if (e.target.closest('.q-main')) player.load(id);
  });
  body.addEventListener('change', (e) => {
    if (e.target.matches('[data-p="autoplay"]')) setSetting('autoplay', e.target.checked);
  });
  body.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = player.current();
    const ta = body.querySelector('.note-input');
    const text = ta.value.trim();
    if (!t || !text) return ta.focus();
    const at = body.querySelector('#noteAt').getAttribute('aria-pressed') === 'true' ? player.time() : null;
    player.addNote(t.id, text, at);
    ta.value = '';
    renderPanel();
  });
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.matches('.note-input')) body.querySelector('#noteForm').requestSubmit();
  });

  // drag to reorder the queue
  body.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('.q-grip');
    if (!grip) return;
    e.preventDefault();
    const list = grip.closest('.q-list');
    const row = grip.closest('.qrow');
    const rows = [...list.children];
    const from = rows.indexOf(row);
    const hgt = row.offsetHeight;
    const y0 = e.clientY;
    let to = from;
    grip.setPointerCapture(e.pointerId);
    row.classList.add('lift');
    haptic(8);
    const move = (ev) => {
      const dy = ev.clientY - y0;
      row.style.transform = `translateY(${dy}px)`;
      const nt = clamp(from + Math.round(dy / hgt), 0, rows.length - 1);
      if (nt !== to) haptic(4);
      to = nt;
      rows.forEach((r, i) => {
        if (r === row) return;
        let shift = 0;
        if (from < to && i > from && i <= to) shift = -hgt;
        if (from > to && i < from && i >= to) shift = hgt;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      row.classList.remove('lift');
      if (to !== from) player.moveInQueue(from, to);
      else rows.forEach((r) => (r.style.transform = ''));
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
}

async function renameMark(t, id) {
  const m = t.marks.find((x) => x.id === id);
  if (!m) return;
  const { prompt } = await import('./sheet.js');
  const name = await prompt({ title: `Mark at ${fmtTime(m.t)}`, value: m.name, ok: 'Save', maxLength: 50 });
  if (name) {
    player.updateMark(t.id, id, { name });
    renderMarksOnScrub();
    if (isOpen && tab === 'marks') renderPanel();
  }
}

function quickMark(btn) {
  const t = player.current();
  if (!t) return;
  const m = player.addMark();
  if (!m) return;
  haptic(12);
  if (btn) pop(btn, 1.06);
  if (isOpen && tab !== 'marks' && !sheet.classList.contains('focus')) setTab('marks', true);
  toast(`Marked ${fmtTime(m.t)}`, { icon: 'mark', duration: 3200, action: { label: 'Name it', fn: () => renameMark(t, m.id) } });
}

/* ───────────── speed & sleep sheets ───────────── */

function openSpeed() {
  const r = state.settings.speed;
  const presets = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const body = h(`
    <div class="speed-ui">
      <div class="sp-big"><span class="sp-val">${fmtRate(r)}</span><em>×</em></div>
      <input class="range big" type="range" min="0.5" max="3" step="0.05" value="${r}" aria-label="Playback speed">
      <div class="sp-scale"><span>0.5</span><span>1</span><span>1.5</span><span>2</span><span>2.5</span><span>3</span></div>
      <div class="sp-presets">${presets.map((v) => `<button type="button" class="chip press ${v === r ? 'on' : ''}" data-v="${v}">${v}×</button>`).join('')}</div>
      <p class="sheet-note">Pitch stays natural at every speed.</p>
    </div>`);
  const range = body.querySelector('.range');
  const roll = new Roller(body.querySelector('.sp-val'));
  const sync = (v, fromRange) => {
    player.setSpeed(v);
    roll.set(fmtRate(v), { dir: v >= state.settings.speed ? 1 : -1 });
    if (!fromRange) range.value = v;
    range.style.setProperty('--p', (v - 0.5) / 2.5);
    body.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', Number(c.dataset.v) === Number(v)));
  };
  range.style.setProperty('--p', (r - 0.5) / 2.5);
  range.addEventListener('input', () => sync(Number(range.value), true));
  body.querySelector('.sp-presets').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (c) {
      sync(Number(c.dataset.v));
      haptic(6);
    }
  });
  openSheet({ title: 'Playback speed', body, className: 'sheet-speed' });
}

let lastSleepPick = 15;
export function openSleep() {
  const body = h(`
    <div class="sleep-ui">
      <div class="sleep-dial"></div>
      <div class="sleep-status" id="slStatus"></div>
      <div class="sleep-chips">
        <button type="button" class="chip press" data-s="end">${icon('check')}End of this audio</button>
        <button type="button" class="chip press" data-s="90">90 min</button>
        <button type="button" class="chip press" data-s="120">2 h</button>
      </div>
      <div class="prompt-actions">
        <button type="button" class="btn ghost press" data-s="off">Turn off</button>
        <button type="button" class="btn solid press" data-s="start">Start · <span id="slPick">${lastSleepPick}</span> min</button>
      </div>
      ${
        player.P.volumeSupported
          ? `<label class="row-toggle"><span>Fade out over the last 30 s</span><span class="switch"><input type="checkbox" data-s="fade" ${state.settings.sleepFade ? 'checked' : ''}><i></i></span></label>`
          : ''
      }
    </div>`);
  const pick = body.querySelector('#slPick');
  const dial = createDial({
    value: lastSleepPick,
    onChange: (v) => {
      lastSleepPick = v;
      pick.textContent = v;
    },
  });
  body.querySelector('.sleep-dial').append(dial.el);
  const status = body.querySelector('#slStatus');
  const paint = () => {
    const sl = player.P.sleep;
    body.querySelector('[data-s="end"]').classList.toggle('on', sl.mode === 'end');
    if (sl.mode === 'time') {
      const left = player.sleepLeft();
      status.innerHTML = `<b>${fmtTime(left / 1000)}</b> left · pauses at ${clockAt(left)} <button type="button" class="chip sm press" data-s="plus">+5 min</button>`;
    } else if (sl.mode === 'end') status.innerHTML = `<b>Pauses</b> when this audio ends`;
    else status.innerHTML = `<span class="dim">Turn the dial · tap a number</span>`;
  };
  paint();
  const timer = setInterval(paint, 1000);
  const s = openSheet({ title: 'Sleep timer', body, className: 'sheet-sleep', onClose: () => clearInterval(timer) });
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b || b.matches('input')) return;
    const k = b.dataset.s;
    if (k === 'start') {
      player.setSleep(dial.value);
      toast(`Sleeping in ${dial.value} min`, { icon: 'moon', duration: 2000 });
      s.close();
    } else if (k === 'end') {
      player.setSleep('end');
      toast('Pauses when this audio ends', { icon: 'moon', duration: 2000 });
      s.close();
    } else if (k === '90' || k === '120') {
      player.setSleep(Number(k));
      toast(`Sleeping in ${k} min`, { icon: 'moon', duration: 2000 });
      s.close();
    } else if (k === 'off') {
      player.setSleep(0);
      s.close();
    } else if (k === 'plus') {
      player.extendSleep(5);
      paint();
    }
  });
  body.addEventListener('change', (e) => {
    if (e.target.matches('[data-s="fade"]')) setSetting('sleepFade', e.target.checked);
  });
}
