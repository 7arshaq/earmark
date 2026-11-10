// Motion toolkit. Rules: transform/opacity/clip-path only, custom curves, exits faster than entrances,
// everything interruptible, and reduced-motion users get fades instead of movement.
import { motionOK } from './util.js';

export const EASE = {
  out: 'cubic-bezier(0.23, 1, 0.32, 1)',
  inOut: 'cubic-bezier(0.77, 0, 0.175, 1)',
  drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
  pop: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
};

/** Odometer-style text: changed digits roll in instead of snapping. */
export class Roller {
  constructor(el, { dir = 1 } = {}) {
    this.el = el;
    this.dir = dir;
    this.value = el.textContent || '';
    el.classList.add('roller');
  }
  set(text, { animate = true, dir = this.dir } = {}) {
    text = String(text);
    if (text === this.value) return;
    const prev = this.value;
    this.value = text;
    const el = this.el;
    if (!animate || !prev || !motionOK() || !el.isConnected || document.hidden) {
      el.textContent = text;
      return;
    }
    const frag = document.createDocumentFragment();
    const n = text.length;
    const m = prev.length;
    for (let i = 0; i < n; i++) {
      const c = text[i];
      const pc = prev[m - (n - i)];
      const cell = document.createElement('span');
      cell.className = 'rc';
      cell.textContent = c;
      frag.append(cell);
      if (c !== pc) {
        cell.animate(
          [
            { transform: `translateY(${dir * 0.42}em)`, opacity: 0, filter: 'blur(2px)' },
            { transform: 'translateY(0)', opacity: 1, filter: 'blur(0)' },
          ],
          { duration: 280, easing: EASE.out, delay: Math.max(0, (n - i - 1) * -12) },
        );
      }
    }
    el.replaceChildren(frag);
  }
}

/** A view grows out of the tile that opened it (clip-path, GPU-friendly, interruptible-ish). */
export function expandFrom(el, fromRect, box, radius = 10) {
  if (!fromRect || !motionOK()) {
    return el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' }).finished;
  }
  const inset = insetFor(fromRect, box, radius);
  return el.animate([{ clipPath: inset }, { clipPath: `inset(0px 0px 0px 0px round ${radius}px)` }], {
    duration: 560,
    easing: EASE.drawer,
  }).finished;
}

export function collapseTo(el, toRect, box, radius = 10) {
  if (!toRect || !motionOK() || !toRect.width) {
    return el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(16px) scale(.985)' }], {
      duration: 220,
      easing: EASE.out,
      fill: 'forwards',
    }).finished;
  }
  return el.animate([{ clipPath: `inset(0px 0px 0px 0px round ${radius}px)` }, { clipPath: insetFor(toRect, box, radius) }], {
    duration: 400,
    easing: EASE.inOut,
    fill: 'forwards',
  }).finished;
}

function insetFor(r, box, radius) {
  const t = Math.max(0, r.top - box.top);
  const l = Math.max(0, r.left - box.left);
  const rr = Math.max(0, box.right - r.right);
  const b = Math.max(0, box.bottom - r.bottom);
  return `inset(${t}px ${rr}px ${b}px ${l}px round ${radius}px)`;
}

/** Cascade a group in. Decorative only: never blocks input. */
export function stagger(els, { y = 10, step = 34, duration = 420, delay = 0, scale = 1, max = 14 } = {}) {
  const list = [...els].filter(Boolean);
  if (!motionOK()) {
    list.forEach((e) => e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'backwards' }));
    return;
  }
  list.forEach((e, i) => {
    e.animate(
      [
        { opacity: 0, transform: `translateY(${y}px) scale(${scale})` },
        { opacity: 1, transform: 'none' },
      ],
      { duration, easing: EASE.out, delay: delay + Math.min(i, max) * step, fill: 'backwards' },
    );
  });
}

/** FLIP: animate elements from where they were to where a DOM change put them. */
export function flip(els, mutate, { duration = 440, easing = EASE.inOut, scale = false } = {}) {
  const list = [...els];
  const first = new Map(list.map((e) => [e, e.getBoundingClientRect()]));
  mutate();
  if (!motionOK()) return;
  for (const e of list) {
    const a = first.get(e);
    const b = e.getBoundingClientRect();
    if (!a.width || !b.width) continue;
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    const sx = scale ? a.width / b.width : 1;
    const sy = scale ? a.height / b.height : 1;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
    e.animate(
      [
        { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transformOrigin: 'top left', transform: 'none' },
      ],
      { duration, easing },
    );
  }
}

