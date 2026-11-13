// The bento home: paste → fetch, continue, listening insights, library, playlists, sections.
import { state, on, query, continueTrack, progressOf, playlistTracks, getPlaylist, setInPlaylist, createPlaylist, SWATCHES } from '../store.js';
import * as player from '../player.js';
import { addLink, overall, STAGE_LABEL, activeJobs, retry, trackForJob } from '../downloads.js';
import { pickFiles, importFiles, pendingLinks, fetchMode } from '../importer.js';
import { icon, tulip } from '../icons.js';
import { Roller, stagger, nudge, swap, animateList, setText, setHTML, EASE } from '../anim.js';
import { $, h, esc, fmtTime, fmtDur, fmtBytes, sourceOf, extractUrl, dayKey, prettyFraction, haptic, throttle, motionOK } from '../util.js';
import { toast } from './toast.js';
import { prompt } from './sheet.js';
import { openView, closeView, openTab } from '../views.js';
import { sfx } from '../fx.js';
import { trackMenu } from './track-actions.js';
import { openPlayer } from './player-ui.js';

const ring = (p, size = 14) => {
  const r = 5.2;
  const c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 14 14" width="${size}" height="${size}" aria-hidden="true"><circle cx="7" cy="7" r="${r}" class="rg-t"/><circle cx="7" cy="7" r="${r}" class="rg-f" stroke-dasharray="${(c * p).toFixed(2)} ${c.toFixed(2)}"/></svg>`;
};
const EQ = '<i class="eq" aria-hidden="true"><b></b><b></b><b></b></i>';

export function glyph(t) {
  if (player.P.id === t.id && player.isPlaying()) return EQ;
  if (t.finished) return `<span class="g-done">${icon('check')}</span>`;
  const p = progressOf(t);
  if (p > 0.005) return ring(p);
  return '<i class="g-new" aria-hidden="true"></i>';
}

export function timeLabel(t) {
  if (!t.finished && t.position > 5 && t.duration) return `-${fmtTime(t.duration - t.position)}`;
  return t.duration ? fmtTime(t.duration) : '—';
}

/* The four sections. Each button wears the colour of the view it opens, so the view reads
   as the button itself growing. */
const NAV = [
  { go: 'library', label: 'Library', ic: 'stack', tone: 'tone-clay', view: 'library', opts: {} },
  { go: 'fav', label: 'Favourites', ic: 'star', tone: 'tone-sage', view: 'library', opts: { filter: 'fav', tone: 'tone-sage' } },
  { go: 'marks', label: 'Marks', ic: 'mark', tone: 'tone-khaki', view: 'marks', opts: {} },
  { go: 'settings', label: 'Settings', ic: 'sliders', tone: 'tone-navy', view: 'settings', opts: {} },
];
const navButtons = (cls) =>
  NAV.map((n) => `<button class="nav-btn ${cls} ${n.tone} press" type="button" data-go="${n.go}" data-sfx="none" aria-label="${n.label}">${icon(n.ic)}<span>${n.label}</span></button>`).join('');

function go(btn) {
  const n = NAV.find((x) => x.go === btn.dataset.go);
  if (!n) return;
  if (openTab() === n.go) return closeView(); // the lit tab takes you back home
  openView(n.view, { ...n.opts, tab: n.go }, btn);
}

