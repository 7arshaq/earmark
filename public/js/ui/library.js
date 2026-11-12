// Library view: filters & playlists, search, sort, three view modes.
import { state, on, query, getPlaylist, updatePlaylist, deletePlaylist, setSetting, SWATCHES, progressOf, playlistTracks } from '../store.js';
import * as player from '../player.js';
import { icon, tulip } from '../icons.js';
import { h, esc, fmtDur, fmtTime, relDay, debounce } from '../util.js';
import { stagger, swap, animateList, reveal, setText, setHTML } from '../anim.js';
import { closeView } from '../views.js';
import { menu, prompt, confirmSheet, openSheet } from './sheet.js';
import { trackMenu } from './track-actions.js';
import { glyph, timeLabel, longPress } from './home.js';
import { toast } from './toast.js';

export const tone = 'tone-clay';

const FILTERS = [
  ['all', 'All'],
  ['fav', 'Favourites'],
  ['progress', 'In progress'],
  ['new', 'New'],
  ['done', 'Finished'],
  ['loose', 'Unsorted'],
];
const SORTS = [
  ['recent', 'Recently added'],
  ['played', 'Recently played'],
  ['title', 'Title A–Z'],
  ['longest', 'Longest first'],
  ['shortest', 'Shortest first'],
];

export function mount(el, opts = {}) {
  let filter = opts.filter || 'all';
  let search = '';
  let mode = state.settings.viewMode;
  let sort = state.settings.sort;

  el.innerHTML = `
    <header class="vh" data-stagger>
      <button class="back-btn press" type="button" aria-label="Back">${tulip()}</button>
      <div class="vh-titles"><h2 class="v-title" id="lvTitle">Library</h2><span class="v-sub" id="lvSub"></span></div>
      <div class="vh-actions">
        <button class="icon-btn press" type="button" id="lvSearchBtn" aria-label="Search">${icon('search')}</button>
        <button class="icon-btn press" type="button" id="lvSortBtn" aria-label="Sort">${icon('sort')}</button>
        <button class="icon-btn press" type="button" id="lvPlMore" aria-label="Playlist options" hidden>${icon('more')}</button>
      </div>
    </header>
    <div class="lv-search" id="lvSearch"><div class="lv-search-in"><input class="field" type="search" placeholder="Search titles and channels" enterkeyhint="search" autocomplete="off" aria-label="Search"></div></div>
    <div class="lv-bar" data-stagger><div class="chips scroll-x" id="lvChips"></div></div>
    <div class="lv-tools" data-stagger>
      <button class="btn solid sm press" type="button" id="lvPlayAll">${icon('play')}<span>Play all</span></button>
      <span class="lv-count" id="lvCount"></span>
      <div class="seg" id="lvMode" role="tablist" aria-label="View mode">
        <i class="seg-pill" aria-hidden="true"></i>
        <button type="button" data-m="list" aria-label="List view">${icon('v-list')}</button>
        <button type="button" data-m="tiles" aria-label="Tile view">${icon('v-tiles')}</button>
        <button type="button" data-m="compact" aria-label="Compact view">${icon('v-compact')}</button>
      </div>
    </div>
    <div class="v-body" id="lvBody"><div id="lvList"></div></div>`;

  const $ = (s) => el.querySelector(s);
  const listEl = $('#lvList');
  const chipsEl = $('#lvChips');
  const searchWrap = $('#lvSearch');
  const searchInput = searchWrap.querySelector('input');

  const items = () => query({ filter, search, sort });
  const label = () => (filter.startsWith('pl:') ? getPlaylist(filter.slice(3))?.name : FILTERS.find((f) => f[0] === filter)?.[1]) || 'Library';

  function renderHead() {
    const pl = filter.startsWith('pl:') ? getPlaylist(filter.slice(3)) : null;
    const title = pl ? pl.name : filter === 'all' ? 'Library' : label();
    const t = $('#lvTitle');
    if (t.textContent !== title) swap(t, () => (t.textContent = title));
    const list = filter === 'all' ? state.tracks : pl ? playlistTracks(pl.id) : items();
    const dur = list.reduce((n, x) => n + (x.duration || 0), 0);
    setText($('#lvSub'), `${list.length} audio${list.length === 1 ? '' : 's'} · ${fmtDur(dur)}`);
    reveal($('#lvPlMore'), Boolean(pl));
    el.style.setProperty('--accent', pl ? SWATCHES[pl.color % SWATCHES.length].bg : 'transparent');
    el.classList.toggle('is-playlist', Boolean(pl));
  }

  let chipSig = null;
  function renderChips() {
    const chips = [...FILTERS.map(([id, name]) => ({ id, name })), ...state.playlists.map((p) => ({ id: `pl:${p.id}`, name: p.name, color: p.color }))];
    const sig = chips.map((c) => `${c.id}|${c.name}|${c.color}`).join('\n');
    if (sig === chipSig) {
      // Same chips: just move the highlight, so its colour can glide.
      chipsEl.querySelectorAll('.chip[data-f]').forEach((c) => c.classList.toggle('on', c.dataset.f === filter));
      chipsEl.querySelector('.chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      return;
    }
    chipSig = sig;
    chipsEl.innerHTML =
      chips
        .map(
          (c) =>
            `<button type="button" class="chip press ${filter === c.id ? 'on' : ''}" data-f="${c.id}">${c.color !== undefined ? `<i class="sw" style="--sw:${SWATCHES[c.color % SWATCHES.length].bg}"></i>` : ''}${esc(c.name)}</button>`,
        )
        .join('') + `<button type="button" class="chip ghost press" data-new="1">${icon('plus')}Playlist</button>`;
    chipsEl.querySelector('.chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  function placePill(animate = true) {
    const seg = $('#lvMode');
    const b = seg.querySelector(`[data-m="${mode}"]`);
    const pill = seg.querySelector('.seg-pill');
    if (!animate) pill.style.transition = 'none';
    pill.style.width = `${b.offsetWidth}px`;
    pill.style.transform = `translateX(${b.offsetLeft}px)`;
    seg.querySelectorAll('[data-m]').forEach((x) => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    if (!animate) requestAnimationFrame(() => (pill.style.transition = ''));
  }

  function rowHTML(t) {
    const cur = player.P.id === t.id ? 'is-current' : '';
    const p = progressOf(t);
    const lists = t.playlists.map(getPlaylist).filter(Boolean);
    if (mode === 'tiles') {
      const sw = SWATCHES[t.color % SWATCHES.length];
      const big = t.finished ? 'Done' : p > 0.01 ? `${Math.round(p * 100)}<small>%</small>` : fmtDur(t.duration, true);
      return `<div class="ltile press ${cur}" data-id="${t.id}" role="button" tabindex="0" style="--sw:${sw.bg};--sw-ink:${sw.ink};--sw-dim:${sw.dim}">
        <div class="lt-top"><span class="lt-g">${glyph(t)}</span>${t.favorite ? `<span class="lt-fav">${icon('star-fill')}</span>` : ''}<button type="button" class="icon-btn sm r-more" aria-label="More">${icon('more')}</button></div>
        <div class="lt-num">${big}</div>
        <div class="lt-title">${esc(t.title)}</div>
        <div class="lt-bar"><i style="transform:scaleX(${p})"></i></div>
      </div>`;
    }
    if (mode === 'compact') {
      return `<div class="crow ${cur}" data-id="${t.id}" role="button" tabindex="0">
        <span class="c-g">${glyph(t)}</span><span class="c-title">${esc(t.title)}</span>${t.favorite ? `<span class="lr-fav">${icon('star-fill')}</span>` : ''}<span class="c-time">${timeLabel(t)}</span>
      </div>`;
    }
    const meta = [relDay(t.addedAt), t.duration ? fmtDur(t.duration, true) : ''].filter(Boolean).join(' · ');
    return `<div class="row ${cur}" data-id="${t.id}" role="button" tabindex="0">
      <span class="r-g">${glyph(t)}</span>
      <span class="r-main">
        <span class="r-title">${esc(t.title)}${t.favorite ? ` <span class="lr-fav">${icon('star-fill')}</span>` : ''}</span>
        <span class="r-meta">${esc(meta)}${lists.length ? ` · ${lists.map((l) => `<i class="sw" style="--sw:${SWATCHES[l.color % SWATCHES.length].bg}"></i>${esc(l.name)}`).join(' ')}` : ''}</span>
      </span>
      <span class="r-time">${timeLabel(t)}</span>
      <button type="button" class="icon-btn sm r-more" aria-label="More options">${icon('more')}</button>
      <i class="r-prog" style="transform:scaleX(${t.finished ? 0 : p})"></i>
    </div>`;
  }

  function emptyHTML() {
    const msg = search
      ? ['No matches', `Nothing called “${esc(search)}”.`]
      : {
          all: ['Nothing saved yet', 'Paste a YouTube or X link on the home screen.'],
          fav: ['No favourites', 'Tap the star on anything you love.'],
          progress: ['Nothing in progress', 'Half-listened audio waits here.'],
          new: ['All caught up', 'Every audio has been started.'],
          done: ['Nothing finished', 'Finished audio collects here.'],
          loose: ['Everything is sorted', 'Each audio is in a playlist.'],
        }[filter] || ['Empty playlist', 'Use “Playlists” from any audio’s menu to add it here.'];
    return `<div class="v-empty" data-id="empty:${esc(msg[0])}"><span class="ve-big">${msg[0]}</span><span>${msg[1]}</span></div>`;
  }

  /** animate: true = a new set of rows (cascade in); false = the same list changed (rows glide / fade). */
  function renderList(animate = false) {
    if (animate) return paintList(true);
    animateList(listEl, () => paintList(false));
  }
  function paintList(animate) {
    const list = items();
    setText($('#lvCount'), search ? `${list.length} found` : '');
    $('#lvPlayAll').disabled = !list.length;
    listEl.className = `lv-${mode}`;
    listEl.innerHTML = list.length ? list.map(rowHTML).join('') : emptyHTML();
    if (animate) stagger(listEl.children, { y: mode === 'tiles' ? 14 : 8, step: mode === 'compact' ? 18 : 30, scale: mode === 'tiles' ? 0.97 : 1 });
  }

  function refreshGlyphs() {
    listEl.querySelectorAll('[data-id]').forEach((r) => {
      const t = state.byId.get(r.dataset.id);
      if (!t) return;
      r.classList.toggle('is-current', player.P.id === t.id);
      setHTML(r.querySelector('.r-g, .lt-g, .c-g'), glyph(t));
    });
  }

  function setFilter(f) {
    if (f === filter) return;
    filter = f;
    renderChips();
    renderHead();
    swap(listEl, () => renderList(true));
  }

  // events
  el.querySelector('.back-btn').addEventListener('click', closeView);
  chipsEl.addEventListener('click', async (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    if (c.dataset.new) {
      const name = await prompt({ title: 'New playlist', placeholder: 'e.g. Podcasts, Learning, Sleep', ok: 'Create' });
      if (name) {
        const { createPlaylist } = await import('../store.js');
        const p = await createPlaylist(name);
        setFilter(`pl:${p.id}`);
      }
      return;
    }
    setFilter(c.dataset.f);
  });
  $('#lvMode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b || b.dataset.m === mode) return;
    mode = b.dataset.m;
    setSetting('viewMode', mode);
    placePill();
    swap(listEl, () => renderList(true));
  });
  $('#lvSearchBtn').addEventListener('click', () => {
    const open = !searchWrap.classList.contains('open');
    searchWrap.classList.toggle('open', open);
    if (open) setTimeout(() => searchInput.focus(), 60);
    else if (search) {
      search = '';
      searchInput.value = '';
      renderList();
    }
  });
  searchInput.addEventListener(
    'input',
    debounce(() => {
      search = searchInput.value.trim();
      renderList();
    }, 120),
  );
  $('#lvSortBtn').addEventListener('click', (e) =>
    menu(
      e.currentTarget,
      SORTS.map(([k, name]) => ({
        label: name,
        checked: sort === k,
        fn: () => {
          sort = k;
          setSetting('sort', k);
          swap(listEl, () => renderList(true));
        },
      })),
      { title: 'Sort by' },
    ),
  );
  $('#lvPlayAll').addEventListener('click', () => {
    const list = items();
    const first = list.find((t) => !t.finished) || list[0];
    if (first) player.load(first.id, { context: { ids: list.map((t) => t.id), label: label() }, at: first.finished ? 0 : null });
  });
  $('#lvPlMore').addEventListener('click', (e) => {
    const pl = getPlaylist(filter.slice(3));
    if (!pl) return;
    menu(
      e.currentTarget,
      [
        {
          label: 'Rename',
          icon: 'edit',
          fn: async () => {
            const name = await prompt({ title: 'Rename playlist', value: pl.name, ok: 'Save' });
            if (name) updatePlaylist(pl.id, { name });
          },
        },
        { label: 'Colour', icon: 'folder', fn: () => pickColour(pl) },
        '-',
        {
          label: 'Delete playlist',
          icon: 'trash',
          danger: true,
          fn: async () => {
            const ok = await confirmSheet({ title: `Delete “${pl.name}”?`, message: 'The audio inside stays in your library.', ok: 'Delete playlist' });
            if (ok) {
              await deletePlaylist(pl.id);
              filter = 'all';
              renderChips();
              renderHead();
              renderList(true);
              toast('Playlist deleted', { icon: 'trash', duration: 1800 });
            }
          },
        },
      ],
      { title: pl.name },
    );
  });

  listEl.addEventListener('click', (e) => {
    const item = e.target.closest('[data-id]');
    if (!item) return;
    const t = state.byId.get(item.dataset.id);
    if (!t) return;
    if (e.target.closest('.r-more')) return trackMenu(e.target.closest('.r-more'), t);
    player.playFrom(t.id, items().map((x) => x.id), label());
  });
  listEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-id]')) e.target.click();
  });
  listEl.addEventListener('contextmenu', (e) => {
    const item = e.target.closest('[data-id]');
    if (!item) return;
    e.preventDefault();
    const t = state.byId.get(item.dataset.id);
    if (t) trackMenu(item, t);
  });
  longPress(listEl, '[data-id]', (item) => {
    const t = state.byId.get(item.dataset.id);
    if (t) trackMenu(item, t);
  });

  function pickColour(pl) {
    const body = h(`<div class="swatches">${SWATCHES.map((s, i) => `<button type="button" class="swatch press ${pl.color === i ? 'on' : ''}" data-i="${i}" style="--sw:${s.bg}" aria-label="${s.key}"></button>`).join('')}</div>`);
    const s = openSheet({ title: 'Playlist colour', body, className: 'sheet-swatch' });
    body.addEventListener('click', (e) => {
      const b = e.target.closest('.swatch');
      if (!b) return;
      updatePlaylist(pl.id, { color: Number(b.dataset.i) });
      s.close();
    });
  }

  const offs = [
    on('tracks', () => {
      renderHead();
      renderList();
    }),
    on('fav', () => renderList()),
    on('playlists', () => {
      if (filter.startsWith('pl:') && !getPlaylist(filter.slice(3))) filter = 'all';
      renderChips();
      renderHead();
      renderList();
    }),
    on('player:load', refreshGlyphs),
    on('player:state', refreshGlyphs),
  ];

  renderHead();
  renderChips();
  renderList(true);
  requestAnimationFrame(() => placePill(false));

  return {
    update(o) {
      if (o.filter) setFilter(o.filter);
    },
    unmount() {
      offs.forEach((off) => off());
    },
  };
}
