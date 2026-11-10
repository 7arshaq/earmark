// Lock-screen / notification artwork, drawn on the fly in the app's bento style.
// It only exists for the phone's system player; inside the app there's no album art.
import { SWATCHES } from './store.js';

const cache = new Map();
const TULIP = ['M50 116V18', 'M9 58C29 50 44 36 50 11', 'M91 58C71 50 56 36 50 11'];

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function wrap(g, text, maxW, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width <= maxW) line = test;
    else {
      if (line) lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.slice(0, maxLines);
}

export function artworkFor(t) {
  const sw = SWATCHES[(t.color || 0) % SWATCHES.length];
  const key = `${t.id}|${t.title}|${sw.key}`;
  if (cache.has(key)) return cache.get(key);

  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');

  g.fillStyle = '#232323';
  g.fillRect(0, 0, S, S);
  rr(g, 22, 22, S - 44, S - 44, 28);
  g.fillStyle = sw.bg;
  g.fill();

  // progress-bar motif from the "winning investors" tile
  rr(g, 52, 410, S - 104, 50, 9);
  g.fillStyle = sw.dim;
  g.fill();
  rr(g, 52, 410, (S - 104) * 0.62, 50, 9);
  g.fillStyle = sw.ink;
  g.fill();

  // tulip arrow
  g.save();
  g.translate(352, 54);
  g.scale(1.05, 1.05);
  g.strokeStyle = sw.ink;
  g.globalAlpha = 0.85;
  g.lineWidth = 12;
  g.lineCap = 'butt';
  TULIP.forEach((d) => g.stroke(new Path2D(d)));
  g.restore();

  g.fillStyle = sw.ink;
  g.globalAlpha = 0.62;
  g.font = '600 24px Onest, system-ui, sans-serif';
  g.beginPath();
  g.arc(60, 76, 8, 0, Math.PI * 2);
  g.fill();
  g.fillText('Earmark', 78, 85);

  g.globalAlpha = 1;
  g.font = '700 50px Onest, system-ui, sans-serif';
  const lines = wrap(g, t.title || 'Audio', S - 110, 3);
  const lh = 54;
  let y = 382 - (lines.length - 1) * lh;
  for (const l of lines) {
    g.fillText(l, 52, y);
    y += lh;
  }

  const url = c.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
