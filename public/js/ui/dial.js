// Rotary sleep dial (the clock-face tile from the reference). Drag to turn, it
// snaps with a little overshoot; the value under the ◀ pointer is the choice.
import { h, haptic } from '../util.js';
import { Roller, EASE } from '../anim.js';

const STEP = 30; // degrees between labels
const VALUES = Array.from({ length: 12 }, (_, i) => (i === 0 ? 60 : i * 5)); // index 0 sits at 12 o'clock

export function createDial({ value = 15, onChange } = {}) {
  const el = h(`
    <div class="dial" tabindex="0" role="slider" aria-label="Sleep timer minutes" aria-valuemin="5" aria-valuemax="60">
      <div class="dial-face">
        ${VALUES.map((v, i) => `<button type="button" class="dial-n" data-i="${i}" style="--a:${i * STEP}deg" tabindex="-1" aria-label="${v} minutes"><span>${v}</span></button>`).join('')}
      </div>
      <i class="dial-pointer" aria-hidden="true"></i>
      <div class="dial-center"><span class="dial-val">${value}</span><span class="dial-unit">min</span></div>
    </div>`);

  const face = el.querySelector('.dial-face');
  const roller = new Roller(el.querySelector('.dial-val'));
  let rot = 0;
  let idx = 0;

  const indexFor = (r) => (((Math.round((90 - r) / STEP) % 12) + 12) % 12);
  const render = (animate) => {
    face.style.transition = animate ? `transform 520ms ${EASE.pop}` : 'none';
    face.style.transform = `rotate(${rot}deg)`;
    face.style.setProperty('--counter', `${-rot}deg`);
  };
  const update = (fromUser) => {
    const i = indexFor(rot);
    if (i !== idx) {
      const dir = VALUES[i] > VALUES[idx] ? 1 : -1;
      idx = i;
      roller.set(String(VALUES[i]), { dir });
      el.setAttribute('aria-valuenow', VALUES[i]);
      el.querySelectorAll('.dial-n').forEach((n, k) => n.classList.toggle('sel', k === i));
      if (fromUser) haptic(4);
      onChange?.(VALUES[i]);
    }
  };
  const goTo = (v, animate = true) => {
    const i = Math.max(0, VALUES.indexOf(v));
    const target = 90 - i * STEP;
    // shortest path from current rotation
    let d = (((target - rot) % 360) + 540) % 360 - 180;
    rot += d;
    render(animate);
    update(animate);
  };

  // drag to rotate
  let pid = null;
  let a0 = 0;
  let r0 = 0;
  let moved = false;
  const angle = (e) => {
    const r = el.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  };
  el.addEventListener('pointerdown', (e) => {
    if (pid !== null) return;
    pid = e.pointerId;
    a0 = angle(e);
    r0 = rot;
    moved = false;
    el.setPointerCapture(pid);
    el.classList.add('turning');
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    let d = angle(e) - a0;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    if (Math.abs(d) > 2) moved = true;
    if (!moved) return;
    rot = r0 + d;
    // keep a0 close so long spins accumulate cleanly
    a0 = angle(e);
    r0 = rot;
    render(false);
    update(true);
  });
  const end = (e) => {
    if (e.pointerId !== pid) return;
    pid = null;
    el.classList.remove('turning');
    if (!moved) {
      const n = e.target.closest('.dial-n');
      if (n) goTo(VALUES[+n.dataset.i]);
      return;
    }
    rot = Math.round(rot / STEP) * STEP;
    render(true);
    update(true);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    rot += e.deltaY > 0 ? -STEP : STEP;
    render(true);
    update(true);
  }, { passive: false });
  el.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowRight'].includes(e.key)) rot -= STEP;
    else if (['ArrowDown', 'ArrowLeft'].includes(e.key)) rot += STEP;
    else return;
    e.preventDefault();
    render(false);
    update(true);
  });

  idx = -1;
  goTo(VALUES.includes(value) ? value : 15, false);
  return { el, get value() { return VALUES[idx]; }, set: (v) => goTo(v) };
}
