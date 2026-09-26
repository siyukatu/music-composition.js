'use strict';
// Builds site/ for deployment (Cloudflare Pages runs `npm run build`):
// copies the library next to the page and stamps every local script URL in
// site/*.html with ?h=<first 6 hex chars of its SHA-256>, so browsers and
// caches fetch the new file after each deploy instead of a stale one.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'site');

fs.copyFileSync(path.join(ROOT, 'music-composition.js'), path.join(SITE, 'music-composition.js'));

const hashOf = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 6);

for (const page of fs.readdirSync(SITE).filter((f) => f.endsWith('.html'))) {
  const file = path.join(SITE, page);
  const html = fs.readFileSync(file, 'utf8');
  // src="name.js" or src="name.js?h=abc123" (relative, same directory)
  const out = html.replace(/(<script\b[^>]*\bsrc=")([\w.-]+\.js)(?:\?h=[0-9a-f]*)?(")/g, (m, pre, name, post) => {
    const target = path.join(SITE, name);
    if (!fs.existsSync(target)) return m;
    return pre + name + '?h=' + hashOf(target) + post;
  });
  if (out !== html) {
    fs.writeFileSync(file, out);
    console.log('stamped ' + page);
  }
}
