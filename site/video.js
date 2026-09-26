/*
 * Music video export for the demo page: draws the song as it plays (a scrolling
 * piano roll with the chord, section and beat) and encodes it with the song's
 * audio into an MP4.
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
  var C = {
    ground: '#111216', ground2: '#191B22', surface: '#1A1C21', line: '#2C3038', ink: '#ECEEF2', muted: '#969CA8',
    lead: '#FF6A33', bass: '#5B8BFF', chords: '#2EC4A0', arp: '#C07BF0', drums: '#6C727E'
  };
  var SECTION = { intro: 'INTRO', A: 'VERSE', P: 'PRE-CHORUS', B: 'CHORUS', C: 'BRIDGE', outro: 'OUTRO' };
  var SECTION_COLOR = { intro: C.muted, A: C.bass, P: C.arp, B: C.lead, C: C.chords, outro: C.muted };
  var STYLE = { pop: 'Pop', dance: 'Dance', lofi: 'Lo-fi', chiptune: 'Chiptune', ambient: 'Ambient' };

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    return Math.floor(sec / 60) + ':' + (sec % 60 < 10 ? '0' : '') + (sec % 60);
  }
  function lengthOf(song) { return song.loop ? song.loopEnd : song.duration; }

  // Everything that doesn't change from frame to frame.
  function prepare(song, W, H) {
    var total = lengthOf(song);
    var pitched = song.notes.filter(function (n) { return n.inst !== 'drums' && !n.harmony && n.midi > 0; });
    var lo = 127, hi = 0, maxD = 0;
    pitched.forEach(function (n) { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); maxD = Math.max(maxD, n.d); });
    var byStart = pitched.slice().sort(function (a, b) { return a.t - b.t; });
    var order = { chords: 0, bass: 1, arp: 2, lead: 3 };
    var drums = song.notes.filter(function (n) { return n.inst === 'drums'; });
    var U = Math.min(W, H);
    var pad = Math.round(U * 0.06);
    var portrait = H > W * 1.2;
    var L = {
      pad: pad,
      titleY: pad + U * 0.075,
      metaY: pad + U * 0.075 + U * 0.05,
      rollTop: portrait ? H * 0.24 : pad + U * 0.2,
      rollBottom: portrait ? H * 0.70 : H - pad - U * 0.2,
      chordY: portrait ? H * 0.80 : H - pad - U * 0.07,
      barY: H - pad * 0.55,
      playX: W * (portrait ? 0.3 : 0.28)
    };
    L.drumH = U * 0.05;
    return {
      song: song, W: W, H: H, U: U, L: L, total: total,
      lo: lo - 2, hi: hi + 2, maxD: maxD, notes: byStart, order: order,
      kicks: drums.filter(function (n) { return n.drum === 'kick'; }).map(function (n) { return n.t; }),
      snares: drums.filter(function (n) { return n.drum === 'snare' || n.drum === 'clap'; }).map(function (n) { return [n.t, n.vel]; }),
      drums: drums,
      leads: byStart.filter(function (n) { return n.inst === 'lead'; }),
      // Seconds shown across the width: about three bars, fewer on narrow frames.
      span: song.barDuration * (portrait ? 2.2 : W / H > 1.2 ? 3.2 : 2.6),
      display: cssVar('--font-display', 'sans-serif'),
      mono: cssVar('--font-mono', 'monospace')
    };
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
  function fitText(g, text, font, size, maxW) {
    g.font = size + 'px ' + font;
    while (g.measureText(text).width > maxW && size > 10) { size -= 2; g.font = size + 'px ' + font; }
    return size;
  }

  function drawFrame(g, P, t) {
    var song = P.song, W = P.W, H = P.H, U = P.U, L = P.L;

    // Background, breathing with the kick drum.
    var k = lastBefore(P.kicks, t);
    var kick = k >= 0 ? Math.exp(-(t - P.kicks[k]) / 0.18) : 0;
    g.fillStyle = C.ground;
    g.fillRect(0, 0, W, H);
    var grad = g.createRadialGradient(L.playX, (L.rollTop + L.rollBottom) / 2, 0, L.playX, (L.rollTop + L.rollBottom) / 2, Math.max(W, H) * 0.75);
    grad.addColorStop(0, 'rgba(255,106,51,' + (0.07 + 0.1 * kick).toFixed(3) + ')');
    grad.addColorStop(1, 'rgba(17,18,22,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    // Where are we?
    var sec = song.sections[0];
    song.sections.forEach(function (s) { if (s.start <= t + 1e-6) sec = s; });
    var ci = -1;
    for (var i = 0; i < song.chords.length; i++) if (song.chords[i].time <= t + 0.02) ci = i;

    // Title and meta
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillStyle = C.ink;
    fitText(g, song.title, P.display, Math.round(U * 0.075), W - L.pad * 2);
    g.fillText(song.title, L.pad, L.titleY);
    g.fillStyle = C.muted;
    var meta = [STYLE[song.style] || song.style, sec.key + ' ' + song.mode, song.bpm + ' BPM'].join('  ·  ');
    fitText(g, meta, P.mono, Math.round(U * 0.028), W - L.pad * 2);
    g.fillText(meta, L.pad, L.metaY);

    // Piano roll ----------------------------------------------------------
    var top = L.rollTop, bottom = L.rollBottom - L.drumH - U * 0.02;
    var rowH = (bottom - top) / (P.hi - P.lo + 1);
    var pxPerSec = W / P.span;
    var X = function (tt) { return L.playX + (tt - t) * pxPerSec; };
    var Y = function (m) { return bottom - (m - P.lo + 1) * rowH; };
    var t0 = t - L.playX / pxPerSec, t1 = t + (W - L.playX) / pxPerSec;

    // Bar lines
    g.fillStyle = C.line;
    for (var b = Math.max(0, Math.floor(t0 / song.barDuration)); b * song.barDuration <= t1; b++) {
      var bx = Math.round(X(b * song.barDuration));
      g.globalAlpha = 0.6;
      g.fillRect(bx, top, 1, L.rollBottom - top);
    }
    g.globalAlpha = 1;

    var from = firstIndexFrom(P.notes, t0 - P.maxD), to = firstIndexFrom(P.notes, t1);
    var visible = P.notes.slice(from, to).filter(function (n) { return n.t + n.d >= t0; });
    visible.sort(function (a, b) { return P.order[a.inst] - P.order[b.inst]; });
    var h = Math.max(2, rowH * 0.8);
    visible.forEach(function (n) {
      var x = X(n.t), w = Math.max(3, n.d * pxPerSec - 2), y = Y(n.midi) + (rowH - h) / 2;
      var on = n.t <= t && t < n.t + n.d;
      var base = n.inst === 'chords' ? 0.35 : n.inst === 'arp' ? 0.6 : 0.85;
      g.fillStyle = C[n.inst];
      if (on) {
        // Sounding notes glow.
        g.globalAlpha = 0.18;
        g.fillRect(x - 4, y - 4, w + 8, h + 8);
        g.globalAlpha = 1;
      } else {
        g.globalAlpha = n.t + n.d < t ? base * 0.45 : base;
      }
      g.fillRect(x, y, w, h);
    });
    g.globalAlpha = 1;

    // Rings where melody notes start.
    for (var li = firstIndexFrom(P.leads, t - 0.7); li < P.leads.length && P.leads[li].t <= t; li++) {
      var ln = P.leads[li], age = t - ln.t;
      var r = U * (0.012 + age * 0.09);
      g.strokeStyle = C.lead;
      g.globalAlpha = Math.max(0, 0.8 * (1 - age / 0.7));
      g.lineWidth = Math.max(1.5, U * 0.004);
      g.beginPath();
      g.arc(L.playX, Y(ln.midi) + rowH / 2, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;

    // Drum lane
    var laneTop = L.rollBottom - L.drumH;
    var rows = { kick: 2, snare: 1, clap: 1, hat: 0, open: 0, crash: 0 };
    g.fillStyle = C.drums;
    var dFrom = firstIndexFrom(P.drums, t0);
    for (var di = dFrom; di < P.drums.length && P.drums[di].t <= t1; di++) {
      var dn = P.drums[di];
      var hit = dn.t <= t && t - dn.t < 0.12;
      g.globalAlpha = hit ? 1 : (dn.t < t ? 0.25 : 0.55) * (0.4 + 0.6 * dn.vel);
      g.fillRect(X(dn.t), laneTop + rows[dn.drum] * L.drumH / 3, dn.drum === 'crash' ? 5 : 3, L.drumH / 3 - 2);
    }
    g.globalAlpha = 1;

    // Playhead, flashing on the backbeat.
    var sn = lastBefore(P.snares, t);
    var flash = sn >= 0 ? Math.exp(-(t - P.snares[sn][0]) / 0.12) * P.snares[sn][1] : 0;
    g.fillStyle = C.ink;
    g.globalAlpha = 0.35 + 0.65 * flash;
    g.fillRect(Math.round(L.playX) - 1, top - U * 0.02, 2, L.rollBottom - top + U * 0.02);
    g.globalAlpha = 1;

    // Section and chord --------------------------------------------------
    g.textAlign = 'left';
    var secLabel = SECTION[sec.type] || sec.type;
    g.font = '600 ' + Math.round(U * 0.024) + 'px ' + P.mono;
    g.fillStyle = SECTION_COLOR[sec.type] || C.muted;
    g.fillText(secLabel, L.pad, top - U * 0.035);
    if (sec.shift) {
      var prevSec = song.sections[song.sections.indexOf(sec) - 1];
      if (prevSec && !prevSec.shift && t - sec.start < song.barDuration * 2) {
        g.fillStyle = C.lead;
        g.fillText('  KEY ↑ ' + sec.key, L.pad + g.measureText(secLabel).width, top - U * 0.035);
      }
    }

    if (ci >= 0) {
      var chord = song.chords[ci], next = song.chords[ci + 1];
      var fresh = Math.min(1, (t - chord.time) / 0.12);
      g.fillStyle = C.ink;
      g.globalAlpha = 0.4 + 0.6 * fresh;
      var cs = fitText(g, chord.name, P.display, Math.round(U * 0.1), W * 0.55);
      g.fillText(chord.name, L.pad, L.chordY);
      g.globalAlpha = 1;
      if (next) {
        var nx = L.pad + g.measureText(chord.name).width + U * 0.04;
        g.font = Math.round(cs * 0.4) + 'px ' + P.display;
        g.fillStyle = C.muted;
        g.fillText('→ ' + next.name, nx, L.chordY);
      }
    }

    // Progress, split into sections --------------------------------------
    var barX = L.pad, barW = W - L.pad * 2, barH = Math.max(3, U * 0.006);
    song.sections.forEach(function (s) {
      var sx = barX + (s.start / P.total) * barW, sw = (s.bars * song.barDuration / P.total) * barW;
      g.fillStyle = SECTION_COLOR[s.type] || C.muted;
      g.globalAlpha = 0.25;
      g.fillRect(sx + 1, L.barY, sw - 2, barH);
      g.globalAlpha = 0.95;
      var done = Math.max(0, Math.min(sw, (t - s.start) / P.total * barW));
      if (done > 0) g.fillRect(sx + 1, L.barY, Math.max(0, done - 2), barH);
    });
    g.globalAlpha = 1;
    g.font = Math.round(U * 0.022) + 'px ' + P.mono;
    g.fillStyle = C.muted;
    g.textAlign = 'right';
    g.fillText(fmt(t) + ' / ' + fmt(P.total), W - L.pad, L.barY - U * 0.018);
    g.textAlign = 'left';
    g.fillText('music-composition.js · ' + (location.host || 'mcj.siyukatu.me'), L.pad, L.barY - U * 0.018);
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
      document.fonts.load('40px ' + P.display, P.song.title),
      document.fonts.load('20px ' + P.mono)
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
