'use strict';
// Generates the social preview image and icons for site/.
// Needs rsvg-convert (brew install librsvg) and Python 3 with Pillow for favicon.ico.
//   node scripts/make-images.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const MusicComposition = require('..');

const SITE = path.join(__dirname, '..', 'site');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mc-images-'));

const C = {
  ground: '#111216', surface: '#1A1C21', line: '#2C3038', ink: '#ECEEF2', muted: '#969CA8',
  lead: '#FF6A33', bass: '#5B8BFF', chords: '#2EC4A0', arp: '#C07BF0', drums: '#6C727E'
};

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

// A real song drawn as a piano roll.
function roll(song, x0, y0, w, h) {
  const total = song.loop ? song.loopEnd : song.bars * song.barDuration;
  const pitched = song.notes.filter(n => n.inst !== 'drums' && n.t < total);
  let lo = 127, hi = 0;
  pitched.forEach(n => { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); });
  lo -= 1; hi += 1;
  const drumH = 34;
  const rowH = (h - drumH - 8) / (hi - lo + 1);
  const X = t => x0 + (t / total) * w;
  const Y = m => y0 + (h - drumH - 8) - (m - lo + 1) * rowH;
  const order = { chords: 0, bass: 1, arp: 2, lead: 3 };
  let out = '';
  for (let b = 1; b < song.bars; b++) {
    const bx = X(b * song.barDuration).toFixed(1);
    out += `<line x1="${bx}" y1="${y0}" x2="${bx}" y2="${y0 + h - drumH}" stroke="${C.line}" stroke-width="1"/>`;
  }
  pitched.sort((a, b) => order[a.inst] - order[b.inst]).forEach(n => {
    const op = n.inst === 'chords' ? 0.5 : n.inst === 'arp' ? 0.75 : 1;
    const wd = Math.max(2, X(Math.min(n.d, total - n.t)) - X(0) - 1);
    out += `<rect x="${X(n.t).toFixed(1)}" y="${Y(n.midi).toFixed(1)}" width="${wd.toFixed(1)}" height="${Math.max(2, rowH - 1).toFixed(1)}" fill="${C[n.inst]}" fill-opacity="${op}"/>`;
  });
  const rows = { kick: 2, snare: 1, clap: 1, hat: 0, open: 0, crash: 0 };
  song.notes.forEach(n => {
    if (n.inst !== 'drums' || n.t >= total) return;
    out += `<rect x="${X(n.t).toFixed(1)}" y="${(y0 + h - drumH + 4 + rows[n.drum] * 10).toFixed(1)}" width="2" height="7" fill="${C.drums}" fill-opacity="${(0.35 + 0.65 * n.vel).toFixed(2)}"/>`;
  });
  return out;
}

function ogSvg() {
  const song = MusicComposition.compose({ seed: 'mcj-og', style: 'pop', bars: 16, loop: true });
  const W = 1200, H = 630;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${C.ground}"/>
  <text x="72" y="140" font-family="Hiragino Sans" font-weight="900" font-size="76" fill="${C.ink}">music-composition<tspan fill="${C.lead}">.js</tspan></text>
  <text x="74" y="206" font-family="Hiragino Sans" font-weight="600" font-size="34" fill="${C.muted}">シードから作曲して WAV を書き出す。すべてブラウザの中で。</text>
  <rect x="72" y="262" width="1056" height="296" rx="14" fill="${C.surface}" stroke="${C.line}"/>
  ${roll(song, 96, 282, 1008, 256)}
  <text x="74" y="600" font-family="Menlo" font-size="22" fill="${C.muted}">${esc('npm install music-composition.js')}</text>
  <text x="1128" y="600" text-anchor="end" font-family="Menlo" font-size="22" fill="${C.muted}">mcj.siyukatu.me</text>
</svg>`;
}

// Icon: a small piano roll on the brand orange.
function iconSvg(size) {
  const notes = [[5, 19, 7], [13, 13, 6], [20, 8, 7], [12, 23, 14]];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="${C.lead}"/>
  ${notes.map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="4" rx="1.2" fill="#1A0B04"/>`).join('')}
</svg>`;
}

function png(svg, out, width) {
  const src = path.join(TMP, path.basename(out) + '.svg');
  fs.writeFileSync(src, svg);
  execFileSync('rsvg-convert', ['-w', String(width), '-o', out, src]);
}

png(ogSvg(), path.join(SITE, 'og.png'), 1200);
fs.writeFileSync(path.join(SITE, 'favicon.svg'), iconSvg(32));
png(iconSvg(180), path.join(SITE, 'apple-touch-icon.png'), 180);
const ico32 = path.join(TMP, 'icon32.png');
png(iconSvg(64), ico32, 64);
execFileSync('python3', ['-c',
  'import sys; from PIL import Image; Image.open(sys.argv[1]).save(sys.argv[2], sizes=[(16,16),(32,32),(48,48)])',
  ico32, path.join(SITE, 'favicon.ico')]);
console.log('wrote og.png, favicon.svg, apple-touch-icon.png, favicon.ico');