/** Shared result handling for anything that adds a link (paste, share target, deep link). */
export function handleResult(res) {
  if (!res) return;
  if (res.handoff) {
    // The toast waits while you're in Shortcuts, so "Import" is right there when you come back.
    toast('Downloading in Shortcuts. Back here when it’s done?', { icon: 'download', duration: 9000, action: { label: 'Import', fn: runImport } });
  } else if (res.duplicate) {
    const t = res.duplicate;
    toast(`Already saved: ${t.title}`, { icon: 'check', action: { label: 'Play', fn: () => player.load(t.id) } });
  } else if (res.error && !res.job) {
    sfx('error');
    toast(res.error, { icon: 'info' });
  } else if (res.error) {
    sfx('error');
    toast(res.error, { icon: 'info', duration: 7000, action: { label: 'Retry', fn: () => retry(res.job).then(handleResult) } });
  } else if (res.track) {
    const t = res.track;
    if (res.filed) {
      toast(`Saved to ${res.filed.name}`, {
        icon: 'folder',
        duration: 5000,
        action: { label: 'Undo', fn: () => setInPlaylist(t.id, res.filed.id, false) },
      });
    } else {
      const lists = [...state.playlists].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
      toast(`Saved — ${t.title}`, {
        icon: 'check',
        duration: 7000,
        action: { label: 'Play', fn: () => player.load(t.id) },
        chips: [
          ...lists.map((p) => ({
            label: p.name,
            icon: 'folder',
            fn: async (btn) => {
              await setInPlaylist(t.id, p.id);
              btn.classList.toggle('on', t.playlists.includes(p.id));
              return true;
            },
          })),
          {
            label: lists.length ? 'New' : 'Add to a playlist',
            icon: 'plus',
            fn: async () => {
              const name = await prompt({ title: 'New playlist', placeholder: 'e.g. Podcasts, Learning, Sleep', ok: 'Create' });
              if (name) {
                const p = await createPlaylist(name);
                await setInPlaylist(t.id, p.id, true);
                toast(`Added to ${p.name}`, { icon: 'folder', duration: 1800 });
              }
            },
          },
        ],
      });
    }
  }
}

/** File picker → library. Must be called straight from a tap. */
export async function runImport() {
  reportImport(await pickFiles());
}

export function reportImport(out) {
  if (!out?.length) return;
  if (out.length === 1) return handleResult(out[0]);
  const ok = out.filter((r) => r.track).length;
  const dupes = out.filter((r) => r.duplicate).length;
  const bad = out.filter((r) => r.error).length;
  toast([`Imported ${ok}`, dupes && `${dupes} already saved`, bad && `${bad} failed`].filter(Boolean).join(' · '), { icon: ok ? 'check' : 'info', duration: 3200 });
}

