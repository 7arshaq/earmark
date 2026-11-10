// Downloads the official standalone yt-dlp binary (no Python needed) into ./bin
// Source: https://github.com/yt-dlp/yt-dlp/releases (official project releases)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binDir = path.join(root, 'bin');
fs.mkdirSync(binDir, { recursive: true });

const assets = {
  win32: { x64: 'yt-dlp.exe', arm64: 'yt-dlp_arm64.exe', ia32: 'yt-dlp_x86.exe' },
  darwin: { x64: 'yt-dlp_macos', arm64: 'yt-dlp_macos' },
  linux: { x64: 'yt-dlp_linux', arm64: 'yt-dlp_linux_aarch64', arm: 'yt-dlp_linux_armv7l' },
};

const asset = assets[process.platform]?.[process.arch];
if (!asset) {
  console.error(`No prebuilt yt-dlp for ${process.platform}/${process.arch}. Install yt-dlp yourself and set YTDLP_PATH.`);
  process.exit(1);
}

const target = path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;

console.log(`↓ ${url}`);
const res = await fetch(url, { redirect: 'follow' });
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status}`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
fs.writeFileSync(target, buf);
if (process.platform !== 'win32') fs.chmodSync(target, 0o755);

const version = execFileSync(target, ['--version']).toString().trim();
console.log(`✓ yt-dlp ${version} → ${path.relative(root, target)} (${(buf.length / 1048576).toFixed(1)} MB)`);
