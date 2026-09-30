/*
 * Music video export for the demo page: draws the song as it plays (a scrolling
 * piano roll, the chord strip, the section and the beat) and encodes it with the
 * song's audio into an MP4. It looks like the site: its colours (light or dark,
 * as the page is shown), thin lines, square corners and one red-orange accent.
 *
 *   MCVideo.render(song, wavArrayBuffer, { aspect: '16:9' | '1:1' | '9:16', onProgress, signal }) -> Promise<Blob>
 *
 * With WebCodecs it encodes faster than real time using Mediabunny (loaded from
 * jsDelivr on first use). Without it, it records in real time with MediaRecorder.
 */
(function () {
  'use strict';

  var MEDIABUNNY = 'https://cdn.jsdelivr.net/npm/mediabunny@1.60.0/dist/bundles/mediabunny.min.mjs';
  var FPS = 30;
  var SIZES = { '16:9': [1280, 720], '1:1': [1080, 1080], '9:16': [720, 1280] };
  // The site's tokens, with its dark theme as the fallback.
  var TOKENS = {
    ground: ['--roll-bg', '#0E0F12'], band: ['--roll-band', '#141519'], grid: ['--roll-grid', '#202227'], line: ['--line', '#2A2C32'],
    ink: ['--ink', '#F2F2F2'], muted: ['--muted', '#9B9B9B'], accent: ['--accent', '#FF6A3D'], accentInk: ['--accent-ink', '#1A0904'],
    lead: ['--lead', '#FF6A3D'], bass: ['--bass', '#4FB0E8'], chords: ['--chords', '#3F7268'], guitar: ['--guitar', '#E0A640'],
    arp: ['--arp', '#C07BF0'], drums: ['--drums', '#6C6C6C']
  };
  var SECTION = { intro: 'INTRO', A: 'VERSE', P: 'PRE-CHORUS', B: 'CHORUS', C: 'BRIDGE', outro: 'OUTRO' };
  var SECTION_COLOR = { intro: 'muted', A: 'bass', P: 'arp', B: 'accent', C: 'chords', outro: 'muted' };
  var STYLE = { pop: 'Pop', jpop: 'J-POP', dance: 'Dance', lofi: 'Lo-fi', chiptune: 'Chiptune', ambient: 'Ambient', jazz: 'Jazz', bossa: 'Bossa Nova' };
  var ALPHA = { chords: 0.45, guitar: 0.55, arp: 0.7, bass: 0.95, lead: 0.95 };
  var DRUM_ROW = { kick: 2, snare: 1, clap: 1, hat: 0, pedal: 0, open: 0, crash: 0 };

  // cubic-bezier(x1, y1, x2, y2) as a function of time (0..1), like CSS.
  function bezier(x1, y1, x2, y2) {
    function at(a, b, s) { return 3 * a * s * (1 - s) * (1 - s) + 3 * b * s * s * (1 - s) + s * s * s; }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var lo = 0, hi = 1, s = x;
      for (var i = 0; i < 24; i++) { s = (lo + hi) / 2; if (at(x1, x2, s) < x) lo = s; else hi = s; }
      return at(y1, y2, s);
    };
  }
  var EASE = bezier(0.76, 0, 0.24, 1);     // --ease
  var EASE_WIPE = bezier(0.85, 0, 0.15, 1); // --ease-wipe
  var STRIP = 0.45; // seconds: the chord strip's fill and scroll, as on the site

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function colors() {
    var c = {};
    Object.keys(TOKENS).forEach(function (k) { c[k] = cssVar(TOKENS[k][0], TOKENS[k][1]); });
    return c;
  }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    return Math.floor(sec / 60) + ':' + (sec % 60 < 10 ? '0' : '') + (sec % 60);
  }
  function lengthOf(song) { return song.loop ? song.loopEnd : song.duration; }
  function spacing(g, px) { if ('letterSpacing' in g) g.letterSpacing = px + 'px'; }

  // Everything that doesn't change from frame to frame.
  function prepare(song, W, H) {
    var total = lengthOf(song);
    var pitched = song.notes.filter(function (n) { return n.inst !== 'drums' && !n.harmony && n.midi > 0 && n.t < total; });
    var lo = 127, hi = 0, maxD = 0;
    pitched.forEach(function (n) { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); maxD = Math.max(maxD, n.d); });
    var byStart = pitched.slice().sort(function (a, b) { return a.t - b.t; });
    var order = { chords: 0, guitar: 1, bass: 2, arp: 3, lead: 4 };
    var drums = song.notes.filter(function (n) { return n.inst === 'drums' && n.t < total; });
    var U = Math.min(W, H);
    var pad = Math.round(U * 0.06);
    var portrait = H > W * 1.2;
    var L = { pad: pad, portrait: portrait };
    L.eyebrowY = pad + U * 0.02;
    L.titleSize = Math.round(U * 0.062);
    L.titleY = L.eyebrowY + U * 0.018 + L.titleSize;
    L.chipTop = L.titleY + U * 0.03;
    L.chipH = Math.round(U * 0.046);
    L.rollTop = portrait ? H * 0.25 : L.chipTop + L.chipH + U * 0.085;
    L.rollBottom = portrait ? H * 0.68 : H - pad - U * 0.2;
    L.stripTop = L.rollBottom + U * 0.035;
    L.stripH = Math.round(U * 0.062);
    L.bigChordY = portrait ? H * 0.86 : 0;
    L.barY = H - pad * 0.7;
    L.playX = W * (portrait ? 0.3 : 0.28);
    L.head = U * 0.034; // the roll's header row (bar numbers)
    L.drumH = U * 0.055;

    var P = {
      song: song, W: W, H: H, U: U, L: L, total: total, C: colors(),
      lo: lo - 2, hi: hi + 2, maxD: maxD, notes: byStart, order: order,
      kicks: drums.filter(function (n) { return n.drum === 'kick'; }).map(function (n) { return n.t; }),
      snares: drums.filter(function (n) { return n.drum === 'snare' || n.drum === 'clap'; }).map(function (n) { return [n.t, n.vel]; }),
      drums: drums,
      leads: byStart.filter(function (n) { return n.inst === 'lead'; }),
      chords: song.chords.filter(function (c) { return c.time < total - 0.01; }),
      // Seconds shown across the width: about three bars, fewer on narrow frames.
      span: song.barDuration * (portrait ? 2.2 : W / H > 1.2 ? 3.2 : 2.6),
      display: cssVar('--font-display', 'sans-serif'),
      mono: cssVar('--font-mono', 'monospace')
    };
    P.stripFont = '400 ' + Math.round(U * 0.026) + 'px ' + P.mono;
    P.chipFont = '400 ' + Math.round(U * 0.021) + 'px ' + P.mono;
    return P;
  }
  // Widths that need a font (measured once, on the frame's own canvas).
  function measure(g, P) {
    if (P.strip) return;
    var U = P.U, padX = U * 0.022, x = 0;
    g.font = P.stripFont;
    spacing(g, 0);
    P.strip = P.chords.map(function (c) {
      var w = Math.ceil(g.measureText(c.name).width + padX * 2);
      var box = { x: x, w: w, name: c.name, time: c.time };
      x += w;
      return box;
    });
    P.stripW = x;
    var song = P.song;
    P.chips = [song.styleLabel || STYLE[song.style] || song.style, song.key + ' ' + song.mode, song.bpm + ' BPM', song.meter || '4/4'];
    g.font = P.chipFont;
    P.chipW = P.chips.map(function (s) { return Math.ceil(g.measureText(s).width + U * 0.03); });
  }

  function lastBefore(times, t) {
    var lo = 0, hi = times.length - 1, best = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      var v = typeof times[mid] === 'number' ? times[mid] : times[mid][0];
      if (v <= t) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return best;
  }
  function firstIndexFrom(notes, t) {
    var lo = 0, hi = notes.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (notes[mid].t < t) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function fitText(g, text, font, size, maxW, weight) {
    var set = function () { g.font = (weight || '400') + ' ' + size + 'px ' + font; };
    set();
    while (g.measureText(text).width > maxW && size > 10) { size -= 2; set(); }
    return size;
  }
  function rgba(hex, a) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return 'rgba(255,106,61,' + a + ')';
    var n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  // Clip to [x, x + w * p] (a wipe from the left) and draw.
  function wiped(g, x, y, w, h, p, draw) {
    if (p <= 0) return;
    g.save();
    g.beginPath(); g.rect(x, y, w * p, h); g.clip();
    draw();
    g.restore();
  }

  function drawFrame(g, P, t) {
    var song = P.song, W = P.W, H = P.H, U = P.U, L = P.L, C = P.C;
    measure(g, P);
    spacing(g, 0);
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.globalAlpha = 1;

    g.fillStyle = C.ground;
    g.fillRect(0, 0, W, H);

    // Where are we?
    var sec = song.sections[0], secIdx = 0;
    song.sections.forEach(function (s, i) { if (s.start <= t + 1e-6) { sec = s; secIdx = i; } });
    var ci = -1;
    for (var i = 0; i < P.chords.length; i++) if (P.chords[i].time <= t + 0.02) ci = i;

    // Header: an English eyebrow, the title (light weight, wiping in), the facts as chips.
    g.font = '500 ' + Math.round(U * 0.019) + 'px ' + P.mono;
    spacing(g, U * 0.005);
    g.fillStyle = C.accent;
    g.fillText('MUSIC-COMPOSITION.JS', L.pad, L.eyebrowY);
    spacing(g, 0);
    g.fillStyle = C.ink;
    var ts = fitText(g, song.title, P.display, L.titleSize, W - L.pad * 2, '300');
    wiped(g, L.pad, L.titleY - ts * 1.1, W, ts * 1.4, EASE_WIPE((t - 0.1) / 0.6), function () { g.fillText(song.title, L.pad, L.titleY); });

    var cx = L.pad;
    g.font = P.chipFont;
    g.textBaseline = 'middle';
    P.chips.forEach(function (s, k) {
      var w = P.chipW[k], a = Math.max(0, Math.min(1, (t - 0.3 - k * 0.06) / 0.45));
      if (a <= 0) { cx += w - 1; return; }
      var dy = (1 - EASE(a)) * U * 0.01;
      g.globalAlpha = a;
      if (k === 0) { g.fillStyle = C.accent; g.fillRect(cx, L.chipTop + dy, w, L.chipH); }
      else { g.strokeStyle = C.line; g.lineWidth = 1; g.strokeRect(cx + 0.5, L.chipTop + dy + 0.5, w - 1, L.chipH - 1); }
      g.fillStyle = k === 0 ? C.accentInk : C.ink;
      g.fillText(s, cx + U * 0.015, L.chipTop + dy + L.chipH / 2 + 1);
      cx += w - 1;
    });
    g.globalAlpha = 1;
    g.textBaseline = 'alphabetic';

    // Piano roll ----------------------------------------------------------
    var rt = L.rollTop, rb = L.rollBottom;
    var top = rt + L.head, laneTop = rb - L.drumH, bottom = laneTop - U * 0.012;
    var rowH = (bottom - top) / (P.hi - P.lo + 1);
    var pxPerSec = W / P.span;
    var X = function (tt) { return L.playX + (tt - t) * pxPerSec; };
    var Y = function (m) { return bottom - (m - P.lo + 1) * rowH; };
    var t0 = t - L.playX / pxPerSec, t1 = t + (W - L.playX) / pxPerSec;
    var bd = song.barDuration;

    // The beat, very softly, around the playhead.
    var k = lastBefore(P.kicks, t);
    var kick = k >= 0 ? Math.exp(-(t - P.kicks[k]) / 0.18) : 0;
    var glowR = Math.max(W, H) * 0.6;
    var grad = g.createRadialGradient(L.playX, (rt + rb) / 2, 0, L.playX, (rt + rb) / 2, glowR);
    grad.addColorStop(0, rgba(C.accent, (0.03 + 0.07 * kick).toFixed(3)));
    grad.addColorStop(1, rgba(C.accent, 0));
    g.fillStyle = grad;
    g.fillRect(0, rt, W, rb - rt);

    // Sections as alternate bands, like the site's roll.
    song.sections.forEach(function (s, si) {
      if (si % 2 === 0) return;
      var x0 = Math.max(0, X(s.start)), x1 = Math.min(W, X(s.start + s.bars * bd));
      if (x1 > x0) { g.fillStyle = C.band; g.fillRect(x0, rt, x1 - x0, rb - rt); }
    });
    // Bar lines, with bar numbers in the header row.
    g.font = '500 ' + Math.round(U * 0.017) + 'px ' + P.mono;
    g.textBaseline = 'middle';
    for (var b = Math.max(0, Math.floor(t0 / bd)); b * bd <= t1 && b < song.bars; b++) {
      var bx = Math.round(X(b * bd)) + 0.5;
      g.strokeStyle = C.grid; g.lineWidth = 1;
      g.beginPath(); g.moveTo(bx, rt); g.lineTo(bx, laneTop); g.stroke();
      g.fillStyle = C.muted; g.globalAlpha = 0.6;
      g.fillText(String(b + 1), bx + U * 0.008, rt + L.head / 2);
      g.globalAlpha = 1;
    }
    g.textBaseline = 'alphabetic';

    var from = firstIndexFrom(P.notes, t0 - P.maxD), to = firstIndexFrom(P.notes, t1);
    var visible = P.notes.slice(from, to).filter(function (n) { return n.t + n.d >= t0; });
    visible.sort(function (a, b) { return P.order[a.inst] - P.order[b.inst]; });
    var h = Math.max(2, rowH - 1), glow = [];
    visible.forEach(function (n) {
      var x = X(n.t), w = Math.max(3, n.d * pxPerSec - 1), y = Y(n.midi) + (rowH - h) / 2;
      if (n.t <= t && t < n.t + n.d && n.inst !== 'chords') { glow.push([n, x, y, w]); return; }
      g.globalAlpha = (ALPHA[n.inst] || 0.9) * (n.t + n.d < t ? 0.55 : 1);
      g.fillStyle = C[n.inst];
      g.fillRect(x, y, w, h);
    });
    g.globalAlpha = 1;
    // Sounding notes glow.
    if (glow.length) {
      g.shadowBlur = U * 0.022;
      glow.forEach(function (q) { g.fillStyle = g.shadowColor = C[q[0].inst]; g.fillRect(q[1], q[2] - 1, q[3], h + 2); });
      g.shadowBlur = 0; g.shadowColor = 'transparent';
    }

    // Rings where melody notes start.
    for (var li = firstIndexFrom(P.leads, t - 0.7); li < P.leads.length && P.leads[li].t <= t; li++) {
      var ln = P.leads[li], age = t - ln.t;
      g.strokeStyle = C.lead;
      g.globalAlpha = Math.max(0, 0.7 * (1 - age / 0.7));
      g.lineWidth = Math.max(1.5, U * 0.003);
      g.beginPath();
      g.arc(L.playX, Y(ln.midi) + rowH / 2, U * (0.012 + age * 0.08), 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;

    // Drum lane
    g.fillStyle = C.band; g.fillRect(0, laneTop, W, rb - laneTop);
    g.fillStyle = C.line; g.fillRect(0, Math.round(laneTop), W, 1);
    g.fillStyle = C.drums;
    var dh = (L.drumH - U * 0.02) / 3;
    for (var di = firstIndexFrom(P.drums, t0); di < P.drums.length && P.drums[di].t <= t1; di++) {
      var dn = P.drums[di];
      var hit = dn.t <= t && t - dn.t < 0.12;
      g.globalAlpha = hit ? 1 : (dn.t < t ? 0.3 : 0.6) * (0.4 + 0.6 * dn.vel);
      g.fillRect(X(dn.t), laneTop + U * 0.01 + DRUM_ROW[dn.drum] * dh - (hit ? 1 : 0), dn.drum === 'crash' ? U * 0.006 : U * (hit ? 0.004 : 0.0028), dh - 2 + (hit ? 2 : 0));
    }
    g.globalAlpha = 1;

    // The roll's frame: thin lines above and below.
    g.fillStyle = C.line;
    g.fillRect(0, Math.round(rt), W, 1);
    g.fillRect(0, Math.round(rb), W, 1);

    // Playhead: the accent, with a notch at the top, brighter on the backbeat.
    var sn = lastBefore(P.snares, t);
    var flash = sn >= 0 ? Math.exp(-(t - P.snares[sn][0]) / 0.12) * P.snares[sn][1] : 0;
    var px = Math.round(L.playX), nw = U * 0.009;
    g.fillStyle = C.accent;
    g.globalAlpha = 0.75 + 0.25 * flash;
    g.fillRect(px - 1, rt, 2, rb - rt);
    g.beginPath(); g.moveTo(px - nw, rt); g.lineTo(px + nw, rt); g.lineTo(px, rt + nw * 1.2); g.closePath(); g.fill();
    g.globalAlpha = 1;

    // Section, above the roll: its colour, wiping in when it begins.
    var secLabel = SECTION[sec.type] || sec.type;
    var prevSec = song.sections[secIdx - 1];
    if (sec.shift && prevSec && prevSec.shift !== sec.shift) secLabel += '  KEY ↑ ' + sec.key;
    g.font = '500 ' + Math.round(U * 0.022) + 'px ' + P.mono;
    spacing(g, U * 0.004);
    var sy = rt - U * 0.022, sw = g.measureText(secLabel).width;
    wiped(g, L.pad, sy - U * 0.03, sw + U * 0.03, U * 0.045, EASE_WIPE((t - sec.start) / 0.6), function () {
      g.fillStyle = C[SECTION_COLOR[sec.type]] || C.muted;
      g.fillRect(L.pad, sy - U * 0.0165, U * 0.004, U * 0.02);
      g.fillStyle = C.ink;
      g.fillText(secLabel, L.pad + U * 0.014, sy);
    });
    spacing(g, 0);

    // The chord strip, as on the site: the current chord fills in from the
    // left while the previous one empties to the right, and the strip slides
    // to keep it in the middle, all with the same easing.
    drawStrip(g, P, t, ci);

    // A large chord name, where there is room for it (portrait).
    if (L.portrait && ci >= 0) {
      var chord = P.chords[ci], next = P.chords[ci + 1];
      var fresh = EASE((t - chord.time) / STRIP);
      g.fillStyle = C.ink;
      var cs = fitText(g, chord.name, P.display, Math.round(U * 0.13), W * 0.6, '300');
      wiped(g, L.pad, L.bigChordY - cs, W, cs * 1.3, fresh, function () { g.fillText(chord.name, L.pad, L.bigChordY); });
      if (next) {
        var nx = L.pad + g.measureText(chord.name).width + U * 0.04;
        g.font = '300 ' + Math.round(cs * 0.36) + 'px ' + P.display;
        g.fillStyle = C.muted;
        g.fillText('→ ' + next.name, nx, L.bigChordY);
      }
    }

    // Progress, split into sections --------------------------------------
    var barX = L.pad, barW = W - L.pad * 2, barH = Math.max(3, Math.round(U * 0.005));
    song.sections.forEach(function (s) {
      if (s.start >= P.total) return;
      var sx = barX + (s.start / P.total) * barW, sw2 = (Math.min(s.bars * bd, P.total - s.start) / P.total) * barW;
      g.fillStyle = C[SECTION_COLOR[s.type]] || C.muted;
      g.globalAlpha = 0.25;
      g.fillRect(sx + 1, L.barY, sw2 - 2, barH);
      g.globalAlpha = 1;
      var done = Math.max(0, Math.min(sw2, (t - s.start) / P.total * barW));
      if (done > 0) g.fillRect(sx + 1, L.barY, Math.max(0, Math.min(sw2 - 2, done)), barH);
    });
    g.globalAlpha = 1;
    g.font = '400 ' + Math.round(U * 0.02) + 'px ' + P.mono;
    g.fillStyle = C.muted;
    g.textAlign = 'right';
    g.fillText(fmt(t) + ' / ' + fmt(P.total), W - L.pad, L.barY - U * 0.018);
    g.textAlign = 'left';
    g.fillText(location.host || 'mcj.siyukatu.me', L.pad, L.barY - U * 0.018);
  }

  function drawStrip(g, P, t, ci) {
    var L = P.L, U = P.U, C = P.C, boxes = P.strip;
    if (!boxes.length) return;
    var x0 = L.pad, vw = P.W - L.pad * 2, y = L.stripTop, h = L.stripH;
    var max = Math.max(0, P.stripW - vw);
    var target = function (i) { return i < 0 ? 0 : Math.max(0, Math.min(max, boxes[i].x + boxes[i].w / 2 - vw / 2)); };
    var p = ci >= 0 ? EASE((t - boxes[ci].time) / STRIP) : 1;
    var off = ci >= 0 ? target(ci - 1) + (target(ci) - target(ci - 1)) * p : 0;

    g.save();
    g.beginPath(); g.rect(x0, y - 1, vw, h + 2); g.clip();
    g.font = P.stripFont;
    g.textBaseline = 'middle';
    var ty = y + h / 2 + 1, padX = U * 0.022;
    boxes.forEach(function (bx, i) {
      var x = x0 + bx.x - off;
      if (x > x0 + vw || x + bx.w < x0) return;
      // The fill: the current chord's from the left, the previous one's leaving to the right.
      var f0 = 0, f1 = 0;
      if (i === ci) { f0 = 0; f1 = p; }
      else if (i === ci - 1) { f0 = p; f1 = 1; }
      g.fillStyle = C.muted;
      g.fillText(bx.name, x + padX, ty);
      if (f1 > f0) {
        var fx = x + bx.w * f0, fw = bx.w * (f1 - f0);
        g.fillStyle = C.accent;
        g.fillRect(fx, y, fw, h);
        g.save();
        g.beginPath(); g.rect(fx, y, fw, h); g.clip();
        g.fillStyle = C.accentInk;
        g.fillText(bx.name, x + padX, ty);
        g.restore();
      }
      g.fillStyle = C.line;
      g.fillRect(Math.round(x), y, 1, h);
    });
    var end = x0 + P.stripW - off;
    g.fillStyle = C.line;
    g.fillRect(x0, y, Math.min(vw, end - x0), 1);
    g.fillRect(x0, y + h - 1, Math.min(vw, end - x0), 1);
    if (end < x0 + vw) g.fillRect(Math.round(end) - 1, y, 1, h);
    g.restore();
    g.textBaseline = 'alphabetic';
  }

  // Audio ------------------------------------------------------------------
  function readWav(buf) {
    var v = new DataView(buf);
    var channels = v.getUint16(22, true), rate = v.getUint32(24, true);
    var n = (buf.byteLength - 44) / 2 / channels;
    var pcm = new Int16Array(buf, 44, n * channels);
    var planes = [];
    for (var c = 0; c < channels; c++) planes.push(new Float32Array(n));
    for (var i = 0; i < n; i++) for (c = 0; c < channels; c++) planes[c][i] = pcm[i * channels + c] / 32768;
    return { rate: rate, channels: channels, planes: planes, length: n };
  }

  function supportsFastExport() {
    return typeof VideoEncoder === 'function' && typeof AudioEncoder === 'function';
  }

  function whenFontsReady(P) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load('300 40px ' + P.display, P.song.title),
      document.fonts.load('400 20px ' + P.mono),
      document.fonts.load('500 20px ' + P.mono)
    ]).catch(function () {});
  }

  function abortError() {
    var e = new Error('canceled');
    e.name = 'AbortError';
    return e;
  }

  // Faster than real time: WebCodecs + Mediabunny --------------------------
  async function renderFast(song, wav, opts) {
    var MB = await import(MEDIABUNNY);
    var size = SIZES[opts.aspect] || SIZES['16:9'];
    var W = size[0], H = size[1];
    var audio = readWav(wav);
    var videoCodec = await MB.getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: W, height: H });
    var audioCodec = await MB.getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: audio.channels, sampleRate: audio.rate });
    if (!audioCodec && audio.rate !== 48000 && window.MusicComposition) {
      // Some encoders only take 48 kHz: render the song again at that rate.
      audio = readWav(await MusicComposition.renderAsync(song, { sampleRate: 48000 }));
      audioCodec = await MB.getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: audio.channels, sampleRate: audio.rate });
    }
    if (!videoCodec || !audioCodec) throw new Error('unsupported');

    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var g = canvas.getContext('2d');
    var P = prepare(song, W, H);
    await whenFontsReady(P);

    var output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new MB.BufferTarget() });
    var video = new MB.CanvasSource(canvas, { codec: videoCodec, bitrate: MB.QUALITY_HIGH, keyFrameInterval: 2 });
    var sound = new MB.AudioSampleSource({ codec: audioCodec, bitrate: 192000 });
    output.addVideoTrack(video, { frameRate: FPS });
    output.addAudioTrack(sound);
    await output.start();

    var frames = Math.ceil(P.total * FPS);
    var audioDone = 0;
    try {
      for (var f = 0; f < frames; f++) {
        if (opts.signal && opts.signal.aborted) throw abortError();
        var t = f / FPS;
        drawFrame(g, P, t);
        await video.add(t, 1 / FPS);
        // Keep audio about a second ahead of the video, so the two stay interleaved.
        var until = Math.min(audio.length, Math.ceil((t + 1) * audio.rate));
        if (until > audioDone) {
          await addAudio(MB, sound, audio, audioDone, until);
          audioDone = until;
        }
        if (opts.onProgress && f % 10 === 0) opts.onProgress(f / frames);
      }
      if (audioDone < audio.length) {
        await addAudio(MB, sound, audio, audioDone, audio.length);
      }
      await output.finalize();
    } catch (err) {
      try { await output.cancel(); } catch (e) {}
      throw err;
    }
    if (opts.onProgress) opts.onProgress(1);
    return new Blob([output.target.buffer], { type: 'video/mp4' });
  }
  async function addAudio(MB, source, audio, a, b) {
    var sample = new MB.AudioSample({
      data: concatPlanes(audio.planes, a, b),
      format: 'f32-planar', numberOfChannels: audio.channels, sampleRate: audio.rate, timestamp: a / audio.rate
    });
    try { await source.add(sample); } finally { sample.close(); }
  }
  function concatPlanes(planes, a, b) {
    var n = b - a, out = new Float32Array(n * planes.length);
    planes.forEach(function (p, c) { out.set(p.subarray(a, b), c * n); });
    return out;
  }

  // Real time: MediaRecorder -------------------------------------------------
  function recorderType() {
    if (typeof MediaRecorder !== 'function') return null;
    var types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (var i = 0; i < types.length; i++) if (MediaRecorder.isTypeSupported(types[i])) return types[i];
    return null;
  }
  async function renderRealtime(song, wav, opts) {
    var type = recorderType();
    var canvas = document.createElement('canvas');
    if (!type || !canvas.captureStream) throw new Error('unsupported');
    var size = SIZES[opts.aspect] || SIZES['16:9'];
    canvas.width = size[0]; canvas.height = size[1];
    var g = canvas.getContext('2d');
    var P = prepare(song, size[0], size[1]);
    await whenFontsReady(P);
    drawFrame(g, P, 0);

    var ac = new (window.AudioContext || window.webkitAudioContext)();
    var buffer = await ac.decodeAudioData(wav.slice(0));
    var dest = ac.createMediaStreamDestination();
    var src = ac.createBufferSource();
    src.buffer = buffer;
    src.connect(dest); // recorded, not played out loud
    var stream = canvas.captureStream(FPS);
    dest.stream.getAudioTracks().forEach(function (tr) { stream.addTrack(tr); });
    var rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6000000 });
    var parts = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) parts.push(e.data); };

    return new Promise(function (resolve, reject) {
      var start, timer;
      rec.onstop = function () {
        clearInterval(timer);
        ac.close();
        if (opts.signal && opts.signal.aborted) reject(abortError());
        else resolve(new Blob(parts, { type: type.split(';')[0] }));
      };
      rec.start(1000);
      start = ac.currentTime;
      src.start();
      // setInterval keeps going (slowly) in a background tab, unlike requestAnimationFrame.
      timer = setInterval(function () {
        var t = ac.currentTime - start;
        if ((opts.signal && opts.signal.aborted) || t >= P.total) {
          src.stop();
          rec.stop();
          return;
        }
        drawFrame(g, P, t);
        if (opts.onProgress) opts.onProgress(t / P.total);
      }, 1000 / FPS);
    });
  }

  window.MCVideo = {
    sizes: SIZES,
    /** 'fast' (WebCodecs), 'realtime' (MediaRecorder) or null */
    mode: function () { return supportsFastExport() ? 'fast' : recorderType() ? 'realtime' : null; },
    render: function (song, wav, opts) {
      opts = opts || {};
      if (!supportsFastExport()) return renderRealtime(song, wav, opts);
      return renderFast(song, wav, opts).catch(function (err) {
        if (err && (err.name === 'AbortError' || err.message !== 'unsupported')) throw err;
        return renderRealtime(song, wav, opts);
      });
    },
    /** Draw one frame (for previews). */
    drawFrame: function (canvas, song, t) {
      var P = prepare(song, canvas.width, canvas.height);
      drawFrame(canvas.getContext('2d'), P, t);
    }
  };
})();
