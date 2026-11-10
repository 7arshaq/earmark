// Full-screen views open *out of* the tile that launched them and fold back into it.
import { pushLayer, closeTop } from './nav.js';
import { expandFrom, collapseTo, stagger } from './anim.js';

const loaders = {
  library: () => import('./ui/library.js'),
  marks: () => import('./ui/marks.js'),
  settings: () => import('./ui/settings.js'),
};

const open = [];

export async function openView(name, opts = {}, fromEl = null) {
  const top = open[open.length - 1];
  if (top?.name === name && !opts.force) {
    top.ctl.update?.(opts);
    return top;
  }
  const mod = await loaders[name]();
  const stage = document.getElementById('stage');
  const el = document.createElement('section');
  el.className = `view overlay view-${name} ${mod.tone || ''}`;
  el.style.zIndex = String(20 + open.length);
  stage.append(el);
  const ctl = mod.mount(el, opts) || {};
  const entry = { name, el, ctl, fromEl };
  open.push(entry);
  document.documentElement.dataset.view = name;

  const box = stage.getBoundingClientRect();
  const from = fromEl && fromEl.offsetParent ? fromEl.getBoundingClientRect() : null;
  expandFrom(el, from, box, 10);
  stagger(el.querySelectorAll('[data-stagger]'), { delay: 140, y: 14, step: 45 });
  ctl.entered?.();
  entry.close = pushLayer(() => closeEntry(entry), `view:${name}`);
  return entry;
}

async function closeEntry(entry) {
  const i = open.indexOf(entry);
  if (i !== -1) open.splice(i, 1);
  document.documentElement.dataset.view = open[open.length - 1]?.name || 'home';
  const stage = document.getElementById('stage');
  const box = stage.getBoundingClientRect();
  const to = entry.fromEl && entry.fromEl.isConnected && entry.fromEl.offsetParent ? entry.fromEl.getBoundingClientRect() : null;
  entry.el.style.pointerEvents = 'none';
  entry.el.inert = true;
  await collapseTo(entry.el, to, box, 10);
  entry.ctl.unmount?.();
  entry.el.remove();
}

export const closeView = () => closeTop();
export const openViewName = () => open[open.length - 1]?.name || null;
