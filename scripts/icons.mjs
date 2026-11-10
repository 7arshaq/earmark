// Renders the app icons (PNG) from SVG with resvg. Run: npm run icons
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'icons');
fs.mkdirSync(out, { recursive: true });

// Tulip arrow (pointing down = "keep the audio") on an orange tile, set on the charcoal frame.
const arrow = (x, y, s, color) =>
  `<g transform="translate(${x} ${y}) scale(${s}) rotate(180 50 60)" fill="none" stroke="${color}" stroke-width="13" stroke-linecap="butt">
     <path d="M50 116V18"/><path d="M9 58C29 50 44 36 50 11"/><path d="M91 58C71 50 56 36 50 11"/></g>`;

function icon({ size = 512, bleed = false }) {
  const pad = bleed ? 0 : 0;
  const frameR = bleed ? 0 : 112;
  // inner tile geometry (safe zone for maskable icons is the central 80%)
  const t = bleed ? 96 : 56;
  const tile = 512 - t * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
    <rect x="${pad}" y="${pad}" width="512" height="512" rx="${frameR}" fill="#232323"/>
    <rect x="${t}" y="${t}" width="${tile}" height="${tile}" rx="${bleed ? 44 : 56}" fill="#f5841f"/>
    <rect x="${t + tile * 0.12}" y="${t + tile * 0.76}" width="${tile * 0.76}" height="${tile * 0.11}" rx="10" fill="#c9640f"/>
    <rect x="${t + tile * 0.12}" y="${t + tile * 0.76}" width="${tile * 0.46}" height="${tile * 0.11}" rx="10" fill="#0e0e0e"/>
    ${arrow(256 - (tile * 0.5) / 2, t + tile * 0.1, (tile * 0.5) / 100, '#0e0e0e')}
  </svg>`;
}

const jobs = [
  ['icon-512.png', icon({ size: 512 })],
  ['icon-192.png', icon({ size: 192 })],
  ['maskable-512.png', icon({ size: 512, bleed: true })],
  ['apple-touch-icon.png', icon({ size: 180, bleed: true })],
];
for (const [name, svg] of jobs) {
  const size = Number(svg.match(/width="(\d+)"/)[1]);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  fs.writeFileSync(path.join(out, name), png);
  console.log(`✓ ${name} (${png.length} bytes)`);
}
fs.writeFileSync(path.join(out, 'icon.svg'), icon({ size: 512 }).replace(/width="512" height="512" /, ''));
console.log('✓ icon.svg');
