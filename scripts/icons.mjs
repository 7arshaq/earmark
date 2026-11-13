// Renders the app icons (PNG) from SVG with resvg. Run: npm run icons
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'icons');
fs.mkdirSync(out, { recursive: true });

// A record on the ink frame, in the Vintage Charm palette: slate disc with fine grooves,
// a burnt-orange label, a wheat tone-arm resting on it.
const C = { ink: '#04151f', slate: '#183a37', groove: '#efd6ac', label: '#c44900', wheat: '#efd6ac', violet: '#432534' };

function icon({ size = 512, bleed = false, square = false }) {
  const r = bleed ? 150 : 178; // maskable icons keep everything inside the central 80%
  const cx = bleed ? 246 : 240;
  const cy = bleed ? 266 : 272;
  const rings = Array.from({ length: 7 }, (_, i) => r * (0.5 + i * 0.07))
    .map((rr, i) => `<circle cx="${cx}" cy="${cy}" r="${rr.toFixed(1)}" fill="none" stroke="${C.groove}" stroke-opacity="${(0.1 + (i % 2) * 0.06).toFixed(2)}" stroke-width="${bleed ? 3 : 3.5}"/>`)
    .join('');
  const k = r / 178; // tone-arm scales with the disc
  const ax = cx + 150 * k;
  const ay = cy - 168 * k;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
    <rect width="512" height="512" rx="${bleed || square ? 0 : 112}" fill="${C.ink}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.slate}"/>
    ${rings}
    <path d="M${cx} ${cy} L${cx + r * Math.cos(-1.15)} ${cy + r * Math.sin(-1.15)} A${r} ${r} 0 0 1 ${cx + r * Math.cos(-0.55)} ${cy + r * Math.sin(-0.55)} Z" fill="${C.wheat}" fill-opacity="0.07"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.36}" fill="${C.label}"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.36}" fill="none" stroke="${C.ink}" stroke-opacity="0.25" stroke-width="4"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.075}" fill="${C.ink}"/>
    <circle cx="${ax}" cy="${ay}" r="${24 * k}" fill="${C.wheat}"/>
    <circle cx="${ax}" cy="${ay}" r="${9 * k}" fill="${C.ink}"/>
    <path d="M${ax} ${ay} L${ax + 4 * k} ${ay + 150 * k} L${cx + 58 * k} ${cy + 22 * k}" fill="none" stroke="${C.wheat}" stroke-width="${15 * k}" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="${cx + 34 * k}" y="${cy + 6 * k}" width="${38 * k}" height="${26 * k}" rx="${6 * k}" transform="rotate(-38 ${cx + 53 * k} ${cy + 19 * k})" fill="${C.wheat}"/>
  </svg>`;
}

const jobs = [
  ['icon-512.png', icon({ size: 512 })],
  ['icon-192.png', icon({ size: 192 })],
  ['maskable-512.png', icon({ size: 512, bleed: true })],
  ['apple-touch-icon.png', icon({ size: 180, square: true })],
];
for (const [name, svg] of jobs) {
  const size = Number(svg.match(/width="(\d+)"/)[1]);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  fs.writeFileSync(path.join(out, name), png);
  console.log(`✓ ${name} (${png.length} bytes)`);
}
fs.writeFileSync(path.join(out, 'icon.svg'), icon({ size: 512 }).replace(/width="512" height="512" /, ''));
console.log('✓ icon.svg');
