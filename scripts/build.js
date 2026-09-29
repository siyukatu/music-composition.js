'use strict';
// Builds site/ for deployment (Cloudflare Pages runs `npm run build`):
// copies the library next to the page, minifies the site's scripts (on
// Cloudflare, or with --minify), and stamps every local script URL in
// site/*.html with ?h=<first 6 hex chars of its SHA-256>, so browsers and
// caches fetch the new file after each deploy instead of a stale one.
//
//   npm run build                               (local: readable scripts)
//   node scripts/build.js --minify --out dist   (what the site gets, into dist/)
//
// Minifying rewrites the files in place, so locally it only runs into a
// separate --out directory; the sources in site/ stay as written.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const OUT = outArg >= 0 ? path.resolve(args[outArg + 1]) : path.join(ROOT, 'site');
const MINIFY = args.includes('--minify') || process.env.CF_PAGES === '1';

if (MINIFY && OUT === path.join(ROOT, 'site') && process.env.CF_PAGES !== '1') {
  console.error('Refusing to minify the sources in site/ (use --out <dir>).');
  process.exit(1);
}
if (OUT !== path.join(ROOT, 'site')) fs.cpSync(path.join(ROOT, 'site'), OUT, { recursive: true });

fs.copyFileSync(path.join(ROOT, 'music-composition.js'), path.join(OUT, 'music-composition.js'));

const hashOf = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 6);

async function minify() {
  const { minify } = require('terser');
  for (const name of fs.readdirSync(OUT).filter((f) => f.endsWith('.js'))) {
    const file = path.join(OUT, name);
    const src = fs.readFileSync(file, 'utf8');
    // Keep the licence/header comment of the library; drop the rest.
    const res = await minify(src, {
      compress: { passes: 2 },
      mangle: true,
      format: { comments: /^!|@license|@preserve/ }
    });
    fs.writeFileSync(file, res.code);
    console.log('minified ' + name + ': ' + src.length + ' -> ' + res.code.length + ' bytes');
  }
}

function stamp() {
  for (const page of fs.readdirSync(OUT).filter((f) => f.endsWith('.html'))) {
    const file = path.join(OUT, page);
    const html = fs.readFileSync(file, 'utf8');
    // src="name.js" or src="name.js?h=abc123" (relative, same directory)
    const out = html.replace(/(<script\b[^>]*\bsrc=")([\w.-]+\.js)(?:\?h=[0-9a-f]*)?(")/g, (m, pre, name, post) => {
      const target = path.join(OUT, name);
      if (!fs.existsSync(target)) return m;
      return pre + name + '?h=' + hashOf(target) + post;
    });
    if (out !== html) {
      fs.writeFileSync(file, out);
      console.log('stamped ' + page);
    }
  }
}

(MINIFY ? minify() : Promise.resolve()).then(stamp).catch((err) => {
  console.error(err);
  process.exit(1);
});