/** Layout morph: View Transitions where available, FLIP otherwise. */
export function morph(mutate, fallbackEls = []) {
  if (!motionOK()) return mutate();
  if (document.startViewTransition) {
    document.documentElement.classList.add('vt-morph');
    const vt = document.startViewTransition(mutate);
    vt.ready.catch(() => {});
    vt.finished.catch(() => {}).finally(() => document.documentElement.classList.remove('vt-morph'));
    return vt.updateCallbackDone;
  }
  flip(fallbackEls, mutate, { scale: true });
}

/** Blur-crossfade a piece of content while it changes. */
export async function swap(el, update) {
  if (!motionOK() || !el.isConnected) return update();
  await el.animate([{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(3px)' }], { duration: 110, easing: 'ease-out', fill: 'forwards' }).finished;
  update();
  el.getAnimations().forEach((a) => a.cancel());
  el.animate([{ opacity: 0, filter: 'blur(3px)' }, { opacity: 1, filter: 'blur(0px)' }], { duration: 220, easing: EASE.out });
}

export async function collapseOut(el) {
  if (!motionOK()) return el.remove();
  const h = el.offsetHeight;
  el.style.overflow = 'hidden';
  await el.animate(
    [
      { height: `${h}px`, opacity: 1, transform: 'none' },
      { height: '0px', opacity: 0, transform: 'translateX(-12px)', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px' },
    ],
    { duration: 280, easing: EASE.inOut, fill: 'forwards' },
  ).finished;
  el.remove();
}

export function pop(el, amount = 1.25) {
  if (!motionOK()) return;
  el.animate([{ transform: 'scale(1)' }, { transform: `scale(${amount})`, offset: 0.35 }, { transform: 'scale(1)' }], {
    duration: 420,
    easing: EASE.out,
  });
}

export function nudge(el, x = 6) {
  if (!motionOK()) return;
  el.animate(
    [{ transform: 'translateX(0)' }, { transform: `translateX(${-x}px)` }, { transform: `translateX(${x}px)` }, { transform: `translateX(${-x / 2}px)` }, { transform: 'translateX(0)' }],
    { duration: 360, easing: 'ease-out' },
  );
}

/**
 * Drag-to-dismiss for sheets. Velocity-aware (a flick is enough), rubber-bands upward.
 * The handle needs touch-action:none in CSS.
 */
export function dragDismiss(el, { handle = el, onDismiss, canStart = () => true, distance = 0.25 } = {}) {
  let pid = null;
  let y0 = 0;
  let dy = 0;
  let dragging = false;
  let samples = [];

  const down = (e) => {
    if (pid !== null || (e.pointerType === 'mouse' && e.button !== 0) || !canStart(e)) return;
    pid = e.pointerId;
    y0 = e.clientY;
    dy = 0;
    dragging = false;
    samples = [{ y: e.clientY, t: performance.now() }];
  };
  const move = (e) => {
    if (e.pointerId !== pid) return;
    const d = e.clientY - y0;
    if (!dragging) {
      if (Math.abs(d) < 6) return;
      dragging = true;
      try {
        handle.setPointerCapture(pid);
      } catch {}
      el.style.transition = 'none';
      el.classList.add('dragging');
    }
    dy = d > 0 ? d : -Math.pow(-d, 0.7);
    el.style.transform = `translate3d(0, ${dy}px, 0)`;
    samples.push({ y: e.clientY, t: performance.now() });
    if (samples.length > 6) samples.shift();
  };
  const up = (e) => {
    if (e.pointerId !== pid) return;
    pid = null;
    if (!dragging) return;
    dragging = false;
    el.classList.remove('dragging');
    const a = samples[0];
    const b = samples[samples.length - 1];
    const v = (b.y - a.y) / Math.max(1, b.t - a.t);
    el.style.transition = '';
    if (dy > el.offsetHeight * distance || (v > 0.45 && dy > 24)) {
      onDismiss?.({ fromDrag: true, dy });
    } else {
      el.style.transform = '';
    }
    // Swallow the click that follows a drag.
    const stop = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    handle.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => handle.removeEventListener('click', stop, { capture: true }), 50);
  };
  handle.addEventListener('pointerdown', down);
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
}