export function mountHome(root) {
  root.innerHTML = `
  <div class="bento">
    <section class="tile t-paste tone-silver" style="--i:0">
      <form class="pc pc-send" id="pasteForm" autocomplete="off" novalidate>
        <div class="pc-row">
          <label class="pc-label" for="linkInput">Paste a link</label>
          <span class="pc-btns">
            <button type="button" class="pc-btn pc-imp press" id="importBtn" data-fx="pop" aria-label="Import an audio file" title="Import an audio file">${icon('folder')}</button>
            <span class="pc-swap">
              <button type="button" class="pc-btn press" id="pasteBtn" data-fx="tilt">${icon('clip')}<span>Paste</span></button>
              <button type="button" class="pc-btn pc-clear press" id="clearBtn" data-fx="pop" aria-label="Clear">${icon('close')}</button>
            </span>
          </span>
        </div>
        <input id="linkInput" class="pc-input" type="url" inputmode="url" placeholder="Paste a link…" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go" aria-label="Video link">
        <div class="pc-row pc-foot"><span class="pc-unit" id="srcTag">YouTube · X · more</span><span class="pc-hint">↵ to fetch</span></div>
      </form>
      <div class="pc pc-recv" id="recv" role="button" tabindex="0" aria-live="polite">
        <div class="pc-row"><span class="pc-label">Receive</span><span class="pc-stage" id="recvStage"><i class="srv-dot"></i><span id="recvStageText">Idle</span></span></div>
        <div class="pc-main"><span class="recv-title" id="recvTitle">Audio lands here</span><span class="recv-num" id="recvNum">—</span></div>
        <div class="pc-row pc-foot"><span class="pc-unit">MP3</span><span class="recv-sub" id="recvSub"></span></div>
        <i class="recv-bar" id="recvBar"></i>
      </div>
    </section>

    <button class="tile t-arrow tone-navy press" id="fetchBtn" type="button" data-state="idle" data-sfx="press" aria-label="Fetch audio" style="--i:1">
      <i class="arrow-fill" id="arrowFill"></i>
      <span class="arrow-glyph">${tulip()}</span>
      <span class="arrow-label" id="arrowLabel">Fetch</span>
    </button>

    <section class="tile t-cont tone-orange press" id="contTile" role="button" tabindex="0" style="--i:2">
      <div class="ct-pct"><span class="ct-approx">≈</span><span id="ctPct">0</span><span class="ct-unit">%</span></div>
      <div class="ct-body">
        <div class="ct-kicker"><i class="ct-dot"></i><span id="ctKicker">Continue</span></div>
        <div class="ct-title" id="ctTitle">Nothing yet</div>
        <div class="ct-sub" id="ctSub">Paste a link to begin</div>
      </div>
      <div class="ct-bar"><i id="ctFill"></i></div>
    </section>

    <section class="tile t-ins tone-sage" id="insTile" style="--i:3">
      <div class="ins-head"><h3 class="tile-h"><span class="h-a">Listening</span> <span class="h-b">this week</span></h3><span class="ins-legend"><i></i>last week</span></div>
      <div class="bars" id="bars"></div>
      <div class="ins-foot"><span>All time:</span><span class="ins-total" id="insTotal">0m</span></div>
    </section>

    <section class="tile t-lib tone-clay" id="libTile" style="--i:4">
      <header class="lib-head">
        <button class="lib-title press" id="libOpen" type="button"><h3 class="tile-h">Library</h3><span class="lib-count" id="libCount">0</span>${icon('chev-right')}</button>
      </header>
      <div class="lib-chips" id="libChips"></div>
      <div class="lib-list" id="libList"></div>
    </section>

    <section class="tile t-lists tone-gray" id="listsTile" style="--i:5">
      <header class="lists-head">
        <h3 class="tile-h">Playlists</h3>
        <button class="icon-btn sm press" id="newList" type="button" aria-label="New playlist">${icon('plus')}</button>
      </header>
      <div class="lists-total" id="listsTotal">0<em>h</em></div>
      <div class="stack" id="stack"></div>
    </section>

    <nav class="t-quick" aria-label="Sections" style="--i:6">${navButtons('qbtn')}</nav>

    <section class="tile t-donut" id="donutTile" role="button" tabindex="0" style="--i:7">
      <svg class="dn-svg" viewBox="0 0 120 120" aria-hidden="true">
        <defs><linearGradient id="dnGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7ead2"/><stop offset="1" stop-color="#d8b981"/></linearGradient></defs>
        <circle class="dn-track" cx="60" cy="60" r="41"/>
        <circle class="dn-seg" id="dnSeg" cx="60" cy="60" r="41"/>
      </svg>
      <div class="dn-center"><span class="dn-val" id="dnVal">0</span></div>
      <span class="dn-cap" id="dnCap">finished</span>
    </section>
  </div>`;

  // The phone's bottom row lives outside the bento, under the mini player.
  const tabbar = document.getElementById('tabbar');
  tabbar.innerHTML = navButtons('tab');

  const els = {
    form: $('#pasteForm', root),
    input: $('#linkInput', root),
    srcTag: $('#srcTag', root),
    clear: $('#clearBtn', root),
    recv: $('#recv', root),
    recvTitle: $('#recvTitle', root),
    recvNum: $('#recvNum', root),
    recvSub: $('#recvSub', root),
    recvStage: $('#recvStage', root),
    recvStageText: $('#recvStageText', root),
    recvBar: $('#recvBar', root),
    fetch: $('#fetchBtn', root),
    arrowFill: $('#arrowFill', root),
    arrowLabel: $('#arrowLabel', root),
    cont: $('#contTile', root),
    ctPct: $('#ctPct', root),
    ctKicker: $('#ctKicker', root),
    ctTitle: $('#ctTitle', root),
    ctSub: $('#ctSub', root),
    ctFill: $('#ctFill', root),
    bars: $('#bars', root),
    insTotal: $('#insTotal', root),
    libList: $('#libList', root),
    libCount: $('#libCount', root),
    libChips: $('#libChips', root),
    stack: $('#stack', root),
    listsTotal: $('#listsTotal', root),
    dnSeg: $('#dnSeg', root),
    dnVal: $('#dnVal', root),
    dnCap: $('#dnCap', root),
    donut: $('#donutTile', root),
  };
  const ctRoll = new Roller(els.ctPct);
  const numRoll = new Roller(els.recvNum);
  const arrowRoll = new Roller(els.arrowLabel);

  /* ── paste & fetch ── */
  const inputUrl = () => extractUrl(els.input.value);
  function updateSrc() {
    const url = inputUrl();
    const src = url ? sourceOf(url) : null;
    setText(els.srcTag, src ? `${src.name} → audio` : els.input.value ? 'Not a link yet' : 'YouTube · X · more');
    els.form.classList.toggle('has-text', Boolean(els.input.value));
    els.form.classList.toggle('valid', Boolean(url));
    renderArrow();
  }

  function flyOut() {
    if (!motionOK() || !els.input.value) return;
    const r = els.input.getBoundingClientRect();
    const ghost = h(`<span class="fly-ghost">${esc(els.input.value)}</span>`);
    Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    document.body.append(ghost);
    const target = els.recv.getBoundingClientRect();
    ghost
      .animate(
        [
          { transform: 'none', opacity: 1, filter: 'blur(0)' },
          { transform: `translate(${target.left - r.left}px, ${target.top + target.height / 2 - r.top - r.height / 2}px) scale(.92)`, opacity: 0, filter: 'blur(3px)' },
        ],
        { duration: 460, easing: EASE.inOut },
      )
      .finished.then(() => ghost.remove());
  }

  async function submit() {
    const url = inputUrl();
    if (!url) {
      nudge(els.form);
      if (els.input.value) toast("That doesn't look like a link", { icon: 'info', duration: 2200 });
      else els.input.focus();
      return;
    }
    if (fetchMode() === 'server' && state.server.online === false) {
      toast("Can't reach the server. Listening still works, or import a file.", { icon: 'server', duration: 6000, action: { label: 'Import', fn: runImport } });
    }
    flyOut();
    els.input.value = '';
    els.input.blur();
    updateSrc();
    haptic(10);
    handleResult(await addLink(url));
  }

  async function fromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      const url = extractUrl(text);
      if (url) {
        els.input.value = url;
        updateSrc();
        if (state.settings.autoFetch) submit();
        else els.input.focus();
      } else {
        toast('No link on the clipboard', { icon: 'clip', duration: 2200 });
        els.input.focus();
      }
    } catch {
      els.input.focus();
      toast('Long-press the box and choose Paste', { icon: 'clip', duration: 2600 });
    }
  }

  els.input.addEventListener('input', updateSrc);
  els.input.addEventListener('paste', (e) => {
    const url = extractUrl(e.clipboardData?.getData('text'));
    if (url && state.settings.autoFetch) {
      e.preventDefault();
      els.input.value = url;
      updateSrc();
      submit();
    }
  });
  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  $('#pasteBtn', root).addEventListener('click', fromClipboard);
  els.clear.addEventListener('click', () => {
    els.input.value = '';
    updateSrc();
    els.input.focus();
  });
  els.fetch.addEventListener('click', () => (inputUrl() ? submit() : pendingLinks().length ? runImport() : fromClipboard()));
  $('#importBtn', root).addEventListener('click', runImport);

  /* drop audio files anywhere to import (computers) */
  const pasteTile = root.querySelector('.t-paste');
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const endDrag = () => {
    dragDepth = 0;
    pasteTile.classList.remove('drop');
  };
  addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    pasteTile.classList.add('drop');
  });
  addEventListener('dragleave', (e) => {
    if (hasFiles(e) && --dragDepth <= 0) endDrag();
  });
  addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    endDrag();
    reportImport(await importFiles(e.dataTransfer.files));
  });

  els.recv.addEventListener('click', () => {
    const job = state.jobs[0];
    if (!job) return els.input.focus();
    if (job.stage === 'handoff') {
      runImport();
    } else if (job.stage === 'done') {
      const t = trackForJob(job);
      if (t) player.load(t.id);
    } else if (job.stage === 'error' && job.url) {
      retry(job).then(handleResult);
    }
  });

  function renderArrow() {
    const busy = activeJobs();
    const job = state.jobs[0];
    const fresh = job && Date.now() - (job.updatedAt || 0) < 2600;
    let st = inputUrl() ? 'ready' : 'idle';
    if (busy.length) st = 'busy';
    else if (fresh && job.stage === 'done') st = 'done';
    else if (fresh && job.stage === 'error') st = 'error';
    else if (st === 'idle' && pendingLinks().length) st = 'import';
    els.fetch.dataset.state = st;
    els.fetch.setAttribute('aria-label', st === 'import' ? 'Import the downloaded audio' : 'Fetch audio');
    const p = busy.length ? overall(busy[busy.length - 1]) : st === 'done' ? 1 : 0;
    els.arrowFill.style.transform = `scaleY(${p})`;
    arrowRoll.set(st === 'busy' ? `${Math.round(p * 100)}%` : st === 'done' ? 'Saved' : st === 'error' ? 'Retry' : st === 'import' ? 'Import' : 'Fetch');
  }

  function renderJobs() {
    const job = state.jobs[0];
    const busy = activeJobs();
    renderArrow();
    els.recv.dataset.stage = job?.stage || 'idle';
    if (!job) {
      els.recvTitle.textContent = 'Audio lands here';
      numRoll.set('—', { animate: false });
      setText(els.recvSub, '');
      setText(els.recvStageText, serverLabel());
      els.recvBar.style.transform = 'scaleX(0)';
      return;
    }
    const m = job.meta;
    const title =
      job.stage === 'error' ? job.error || "Couldn't fetch" : job.stage === 'handoff' ? `${job.source?.name || 'Link'} · downloading in Shortcuts` : m?.shortTitle || (job.stage === 'sending' || job.stage === 'queued' ? `${job.source?.name || 'Link'} · waiting` : `${job.source?.name || 'Link'} · reading…`);
    if (els.recvTitle.textContent !== title) {
      if (els.recvTitle.textContent && els.recvTitle.textContent !== 'Audio lands here') swap(els.recvTitle, () => (els.recvTitle.textContent = title));
      else els.recvTitle.textContent = title;
    }
    els.recvTitle.title = m?.title || title;
    const p = overall(job);
    if (job.stage === 'done') numRoll.set(m?.duration ? fmtTime(m.duration) : fmtBytes(job.size));
    else if (job.stage === 'error') numRoll.set('!');
    else if (job.stage === 'handoff') numRoll.set('↗');
    else numRoll.set(`${Math.round(p * 100)}%`);
    setText(els.recvStageText, STAGE_LABEL[job.stage] || job.stage);
    const sub =
      job.stage === 'done' ? `${fmtBytes(job.size)} · tap to play` : job.stage === 'error' ? (job.url ? 'Tap to retry' : '') : job.stage === 'handoff' ? 'Done? Tap to import' : busy.length > 1 ? `+${busy.length - 1} more` : m?.uploader || '';
    setText(els.recvSub, sub);
    els.recvBar.style.transform = `scaleX(${job.stage === 'error' || job.stage === 'handoff' ? 0 : p})`;
  }

  function serverLabel() {
    if (fetchMode() === 'shortcut') return 'Via Shortcuts';
    const s = state.server;
    if (s.online === null) return 'Checking…';
    if (!s.online) return 'Server offline';
    if (s.locked && !s.authorized) return 'Needs key';
    if (!s.ytdlp && !s.demo) return 'No yt-dlp';
    return 'Ready';
  }
  function renderServer() {
    const s = state.server;
    els.recvStage.dataset.server = fetchMode() === 'shortcut' ? 'ok' : s.online === null ? 'checking' : s.online && (s.ytdlp || s.demo) && (!s.locked || s.authorized) ? 'ok' : 'bad';
    if (!state.jobs.length) setText(els.recvStageText, serverLabel());
  }

  /* ── continue ── */
  function renderContinue() {
    const t = continueTrack(player.P.id);
    els.cont.dataset.empty = t ? '' : '1';
    if (!t) {
      ctRoll.set('0', { animate: false });
      setText(els.ctKicker, 'Start here');
      setText(els.ctTitle, 'Nothing yet');
      setText(els.ctSub, 'Paste a link to begin');
      els.ctFill.style.transform = 'scaleX(0)';
      return;
    }
    const isCur = player.P.id === t.id;
    const pos = isCur ? player.time() : t.position || 0;
    const dur = (isCur && player.duration()) || t.duration || 0;
    const p = t.finished ? 1 : dur ? Math.min(1, pos / dur) : 0;
    ctRoll.set(String(Math.round(p * 100)));
    setText(els.ctKicker, isCur && player.isPlaying() ? 'Now playing' : t.finished ? 'Play again' : pos > 5 ? 'Continue' : 'Up next');
    setText(els.ctTitle, t.title);
    setText(els.ctSub, t.finished ? 'Finished' : dur ? `${fmtDur(dur - pos)} left` : '');
    els.ctFill.style.transform = `scaleX(${p})`;
    els.cont.dataset.playing = isCur && player.isPlaying() ? '1' : '';
  }
  els.cont.addEventListener('click', () => {
    const t = continueTrack(player.P.id);
    if (!t) return els.input.focus();
    if (player.P.id === t.id) {
      if (player.isPlaying()) openPlayer();
      else player.play();
    } else {
      const ids = query({ sort: 'played' }).map((x) => x.id);
      player.load(t.id, { context: { ids, label: 'Recent' } });
    }
  });

  /* ── insights ── */
  function renderInsights() {
    const now = new Date();
    const dow = (now.getDay() + 6) % 7;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
    const days = state.stats.days || {};
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const cur = [];
    const last = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      const l = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i - 7);
      cur.push(days[dayKey(d)] || 0);
      last.push(days[dayKey(l)] || 0);
    }
    const max = Math.max(15 * 60, ...cur, ...last);
    const first = !els.bars.children.length;
    if (first) {
      els.bars.innerHTML = names
        .map(
          (n, i) =>
            `<div class="bar ${i === dow ? 'today' : ''}" title=""><div class="bar-col"><i class="b-last"></i><i class="b-cur"></i></div><span>${n}</span></div>`,
        )
        .join('');
    }
    [...els.bars.children].forEach((b, i) => {
      b.style.setProperty('--last', (last[i] / max).toFixed(3));
      b.style.setProperty('--cur', (cur[i] / max).toFixed(3));
      b.title = `${names[i]}: ${fmtDur(cur[i]) === '—' ? '0 min' : fmtDur(cur[i])} (last week ${fmtDur(last[i]) === '—' ? '0 min' : fmtDur(last[i])})`;
    });
    if (first && motionOK()) {
      els.bars.querySelectorAll('.bar-col').forEach((c, i) =>
        c.animate([{ transform: 'scaleY(.04)' }, { transform: 'scaleY(1)' }], { duration: 700, delay: 250 + i * 45, easing: EASE.out, fill: 'backwards' }),
      );
    }
    const total = state.stats.total || 0;
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    els.insTotal.innerHTML = hrs ? `${hrs}h<em> ${mins}m</em>` : `${mins}<em>m</em>`;
  }

  /* ── library ── */
  let libFilter = 'all';
  function renderLibrary() {
    animateList(els.libList, paintLibrary);
  }
  function paintLibrary() {
    const list = query({ sort: 'played', filter: libFilter });
    setText(els.libCount, state.tracks.length);
    if (!list.length) {
      els.libList.innerHTML = `<div class="lib-empty" data-id="empty-${libFilter === 'all' ? 'all' : 'some'}"><span>${libFilter === 'all' ? 'Your saved audio shows up here.' : 'Nothing in here yet.'}</span><span class="dim">${libFilter === 'all' ? 'Paste a YouTube or X link above.' : ''}</span></div>`;
      return;
    }
    els.libList.innerHTML = list
      .slice(0, 60)
      .map(
        (t) => `
        <div class="lrow ${player.P.id === t.id ? 'is-current' : ''}" data-id="${t.id}" role="button" tabindex="0">
          <span class="lr-g">${glyph(t)}</span>
          <span class="lr-title">${esc(t.title)}</span>
          ${t.favorite ? `<span class="lr-fav">${icon('star-fill')}</span>` : ''}
          <span class="lr-time">${timeLabel(t)}</span>
        </div>`,
      )
      .join('');
  }
  function libIds() {
    return query({ sort: 'played', filter: libFilter }).map((t) => t.id);
  }
  els.libList.addEventListener('click', (e) => {
    const row = e.target.closest('.lrow');
    if (!row) return;
    player.playFrom(row.dataset.id, libIds(), libFilter === 'all' ? 'Recent' : getPlaylist(libFilter.slice(3))?.name || 'Library');
  });
  els.libList.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.target.closest('.lrow')?.click();
  });
  els.libList.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.lrow');
    if (!row) return;
    e.preventDefault();
    const t = state.byId.get(row.dataset.id);
    if (t) trackMenu(row, t);
  });
  longPress(els.libList, '.lrow', (row) => {
    const t = state.byId.get(row.dataset.id);
    if (t) trackMenu(row, t);
  });
  $('#libOpen', root).addEventListener('click', () => openView('library', {}, $('#libTile', root)));

  let chipSig = '';
  function renderChips() {
    const chips = [{ id: 'all', name: 'Recent' }, { id: 'fav', name: 'Favourites' }, ...state.playlists.map((p) => ({ id: `pl:${p.id}`, name: p.name, color: p.color }))];
    if (!chips.some((c) => c.id === libFilter)) libFilter = 'all';
    const sig = chips.map((c) => `${c.id}|${c.name}|${c.color}`).join('\n');
    if (sig === chipSig) {
      els.libChips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.f === libFilter));
      return;
    }
    chipSig = sig;
    animateList(els.libChips, () => paintChips(chips), { selector: '.chip', key: (e) => e.dataset.f, y: 0 });
  }
  function paintChips(chips) {
    els.libChips.innerHTML = chips
      .map(
        (c) =>
          `<button type="button" class="chip sm press ${libFilter === c.id ? 'on' : ''}" data-f="${c.id}">${c.color !== undefined ? `<i class="sw" style="--sw:${SWATCHES[c.color % SWATCHES.length].bg}"></i>` : ''}${esc(c.name)}</button>`,
      )
      .join('');
  }
  els.libChips.addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c || c.dataset.f === libFilter) return;
    libFilter = c.dataset.f;
    renderChips();
    renderLibrary();
  });

  /* ── playlists stack ── */
  function renderLists() {
    const totalSec = state.tracks.reduce((n, t) => n + (t.duration || 0), 0);
    const hh = Math.floor(totalSec / 3600);
    const mm = Math.floor((totalSec % 3600) / 60);
    els.listsTotal.innerHTML = `${hh}<em>h</em> ${String(mm).padStart(2, '0')}<em>m</em>`;
    const favs = state.tracks.filter((t) => t.favorite).length;
    const cards = [
      { id: 'fav', name: 'Favourites', sub: 'Starred', n: favs, tone: 'c-mid' },
      ...state.playlists
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((p) => {
          const tr = playlistTracks(p.id);
          const done = tr.filter((t) => t.finished).length;
          return { id: `pl:${p.id}`, name: p.name, sub: `${tr.length} audio${tr.length === 1 ? '' : 's'}`, n: tr.length, color: p.color, pct: tr.length ? done / tr.length : 0 };
        }),
    ];
    const paint = () =>
      (els.stack.innerHTML =
      cards
        .map((c, i) => {
          const last = i === cards.length - 1 && i > 0;
          const sw = c.color !== undefined ? SWATCHES[c.color % SWATCHES.length] : null;
          return `<button type="button" class="scard press ${last ? 'c-last' : i % 2 ? 'c-hi' : 'c-mid'}" data-f="${c.id}" ${sw ? `style="--sw:${sw.bg}"` : ''}>
            <span class="sc-name">${sw ? '<i class="sw"></i>' : ''}${esc(c.name)}</span>
            <span class="sc-sub">${esc(c.sub)}${last ? ' · finished' : ''}</span>
            <span class="sc-num">${last ? `<small>%</small>${Math.round((c.pct || 0) * 100)}` : c.n}</span>
            ${last ? `<span class="sc-bar"><i style="transform:scaleX(${c.pct || 0})"></i></span>` : ''}
          </button>`;
        })
        .join('') + `<button type="button" class="scard c-new press" data-new="1" data-f="+new">${icon('plus')}<span>New playlist</span></button>`);
    animateList(els.stack, paint, { selector: '.scard', key: (e) => e.dataset.f, y: 10 });
  }
  els.stack.addEventListener('click', async (e) => {
    const c = e.target.closest('.scard');
    if (!c) return;
    if (c.dataset.new) return newPlaylist();
    openView('library', { filter: c.dataset.f }, c);
  });
  async function newPlaylist() {
    const name = await prompt({ title: 'New playlist', placeholder: 'e.g. Podcasts, Learning, Sleep', ok: 'Create' });
    if (!name) return;
    const p = await createPlaylist(name);
    toast(`Created ${p.name}`, { icon: 'folder', duration: 1800 });
  }
  $('#newList', root).addEventListener('click', newPlaylist);

  /* ── sections: the bottom row on phones, a tile on wide screens ── */
  const onNav = (e) => {
    const b = e.target.closest('[data-go]');
    if (b) go(b);
  };
  root.querySelector('.t-quick').addEventListener('click', onNav);
  tabbar.addEventListener('click', onNav);
  on('view', ({ tab }) => {
    document.querySelectorAll('[data-go]').forEach((b) => {
      b.classList.toggle('on', b.dataset.go === tab);
      b.setAttribute('aria-current', b.dataset.go === tab ? 'page' : 'false');
    });
  });

  /* ── donut: finished share, or the sleep timer when it's running ── */
  const C = 2 * Math.PI * 41;
  function renderDonut() {
    const sl = player.P.sleep;
    let frac;
    let val;
    let cap;
    if (sl.mode === 'time') {
      const left = player.sleepLeft();
      frac = sl.total ? left / sl.total : 0;
      val = `${Math.ceil(left / 60000)}m`;
      cap = 'sleep';
    } else if (sl.mode === 'end') {
      frac = 1 - progressOf(player.current());
      val = 'end';
      cap = 'sleep';
    } else {
      const n = state.tracks.filter((t) => t.finished).length;
      const d = state.tracks.length;
      frac = d ? n / d : 0;
      val = prettyFraction(n, d);
      cap = 'finished';
    }
    els.dnSeg.style.strokeDasharray = `${(C * frac).toFixed(1)} ${C.toFixed(1)}`;
    setText(els.dnVal, val);
    els.dnVal.classList.toggle('long', val.length > 3);
    setText(els.dnCap, cap);
    els.donut.dataset.mode = sl.mode;
  }
  els.donut.addEventListener('click', () => {
    if (player.P.id) import('./player-ui.js').then((m) => m.openSleep(els.donut));
    else openView('library', { filter: 'done' }, els.donut);
  });

  /* ── live updates ── */
  const markPlaying = () => {
    els.libList.querySelectorAll('.lrow').forEach((row) => {
      const t = state.byId.get(row.dataset.id);
      if (!t) return;
      row.classList.toggle('is-current', player.P.id === t.id);
      setHTML(row.querySelector('.lr-g'), glyph(t));
    });
  };
  const tick = throttle(() => {
    renderContinue();
    const row = player.P.id && els.libList.querySelector(`.lrow[data-id="${player.P.id}"]`);
    if (row) {
      const t = player.current();
      row.querySelector('.lr-time').textContent = timeLabel(t);
    }
  }, 1000);

  on('jobs', renderJobs);
  on('server', renderServer);
  on('tracks', () => {
    renderLibrary();
    renderContinue();
    renderLists();
    renderDonut();
  });
  on('fav', renderLibrary);
  on('playlists', () => {
    renderLists();
    renderChips();
    renderLibrary();
  });
  on('player:load', () => {
    renderContinue();
    markPlaying();
  });
  on('player:state', () => {
    renderContinue();
    markPlaying();
  });
  on('player:time', tick);
  on('stats', renderInsights);
  on('player:sleep', renderDonut);
  on('player:sleep-tick', throttle(renderDonut, 5000));

  updateSrc();
  renderJobs();
  renderServer();
  renderContinue();
  renderInsights();
  renderChips();
  renderLibrary();
  renderLists();
  renderDonut();

  // First paint: tiles settle in one after another.
  stagger(root.querySelectorAll('.bento > .tile, .bento > .t-quick > *'), { y: 14, step: 50, duration: 560, scale: 0.98 });
  stagger(tabbar.children, { y: 16, step: 45, delay: 260, duration: 520 });
  stagger(els.libList.querySelectorAll('.lrow'), { y: 8, step: 28, delay: 320 });
  stagger(els.stack.querySelectorAll('.scard'), { y: 12, step: 50, delay: 300 });

  return { focusInput: () => els.input.focus() };
}

/** Long-press on touch to open a context menu (no text selection, no callout). */
export function longPress(root, selector, fn, ms = 480) {
  let timer = null;
  let start = null;
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    const el = e.target.closest(selector);
    if (!el) return;
    start = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => {
      timer = null;
      haptic(12);
      el.classList.add('held');
      setTimeout(() => el.classList.remove('held'), 300);
      const swallow = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      el.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 600);
      fn(el);
    }, ms);
  });
  const cancel = (e) => {
    if (!timer) return;
    if (e.type === 'pointermove' && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8) return;
    clearTimeout(timer);
    timer = null;
  };
  root.addEventListener('pointermove', cancel);
  root.addEventListener('pointerup', cancel);
  root.addEventListener('pointercancel', cancel);
}
