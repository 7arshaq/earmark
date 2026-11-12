// Full-screen views open *out of* the button or tile that launched them and fold back into it.
// On phones the nav row stays put underneath, so its buttons act like tabs: tapping another
// one swaps the view, tapping the lit one goes back home.
import { pushLayer, closeTop } from './nav.js';
import { expandFrom, collapseTo, stagger } from './anim.js';
import { emit } from './store.js';
import { sfx } from './fx.js';

const loaders = {
  library: () => import('./ui/library.js'),
  marks: () => import('./ui/marks.js'),
  settings: () => import('./ui/settings.js'),
};

const open = [];
const top = () => open[open.length - 1] || null;

function announce() {
  const t = top();
  document.documentElement.dataset.view = t?.name || 'home';
  emit('view', { name: t?.name || null, tab: t?.tab || null });
}

/**
 * @param opts.tab   which nav button this view belongs to (defaults to the view's name)
 * @param opts.tone  colour of the view; defaults to the module's own
 */
export async function openView(name, opts = {}, fromEl = null) {
  const tab = opts.tab || name;
  const cur = top();
  if (cur?.tab === tab && !opts.force) {
    cur.ctl.update?.(opts);
    return cur;
  }
  const mod = await loaders[name]();
  const stage = document.getElementById('stage');
  const el = document.createElement('section');
  el.className = `view overlay view-${name} ${opts.tone || mod.tone || ''}`;
  el.style.zIndex = String(20 + open.length);
  stage.append(el);
  const ctl = mod.mount(el, opts) || {};
  const entry = { name, tab, el, ctl, fromEl };
  const below = top();
  open.push(entry);
  announce();
  sfx('open');

  const box = stage.getBoundingClientRect();
  const shown = expandFrom(el, fromEl, box, 10);
  stagger(el.querySelectorAll('[data-stagger]'), { delay: 150, y: 14, step: 45 });
  ctl.entered?.();

  if (below) {
    // A tab swap: the new view takes over the old one's place in history, and the old one
    // is cleared away quietly once it's covered.
    entry.close = below.close;
    entry.close.layer.close = () => closeEntry(entry);
    entry.close.layer.name = `view:${name}`;
    open.splice(open.indexOf(below), 1);
    shown.then(() => {
      below.ctl.unmount?.();
      below.el.remove();
    });
  } else entry.close = pushLayer(() => closeEntry(entry), `view:${name}`);
  return entry;
}

async function closeEntry(entry) {
  const i = open.indexOf(entry);
  if (i !== -1) open.splice(i, 1);
  announce();
  sfx('close');
  const stage = document.getElementById('stage');
  const box = stage.getBoundingClientRect();
  entry.el.style.pointerEvents = 'none';
  entry.el.inert = true;
  await collapseTo(entry.el, entry.fromEl, box, 10);
  entry.ctl.unmount?.();
  entry.el.remove();
}

export const closeView = () => closeTop();
export const openViewName = () => top()?.name || null;
export const openTab = () => top()?.tab || null;
