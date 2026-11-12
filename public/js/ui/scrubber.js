// Seek bar with coloured bookmark ticks and a time bubble while dragging.
import { h, clamp, fmtTime, esc } from '../util.js';
import { animateList } from '../anim.js';

export function createScrubber({ onSeek, onScrub, onMark } = {}) {
  const el = h(`
    <div class="scrub" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0">
      <div class="scrub-marks"></div>
      <div class="scrub-rail"><i class="scrub-fill"></i></div>
      <i class="scrub-thumb"></i>
      <span class="scrub-tip">0:00</span>
    </div>`);
  const fill = el.querySelector('.scrub-fill');
  const thumb = el.querySelector('.scrub-thumb');
  const tip = el.querySelector('.scrub-tip');
  const marksEl = el.querySelector('.scrub-marks');

  let width = 0;
  let frac = 0;
  let dur = 0;
  let dragging = false;
  let pid = null;

  new ResizeObserver(() => {
    width = el.clientWidth;
    paint();
  }).observe(el);

  function paint() {
    fill.style.transform = `scaleX(${frac})`;
    thumb.style.transform = `translateX(${frac * width}px)`;
    if (dragging) {
      tip.textContent = fmtTime(frac * dur);
      const tw = tip.offsetWidth;
      tip.style.transform = `translateX(${clamp(frac * width - tw / 2, 0, width - tw)}px)`;
    }
  }
  const fracAt = (e) => clamp((e.clientX - el.getBoundingClientRect().left) / (width || 1), 0, 1);

  el.addEventListener('pointerdown', (e) => {
    if (pid !== null || !dur) return;
    if (e.target.closest('.mk-tick')) return;
    pid = e.pointerId;
    el.setPointerCapture(pid);
    dragging = true;
    el.classList.add('dragging');
    frac = fracAt(e);
    paint();
    onScrub?.(frac * dur);
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    frac = fracAt(e);
    paint();
    onScrub?.(frac * dur);
  });
  const end = (e) => {
    if (e.pointerId !== pid) return;
    pid = null;
    dragging = false;
    el.classList.remove('dragging');
    onSeek?.(frac * dur);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 30 : 5;
    let t = frac * dur;
    if (e.key === 'ArrowRight') t += step;
    else if (e.key === 'ArrowLeft') t -= step;
    else if (e.key === 'Home') t = 0;
    else if (e.key === 'End') t = dur - 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    onSeek?.(clamp(t, 0, dur));
  });
  marksEl.addEventListener('click', (e) => {
    const tick = e.target.closest('.mk-tick');
    if (tick) onMark?.(Number(tick.dataset.t));
  });

  return {
    el,
    get dragging() {
      return dragging;
    },
    set(time, duration) {
      dur = duration || 0;
      if (dragging) return;
      frac = dur ? clamp(time / dur, 0, 1) : 0;
      el.setAttribute('aria-valuemax', Math.round(dur));
      el.setAttribute('aria-valuenow', Math.round(time));
      el.setAttribute('aria-valuetext', `${fmtTime(time)} of ${fmtTime(dur)}`);
      paint();
    },
    marks(list, duration, freshId) {
      dur = duration || dur;
      const html = (list || [])
        .filter(() => dur)
        .map(
          (m) =>
            `<button type="button" class="mk-tick" data-id="${m.id}" data-t="${m.t}" style="left:${(m.t / dur) * 100}%;--c:${m.color}" aria-label="${esc(m.name)} at ${fmtTime(m.t)}" title="${esc(m.name)} · ${fmtTime(m.t)}"></button>`,
        )
        .join('');
      if (marksEl.dataset.sig === html) return;
      marksEl.dataset.sig = html;
      animateList(marksEl, () => (marksEl.innerHTML = html), { selector: '.mk-tick', y: -12 });
    },
  };
}
