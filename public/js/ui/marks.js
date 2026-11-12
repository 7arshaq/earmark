// Every bookmark and note across the library, grouped by audio.
import { state, on, MARK_COLORS } from '../store.js';
import * as player from '../player.js';
import { icon, tulip } from '../icons.js';
import { esc, fmtTime, relDay } from '../util.js';
import { stagger, swap, animateList, reveal, setText } from '../anim.js';
import { closeView } from '../views.js';

export const tone = 'tone-khaki';

export function mount(el) {
  let tab = 'marks';
  let colour = null;

  el.innerHTML = `
    <header class="vh" data-stagger>
      <button class="back-btn press" type="button" aria-label="Back">${tulip()}</button>
      <div class="vh-titles"><h2 class="v-title">Marks</h2><span class="v-sub" id="mvSub"></span></div>
    </header>
    <div class="lv-tools" data-stagger>
      <div class="seg" id="mvTabs" role="tablist">
        <i class="seg-pill" aria-hidden="true"></i>
        <button type="button" data-t="marks">Bookmarks</button>
        <button type="button" data-t="notes">Notes</button>
      </div>
      <div class="mv-colours" id="mvColours"></div>
    </div>
    <div class="v-body" id="mvBody"><div id="mvList"></div></div>`;
  const q = (s) => el.querySelector(s);
  const list = q('#mvList');

  function placePill(animate = true) {
    const seg = q('#mvTabs');
    const b = seg.querySelector(`[data-t="${tab}"]`);
    const pill = seg.querySelector('.seg-pill');
    if (!animate) pill.style.transition = 'none';
    pill.style.width = `${b.offsetWidth}px`;
    pill.style.transform = `translateX(${b.offsetLeft}px)`;
    if (!animate) requestAnimationFrame(() => (pill.style.transition = ''));
  }

  function renderColours() {
    const box = q('#mvColours');
    reveal(box, tab === 'marks');
    if (box.childElementCount) {
      box.querySelectorAll('.cdot').forEach((d) => d.classList.toggle('on', (d.dataset.c || null) === colour));
      return;
    }
    box.innerHTML =
      `<button type="button" class="cdot all press ${colour === null ? 'on' : ''}" data-c="" aria-label="All colours">All</button>` +
      MARK_COLORS.map((c) => `<button type="button" class="cdot press ${colour === c ? 'on' : ''}" data-c="${c}" style="--c:${c}" aria-label="Filter by colour"></button>`).join('');
  }

  function render(animate) {
    const tracks = state.tracks.slice().sort((a, b) => (b.lastPlayedAt || b.addedAt) - (a.lastPlayedAt || a.addedAt));
    const totalMarks = tracks.reduce((n, t) => n + t.marks.length, 0);
    const totalNotes = tracks.reduce((n, t) => n + (t.notes?.length || 0), 0);
    setText(q('#mvSub'), `${totalMarks} bookmark${totalMarks === 1 ? '' : 's'} · ${totalNotes} note${totalNotes === 1 ? '' : 's'}`);
    let html = '';
    for (const t of tracks) {
      if (tab === 'marks') {
        const ms = t.marks.filter((m) => !colour || m.color === colour);
        if (!ms.length) continue;
        html += `<section class="mgroup" data-id="${t.id}"><div class="mg-head"><span class="mg-title">${esc(t.title)}</span><span class="mg-count">${ms.length}</span></div>
          ${ms.map((m) => `<button type="button" class="mrow press" data-tid="${t.id}" data-t="${m.t}"><i class="mk-dot" style="--c:${m.color}"></i><span class="mr-name">${esc(m.name)}</span><span class="mr-t">${icon('play')}${fmtTime(m.t)}</span></button>`).join('')}</section>`;
      } else {
        const ns = (t.notes || []).slice().reverse();
        if (!ns.length) continue;
        html += `<section class="mgroup" data-id="${t.id}"><div class="mg-head"><span class="mg-title">${esc(t.title)}</span><span class="mg-count">${ns.length}</span></div>
          ${ns.map((n) => `<button type="button" class="nrow press" data-tid="${t.id}" ${n.t != null ? `data-t="${n.t}"` : ''}><span class="nr-text">${esc(n.text)}</span><span class="nr-meta">${n.t != null ? `${icon('play')}${fmtTime(n.t)} · ` : ''}${relDay(n.at)}</span></button>`).join('')}</section>`;
      }
    }
    const paint = () =>
      (list.innerHTML =
      html ||
      `<div class="v-empty" data-id="empty:${tab}"><span class="ve-big">${tab === 'marks' ? 'No bookmarks yet' : 'No notes yet'}</span><span>${tab === 'marks' ? 'While listening, tap Mark to pin a moment. Name it, colour it, jump back any time.' : 'Open the player and write in the Notes tab. Notes can hold the exact time.'}</span></div>`);
    if (animate) {
      paint();
      stagger(list.querySelectorAll('.mgroup'), { y: 10, step: 40 });
    } else animateList(list, paint);
  }

  el.querySelector('.back-btn').addEventListener('click', closeView);
  q('#mvTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b || b.dataset.t === tab) return;
    tab = b.dataset.t;
    placePill();
    renderColours();
    swap(list, () => render(true));
  });
  q('#mvColours').addEventListener('click', (e) => {
    const b = e.target.closest('.cdot');
    if (!b) return;
    colour = b.dataset.c || null;
    renderColours();
    swap(list, () => render(true));
  });
  list.addEventListener('click', (e) => {
    const r = e.target.closest('[data-tid]');
    if (!r) return;
    const at = r.dataset.t !== undefined ? Number(r.dataset.t) : null;
    if (player.P.id === r.dataset.tid) {
      if (at !== null) player.seek(at);
      player.play();
    } else player.load(r.dataset.tid, { at });
  });

  const offs = [on('marks', () => render()), on('notes', () => render()), on('tracks', () => render())];
  renderColours();
  render(true);
  requestAnimationFrame(() => placePill(false));
  return { unmount: () => offs.forEach((o) => o()) };
}
