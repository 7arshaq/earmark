// The feel layer, wired once for the whole app:
//  · sound effects — short, low, wooden clicks made on the spot with Web Audio (no files)
//  · tap animations — the icon on a button answers the press (data-fx="…")
// Sounds can be switched off in Settings → Playback.
import { state, on } from './store.js';
import { tapFx } from './anim.js';

/* ───────────── sound ───────────── */

let ctx = null;
let bus = null;
let hiss = null;
let sleepTimer = null;

function context() {
  if (!state.settings.sfx) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      return null;
    }
    bus = ctx.createGain();
    bus.gain.value = 0.55;
    // Round everything off: nothing above ~3 kHz gets through, so no click is ever sharp.
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 3200;
    bus.connect(soften);
    soften.connect(ctx.destination);
    hiss = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.05), ctx.sampleRate);
    const d = hiss.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  // Let the audio hardware rest when nothing has clicked for a while.
  clearTimeout(sleepTimer);
  sleepTimer = setTimeout(() => ctx?.state === 'running' && ctx.suspend().catch(() => {}), 20000);
  return ctx;
}

/** A soft pitched thump: the body of every sound. */
function thump(c, at, { from, to = from, dur = 0.06, gain = 0.25, type = 'sine' }) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, at);
  if (to !== from) o.frequency.exponentialRampToValueAtTime(Math.max(30, to), at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g);
  g.connect(bus);
  o.start(at);
  o.stop(at + dur + 0.02);
}

/** A few milliseconds of filtered noise: the "click" on top. */
function tick(c, at, { freq = 1500, q = 1.1, dur = 0.012, gain = 0.1 }) {
  const s = c.createBufferSource();
  s.buffer = hiss;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  s.connect(f);
  f.connect(g);
  g.connect(bus);
  s.start(at);
  s.stop(at + dur + 0.01);
}

const SOUNDS = {
  tap: (c, t) => {
    tick(c, t, { freq: 1700, gain: 0.09 });
    thump(c, t, { from: 190, to: 118, dur: 0.05, gain: 0.2 });
  },
  press: (c, t) => {
    tick(c, t, { freq: 1200, dur: 0.016, gain: 0.12 });
    thump(c, t, { from: 150, to: 82, dur: 0.085, gain: 0.34 });
  },
  tick: (c, t) => {
    tick(c, t, { freq: 2000, dur: 0.007, gain: 0.07 });
    thump(c, t, { from: 250, to: 190, dur: 0.028, gain: 0.09 });
  },
  on: (c, t) => {
    tick(c, t, { freq: 1600, gain: 0.08 });
    thump(c, t, { from: 150, to: 215, dur: 0.07, gain: 0.22 });
  },
  off: (c, t) => {
    tick(c, t, { freq: 1300, gain: 0.08 });
    thump(c, t, { from: 205, to: 128, dur: 0.07, gain: 0.22 });
  },
  open: (c, t) => {
    tick(c, t, { freq: 900, dur: 0.02, gain: 0.05 });
    thump(c, t, { from: 108, to: 172, dur: 0.13, gain: 0.2, type: 'triangle' });
  },
  close: (c, t) => {
    thump(c, t, { from: 168, to: 100, dur: 0.12, gain: 0.19, type: 'triangle' });
  },
  skip: (c, t) => {
    tick(c, t, { freq: 1500, gain: 0.07 });
    thump(c, t, { from: 170, to: 135, dur: 0.045, gain: 0.2 });
  },
  mark: (c, t) => {
    tick(c, t, { freq: 1100, dur: 0.018, gain: 0.12 });
    thump(c, t, { from: 140, to: 92, dur: 0.07, gain: 0.32 });
    thump(c, t + 0.03, { from: 311, dur: 0.11, gain: 0.1, type: 'triangle' });
  },
  success: (c, t) => {
    thump(c, t, { from: 233, dur: 0.14, gain: 0.2, type: 'triangle' });
    thump(c, t + 0.1, { from: 349, dur: 0.22, gain: 0.18, type: 'triangle' });
    tick(c, t, { freq: 1400, gain: 0.05 });
  },
  error: (c, t) => {
    thump(c, t, { from: 124, to: 96, dur: 0.09, gain: 0.28 });
    thump(c, t + 0.12, { from: 110, to: 84, dur: 0.11, gain: 0.26 });
  },
  remove: (c, t) => {
    tick(c, t, { freq: 800, dur: 0.02, gain: 0.08 });
    thump(c, t, { from: 160, to: 62, dur: 0.16, gain: 0.26 });
  },
};

let lastAt = 0;
let lastName = '';
let press = 0; // counts taps
let spokenFor = -1; // the tap that already got a sound of its own

/**
 * Play one of the sounds. Sounds asked for by the app (a view opening, a mark landing)
 * replace the plain click of the tap that caused them, so one press makes one sound.
 */
export function sfx(name, { plain = false } = {}) {
  const make = SOUNDS[name];
  if (!make || document.hidden) return;
  const now = performance.now();
  if (name === lastName && now - lastAt < 38) return; // sliders: no machine-gunning
  if (!plain) spokenFor = press;
  lastAt = now;
  lastName = name;
  const c = context();
  if (!c) return;
  const play = () => make(c, c.currentTime + 0.004);
  if (c.state === 'running') play();
  else c.resume().then(play, () => {});
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && ctx?.state === 'running') ctx.suspend().catch(() => {});
});

/* ───────────── one listener for every button ───────────── */

const TAPPABLE = 'button, [role="button"], a.btn, .chip';
const QUIET = '.scrub, .dial, .q-grip, input, textarea, select';

function soundFor(b) {
  if (b.dataset.sfx) return b.dataset.sfx;
  if (b.matches('.ctl-play, .mini-play, .t-arrow, .add-row')) return 'press';
  if (b.matches('.chip, .seg > button, .cdot, .swatch, .pick, .dial-n, .step, .pc-btn')) return 'tick';
  return 'tap';
}
function motionFor(b) {
  if (b.dataset.fx) return b.dataset.fx;
  if (b.matches('.icon-btn, .nav-btn, .mini-btn, .toast-act')) return 'pop';
  return null;
}

export function initFx() {
  document.addEventListener(
    'click',
    (e) => {
      const b = e.target.closest?.(TAPPABLE);
      if (!b || b.disabled || e.target.closest(QUIET)) return;
      const mine = ++press;
      context(); // wake the audio inside the tap itself (phones insist on that)
      const s = soundFor(b);
      // The button's own handler runs right after this one. If it makes a sound of its own
      // (opening a sheet, say), the plain click stays quiet.
      if (s !== 'none') setTimeout(() => spokenFor !== mine && sfx(s, { plain: true }), 0);
      const fx = motionFor(b);
      if (fx && fx !== 'none') tapFx(b.querySelector('.pp, svg') || b, fx);
    },
    true,
  );
  document.addEventListener('change', (e) => {
    if (e.target.matches?.('.switch input')) sfx(e.target.checked ? 'on' : 'off');
  });
  document.addEventListener('input', (e) => {
    if (e.target.matches?.('input[type="range"]')) sfx('tick');
  });

  // Things that happen, not just things that are pressed.
  on('tracks', (d) => d?.added && sfx('success'));
  on('tracks', (d) => d?.removed && sfx('remove'));
  on('marks', (d) => d?.added && sfx('mark'));
  on('player:error', () => sfx('error'));
  on('player:skip', () => sfx('skip'));
}
