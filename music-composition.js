/*!
 * music-composition.js — client-side procedural music generator
 * Composes a short piece of music from a seed and renders it to a WAV file.
 * No dependencies. Works in browsers, Web Workers and Node.js.
 * https://github.com/siyukatu/music-composition.js
 *
 *   const wav = MusicComposition.generate({ style: 'lofi', seed: 'hello' }); // ArrayBuffer (WAV)
 *   const url = MusicComposition.toURL(wav);                                // blob: URL for <audio>
 *
 * (c) 2026 siyukatu — MIT License
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else root.MusicComposition = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0-beta.0';
  var TAU = Math.PI * 2;

  // ---------------------------------------------------------------------------
  // Random numbers (seeded, reproducible)
  // ---------------------------------------------------------------------------
  function hashString(str) {
    str = String(str);
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }

  function makeRng(seed) {
    var a = hashString(seed);
    function next() {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next: next,
      range: function (lo, hi) { return lo + (hi - lo) * next(); },
      int: function (lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      chance: function (p) { return next() < p; },
      sign: function () { return next() < 0.5 ? -1 : 1; }
    };
  }

  function randomSeed() {
    var chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    var s = '';
    for (var i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ---------------------------------------------------------------------------
  // Music theory
  // ---------------------------------------------------------------------------
  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var FLATS = { Db: 1, Eb: 3, Gb: 6, Ab: 8, Bb: 10, Cb: 11, Fb: 4 };
  var NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  // Relative-major offset of each mode, used to decide sharp vs flat spelling.
  var MODE_OFFSET = { major: 0, minor: 9, dorian: 2, mixolydian: 7, lydian: 5 };
  function spelling(keyPc, modeName) {
    var major = (keyPc - MODE_OFFSET[modeName] + 12) % 12;
    return [5, 10, 3, 8, 1, 6].indexOf(major) >= 0 ? NOTE_NAMES_FLAT : NOTE_NAMES;
  }

  var MODES = {
    major:      [0, 2, 4, 5, 7, 9, 11],
    minor:      [0, 2, 3, 5, 7, 8, 10],
    dorian:     [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    lydian:     [0, 2, 4, 6, 7, 9, 11]
  };

  // Progressions as 0-based scale degrees. "bright" suits major-type modes,
  // "dark" suits minor-type modes.
  var PROGRESSIONS = {
    bright: [
      [0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 4, 3], [0, 2, 3, 4],
      [3, 4, 2, 5], [0, 3, 0, 4], [0, 5, 1, 4], [3, 0, 4, 5], [0, 1, 3, 4]
    ],
    dark: [
      [0, 5, 2, 6], [0, 5, 6, 0], [0, 6, 5, 6], [0, 3, 5, 4], [5, 6, 0, 0],
      [0, 2, 6, 3], [0, 3, 6, 2], [5, 3, 0, 6], [0, 6, 3, 4], [0, 3, 0, 6]
    ],
    lydian: [[0, 1, 0, 1], [0, 1, 5, 4], [0, 1, 2, 1], [0, 4, 1, 0]],
    mixolydian: [[0, 6, 3, 0], [0, 3, 6, 3], [0, 6, 5, 3]],
    dorian: [[0, 3, 0, 3], [0, 6, 3, 0], [0, 3, 6, 4], [0, 1, 3, 0]]
  };

  function parseKey(key) {
    if (typeof key === 'number') return ((Math.round(key) % 12) + 12) % 12;
    var s = String(key).trim();
    var name = s.charAt(0).toUpperCase() + s.slice(1).replace(/[^#b]/g, '');
    if (FLATS[name] !== undefined) return FLATS[name];
    var idx = NOTE_NAMES.indexOf(name);
    if (idx < 0) throw new Error('music-composition.js: unknown key "' + key + '" (use C, C#, Db ... B)');
    return idx;
  }

  function degToMidi(base, scale, deg) {
    var oct = Math.floor(deg / 7);
    return base + oct * 12 + scale[deg - oct * 7];
  }

  function chordName(keyPc, scale, deg, seventh, names) {
    var d = ((deg % 7) + 7) % 7;
    var iv = function (n) { return (scale[(d + n) % 7] - scale[d] + 12) % 12; };
    var third = iv(2), fifth = iv(4), sev = iv(6);
    var root = (names || NOTE_NAMES)[(keyPc + scale[d]) % 12];
    var q;
    if (third === 4 && fifth === 7) q = seventh ? (sev === 11 ? 'maj7' : '7') : '';
    else if (third === 3 && fifth === 7) q = seventh ? (sev === 10 ? 'm7' : 'mM7') : 'm';
    else if (third === 3 && fifth === 6) q = seventh ? 'm7b5' : 'dim';
    else if (third === 4 && fifth === 8) q = 'aug';
    else q = '';
    return root + q;
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------
  var STYLES = {
    pop: {
      label: 'Pop', bpm: [98, 124], modes: ['major', 'major', 'mixolydian', 'minor'],
      chordBars: 1, swing: 0, sevenths: 0.15, humanize: 0,
      drums: 'pop', kit: 'std', bass: 'pop', bassPatch: 'bassSaw', bassOct: 0,
      chords: 'keys', pad: 'pad', arp: 'eighths', arpPatch: 'arp', lead: 'leadSaw',
      melody: { grid: 2, density: 0.55, legato: 0.85, sixteenths: 0.12, center: [3, 6], octave: 0 },
      fx: { room: 0.78, damp: 0.35, wet: 1, delay: 1, sidechain: 0, lofi: false, tail: 3 }
    },
    dance: {
      label: 'Dance', bpm: [118, 128], modes: ['minor', 'minor', 'dorian'],
      chordBars: 1, swing: 0, sevenths: 0.3, humanize: 0,
      drums: 'dance', kit: 'std', bass: 'dance', bassPatch: 'bassSaw', bassOct: 0,
      chords: null, pad: 'padWide', arp: 'sixteenths', arpPatch: 'arp', lead: 'leadPluck',
      melody: { grid: 2, density: 0.5, legato: 0.7, sixteenths: 0.18, center: [3, 6], octave: 0 },
      fx: { room: 0.82, damp: 0.3, wet: 1, delay: 1.2, sidechain: 0.7, lofi: false, tail: 3 }
    },
    lofi: {
      label: 'Lo-fi', bpm: [68, 86], modes: ['dorian', 'minor', 'major'],
      chordBars: 1, swing: 0.3, sevenths: 0.95, humanize: 1,
      drums: 'lofi', kit: 'lofi', bass: 'lofi', bassPatch: 'bassSine', bassOct: 0,
      chords: 'epiano', pad: null, arp: null, lead: 'leadSoft',
      melody: { grid: 2, density: 0.42, legato: 0.9, sixteenths: 0.08, center: [2, 4], octave: 0 },
      fx: { room: 0.7, damp: 0.5, wet: 0.9, delay: 0.6, sidechain: 0, lofi: true, tail: 3 }
    },
    chiptune: {
      label: 'Chiptune', bpm: [128, 160], modes: ['major', 'minor', 'dorian', 'mixolydian'],
      chordBars: 1, swing: 0, sevenths: 0, humanize: 0,
      drums: 'chip', kit: 'chip', bass: 'chip', bassPatch: 'bassChip', bassOct: 12,
      chords: 'chiparp', pad: null, arp: null, lead: 'leadSquare',
      melody: { grid: 2, density: 0.62, legato: 0.8, sixteenths: 0.2, center: [3, 6], octave: 12 },
      fx: { room: 0.5, damp: 0.5, wet: 0.35, delay: 0.5, sidechain: 0, lofi: false, tail: 2 }
    },
    ambient: {
      label: 'Ambient', bpm: [62, 78], modes: ['lydian', 'major', 'dorian', 'minor'],
      chordBars: 2, swing: 0, sevenths: 0.6, humanize: 0,
      drums: null, kit: 'std', bass: 'ambient', bassPatch: 'bassSine', bassOct: 0,
      chords: null, pad: 'padAmbient', arp: 'bell', arpPatch: 'bellSoft', lead: 'bell',
      melody: { grid: 4, density: 0.38, legato: 1, sixteenths: 0, center: [4, 7], octave: 0 },
      fx: { room: 0.93, damp: 0.2, wet: 1.4, delay: 1.2, sidechain: 0, lofi: false, tail: 6 }
    }
  };
  var STYLE_NAMES = Object.keys(STYLES);

  // Synth patches. a/d/r in seconds, s = sustain level 0..1,
  // cutoff/env in Hz (cutoff 0 = no filter), fd = filter-envelope decay (s).
  var PATCHES = {
    leadSaw:    { wave: 'saw', unison: 2, detune: 7, a: 0.01, d: 0.3, s: 0.65, r: 0.18, cutoff: 1800, env: 2600, fd: 0.25, res: 0.15, gain: 0.32, pan: 0.08, rev: 0.25, dly: 0.28, vib: 0.18 },
    leadPluck:  { wave: 'saw', unison: 2, detune: 9, a: 0.003, d: 0.35, s: 0.25, r: 0.15, cutoff: 900, env: 4200, fd: 0.14, res: 0.3, gain: 0.4, pan: 0.05, rev: 0.3, dly: 0.35, vib: 0 },
    leadSoft:   { wave: 'tri', unison: 1, a: 0.02, d: 0.4, s: 0.55, r: 0.3, cutoff: 1600, env: 600, fd: 0.3, res: 0.05, gain: 0.4, pan: 0.12, rev: 0.35, dly: 0.2, vib: 0.12 },
    leadSquare: { wave: 'square', pw: 0.5, unison: 1, a: 0.002, d: 0.12, s: 0.75, r: 0.04, cutoff: 0, gain: 0.19, pan: 0.05, rev: 0.12, dly: 0.18, vib: 0.22 },
    bell:       { wave: 'fm', ratio: 3.5, index: 2.2, idecay: 0.5, a: 0.004, d: 2.2, s: 0, r: 1.6, cutoff: 0, gain: 0.2, pan: 0.15, rev: 0.6, dly: 0.35, vib: 0 },
    bellSoft:   { wave: 'fm', ratio: 2, index: 1.4, idecay: 0.3, a: 0.004, d: 1.6, s: 0, r: 1.2, cutoff: 0, gain: 0.07, pan: -0.3, rev: 0.7, dly: 0.4, vib: 0 },
    epiano:     { wave: 'fm', ratio: 1, index: 1.6, idecay: 0.35, a: 0.003, d: 1.6, s: 0.3, r: 0.35, cutoff: 2600, env: 0, res: 0, gain: 0.12, pan: 0, rev: 0.3, dly: 0, vib: 0.05 },
    keys:       { wave: 'saw', unison: 1, a: 0.004, d: 0.5, s: 0.15, r: 0.12, cutoff: 700, env: 2000, fd: 0.18, res: 0.1, gain: 0.13, pan: -0.1, rev: 0.3, dly: 0.1, vib: 0 },
    pad:        { wave: 'saw', unison: 3, detune: 14, a: 0.45, d: 1.2, s: 0.8, r: 0.9, cutoff: 800, env: 300, fd: 1.5, res: 0.05, gain: 0.07, pan: 0, rev: 0.6, dly: 0, vib: 0 },
    padWide:    { wave: 'saw', unison: 3, detune: 18, a: 0.08, d: 1.2, s: 0.8, r: 0.5, cutoff: 1300, env: 500, fd: 0.8, res: 0.1, gain: 0.08, pan: 0, rev: 0.5, dly: 0, vib: 0 },
    padAmbient: { wave: 'saw', unison: 3, detune: 12, a: 1.8, d: 3, s: 0.85, r: 2.5, cutoff: 650, env: 250, fd: 3, res: 0.1, gain: 0.05, pan: 0, rev: 0.8, dly: 0, vib: 0 },
    arp:        { wave: 'square', pw: 0.3, unison: 1, a: 0.002, d: 0.14, s: 0, r: 0.06, cutoff: 1800, env: 2500, fd: 0.08, res: 0.2, gain: 0.12, pan: -0.35, rev: 0.3, dly: 0.45, vib: 0 },
    chipArp:    { wave: 'square', pw: 0.25, unison: 1, a: 0.001, d: 0.06, s: 0.55, r: 0.01, cutoff: 0, gain: 0.11, pan: -0.2, rev: 0.1, dly: 0, vib: 0 },
    bassSaw:    { wave: 'saw', unison: 1, a: 0.003, d: 0.3, s: 0.55, r: 0.06, cutoff: 260, env: 1000, fd: 0.12, res: 0.3, gain: 0.34, pan: 0, rev: 0, dly: 0, vib: 0 },
    bassSine:   { wave: 'sinesat', unison: 1, a: 0.008, d: 0.5, s: 0.7, r: 0.1, cutoff: 0, gain: 0.38, pan: 0, rev: 0.02, dly: 0, vib: 0 },
    bassChip:   { wave: 'ntri', unison: 1, a: 0.001, d: 0.1, s: 1, r: 0.02, cutoff: 0, gain: 0.34, pan: 0, rev: 0.02, dly: 0, vib: 0 }
  };

  // Drum patterns: 16 steps per bar. 'x' = accent, 'o' = soft, '.' = rest.
  var DRUM_PATTERNS = {
    pop: {
      kick: ['x.....x...x.....', 'x.....x.x.......', 'x..x......x.....', 'x.....x...x..x..'],
      snare: ['....x.......x...'],
      hat: ['x.o.x.o.x.o.x.o.', 'xoxoxoxoxoxoxoxo']
    },
    dance: {
      kick: ['x...x...x...x...'],
      clap: ['....x.......x...'],
      hat: ['xo.oxo.oxo.oxo.o', 'x...x...x...x...'],
      open: ['..x...x...x...x.']
    },
    lofi: {
      kick: ['x......x..x.....', 'x.......x.x.....', 'x......xx.......', 'x.........x..o..'],
      snare: ['....x.......x...'],
      hat: ['x.o.x.o.x.o.x.o.', 'x.x.x.xox.x.x.xo']
    },
    chip: {
      kick: ['x.......x.x.....', 'x...x...x...x...', 'x.....x.x.......'],
      snare: ['....x.......x...', '....x.......x.o.'],
      hat: ['x.o.x.o.x.o.x.o.', 'oooooooooooooooo']
    }
  };

  // Bass patterns: [step, length, tone, velocity]. tone: r = root, 5 = fifth, o = octave.
  var BASS_PATTERNS = {
    pop: [
      [[0, 2, 'r', 1], [2, 2, 'r', 0.7], [4, 2, 'r', 0.8], [6, 2, 'o', 0.7], [8, 2, 'r', 0.9], [10, 2, 'r', 0.7], [12, 2, '5', 0.8], [14, 2, 'r', 0.7]],
      [[0, 3, 'r', 1], [3, 3, 'r', 0.8], [6, 2, '5', 0.7], [8, 3, 'r', 0.9], [11, 3, 'r', 0.8], [14, 2, 'o', 0.7]]
    ],
    dance: [
      [[2, 2, 'r', 1], [6, 2, 'r', 1], [10, 2, 'r', 1], [14, 2, 'r', 1]],
      [[2, 1, 'r', 1], [3, 1, 'r', 0.6], [6, 1, 'r', 1], [7, 1, 'o', 0.6], [10, 1, 'r', 1], [11, 1, 'r', 0.6], [14, 1, 'r', 1], [15, 1, 'o', 0.6]]
    ],
    lofi: [
      [[0, 6, 'r', 1], [7, 3, '5', 0.75], [10, 5, 'r', 0.85]],
      [[0, 8, 'r', 1], [10, 2, '5', 0.7], [12, 3, 'o', 0.75]],
      [[0, 5, 'r', 1], [6, 2, 'r', 0.7], [8, 6, '5', 0.85]]
    ],
    chip: [
      [[0, 2, 'r', 1], [2, 2, 'o', 0.9], [4, 2, 'r', 1], [6, 2, 'o', 0.9], [8, 2, 'r', 1], [10, 2, 'o', 0.9], [12, 2, '5', 1], [14, 2, 'o', 0.9]],
      [[0, 1, 'r', 1], [2, 1, 'r', 1], [3, 1, 'o', 1], [4, 2, 'r', 1], [6, 1, '5', 1], [8, 2, 'r', 1], [10, 1, 'r', 1], [11, 1, 'o', 1], [12, 2, '5', 1], [14, 2, 'r', 1]]
    ],
    ambient: [[[0, 16, 'r', 0.8]]],
    long: [[[0, 16, 'r', 0.8]]]
  };

  var EPIANO_PATTERNS = [
    [[0, 7, 1], [7, 9, 0.8]],
    [[0, 10, 1], [10, 6, 0.75]],
    [[0, 16, 1]],
    [[0, 3, 1], [3, 5, 0.7], [10, 6, 0.8]]
  ];
  var KEYS_PATTERNS = [
    [[0, 3, 1], [3, 3, 0.7], [6, 2, 0.8], [8, 3, 0.9], [11, 3, 0.7], [14, 2, 0.7]],
    [[0, 2, 1], [4, 2, 0.8], [8, 2, 0.9], [12, 2, 0.8]],
    [[0, 3, 1], [3, 5, 0.8], [8, 3, 0.9], [11, 5, 0.8]]
  ];

  var TITLE_A = ['Neon', 'Paper', 'Velvet', 'Midnight', 'Golden', 'Crystal', 'Silent', 'Electric', 'Lunar', 'Amber',
    'Coral', 'Distant', 'Hidden', 'Morning', 'Glass', 'Cotton', 'Pixel', 'Solar', 'Violet', 'Rainy', 'Tidal', 'Static', 'Faded', 'Northern'];
  var TITLE_B = ['Harbor', 'Parade', 'Garden', 'Signal', 'Avenue', 'Drift', 'Horizon', 'Station', 'Letters', 'Circuit',
    'Lantern', 'Orbit', 'Meadow', 'Skyline', 'Tides', 'Arcade', 'Window', 'Voyage', 'Bloom', 'Postcard', 'Satellite', 'Rooftop', 'Ferry', 'Echoes'];

  // ---------------------------------------------------------------------------
  // Composition
  // ---------------------------------------------------------------------------

  /**
   * Compose a song (the score only — no audio yet).
   * @param {object} [options]
   * @param {string|number} [options.seed]   Same seed + options => same song. Random if omitted.
   * @param {string} [options.style]         'pop' | 'dance' | 'lofi' | 'chiptune' | 'ambient' | 'auto'
   * @param {number} [options.bpm]           Tempo. Chosen from the style if omitted.
   * @param {string} [options.key]           'C' ... 'B' (sharps or flats). Random if omitted.
   * @param {string} [options.mode]          'major' | 'minor' | 'dorian' | 'mixolydian' | 'lydian'
   * @param {number} [options.bars]          Length in bars (rounded to a multiple of 4, 8–256). Default 32.
   * @param {number} [options.duration]      Target length in seconds (used when bars is omitted).
   * @param {boolean} [options.loop]         true => seamless loop (no intro/outro, reverb tail wrapped).
   * @returns {object} song
   */
  function compose(options) {
    var o = options || {};
    var seed = (o.seed === undefined || o.seed === null || o.seed === '') ? randomSeed() : String(o.seed);
    var R = function (name) { return makeRng(seed + '/' + name); };

    var styleName;
    if (!o.style || o.style === 'auto') styleName = R('style').pick(STYLE_NAMES);
    else if (STYLES[o.style]) styleName = o.style;
    else throw new Error('music-composition.js: unknown style "' + o.style + '" (use ' + STYLE_NAMES.join(', ') + ')');
    var st = STYLES[styleName];

    var bpm = o.bpm ? clamp(Math.round(+o.bpm), 40, 240) : Math.round(R('bpm').range(st.bpm[0], st.bpm[1]));
    var modeName;
    if (!o.mode || o.mode === 'auto') modeName = R('mode').pick(st.modes);
    else if (MODES[o.mode]) modeName = o.mode;
    else throw new Error('music-composition.js: unknown mode "' + o.mode + '" (use ' + Object.keys(MODES).join(', ') + ')');
    var scale = MODES[modeName];
    var keyPc = (o.key === undefined || o.key === null || o.key === '' || o.key === 'auto') ? R('key').int(0, 11) : parseKey(o.key);
    var loop = !!o.loop;
    var names = spelling(keyPc, modeName);

    var stepDur = 60 / bpm / 4;
    var barDur = stepDur * 16;
    var bars;
    if (o.bars) bars = Math.round(+o.bars / 4) * 4;
    else if (o.duration) bars = Math.round(+o.duration / barDur / 4) * 4;
    else bars = 32;
    bars = clamp(bars || 32, 8, 256);

    // Registers
    var leadBase = 60 + keyPc - (keyPc >= 6 ? 12 : 0) + st.melody.octave;
    var bassBase = 36 + keyPc - (keyPc >= 5 ? 12 : 0) + st.bassOct;
    var chordCenter = 64;
    var arpCenter = 76;

    // Harmony --------------------------------------------------------------
    var hr = R('harmony');
    var bright = modeName === 'major' || modeName === 'lydian' || modeName === 'mixolydian';
    var pool = (PROGRESSIONS[modeName] || []).concat(bright ? PROGRESSIONS.bright : PROGRESSIONS.dark);
    if (modeName === 'lydian') pool = PROGRESSIONS.lydian.concat(PROGRESSIONS.bright.filter(function (p) { return p.indexOf(3) < 0; }));
    // Leave out progressions that use this mode's diminished triad.
    var isDim = function (deg) {
      var d = deg % 7;
      return (scale[(d + 4) % 7] - scale[d] + 12) % 12 === 6;
    };
    var usable = function (p) { return !p.some(isDim); };
    pool = pool.filter(usable);
    var progA = hr.pick(pool);
    var progB = progA;
    for (var tries = 0; tries < 10 && progB.join() === progA.join(); tries++) progB = hr.pick(pool);
    var progOutro = [bright ? [3, 4, 0, 0] : [5, 6, 0, 0], [3, 4, 0, 0], [1, 1, 0, 0], [6, 6, 0, 0]].filter(usable)[0];
    var seventhFor = {};
    function hasSeventh(deg) {
      if (seventhFor[deg] === undefined) seventhFor[deg] = hr.chance(st.sevenths);
      return seventhFor[deg];
    }

    // Arrangement -----------------------------------------------------------
    var sections = [];
    var remaining = bars;
    var hasIntroOutro = !loop && bars >= 16;
    if (hasIntroOutro) remaining -= 8;
    if (hasIntroOutro) sections.push({ type: 'intro', bars: 4 });
    var bodyTypes = ['A', 'B'];
    for (var bi = 0; remaining > 0; bi++) {
      var len = Math.min(8, remaining);
      sections.push({ type: bodyTypes[bi % 2], bars: len });
      remaining -= len;
    }
    if (hasIntroOutro) sections.push({ type: 'outro', bars: 4 });
    var startBar = 0;
    sections.forEach(function (s) { s.startBar = startBar; s.start = startBar * barDur; startBar += s.bars; });

    var PARTS = {
      intro: { drums: 'light', pad: true, chords: true, arp: true },
      A: { drums: 'full', bass: true, chords: true, lead: true },
      B: { drums: 'full', bass: true, chords: true, pad: true, arp: true, lead: true },
      outro: { pad: true, chords: true, bass: 'long', end: true }
    };

    // Per-bar chords
    var barInfo = [];
    sections.forEach(function (sec, si) {
      var prog = sec.type === 'B' ? progB : sec.type === 'outro' ? progOutro : progA;
      var cb = sec.type === 'outro' ? 1 : st.chordBars;
      for (var j = 0; j < sec.bars; j++) {
        var idx = Math.floor(j / cb) % prog.length;
        var deg = prog[idx];
        // Turnaround: end a body section on V (bright) / VII (dark) before returning to A.
        var next = sections[si + 1];
        if (j === sec.bars - 1 && cb === 1 && next && next.type === 'A' && prog.length === 4 && deg === 0) deg = !isDim(4) && bright ? 4 : !isDim(6) ? 6 : 3;
        var sev = sec.type === 'outro' && j === sec.bars - 1 ? false : hasSeventh(deg);
        barInfo.push({
          sec: sec, secIndex: si, j: j, deg: deg, seventh: sev,
          cont: cb > 1 && j % cb !== 0,
          parts: PARTS[sec.type]
        });
      }
    });

    var notes = [];
    var chords = [];
    var gr = R('groove');
    var hum = st.humanize ? R('humanize') : null;

    function T(bar, step) {
      var sw = 0;
      var s4 = step % 4;
      if (st.swing) sw = s4 === 2 ? st.swing * 2 : (s4 === 1 || s4 === 3) ? st.swing : 0;
      var t = (bar * 16 + step + sw) * stepDur;
      if (hum) t += (hum.next() - 0.5) * 0.016;
      return Math.max(0, t);
    }
    function V(v) { return hum ? clamp(v + (hum.next() - 0.5) * 0.16, 0.05, 1) : v; }

    function chordDegs(info) {
      var d = [info.deg, info.deg + 2, info.deg + 4];
      if (info.seventh) d.push(info.deg + 6);
      return d;
    }
    function voice(info, center) {
      return chordDegs(info).map(function (d) {
        var m = degToMidi(60 + keyPc, scale, d);
        while (m < center - 6) m += 12;
        while (m >= center + 6) m -= 12;
        return m;
      }).sort(function (a, b) { return a - b; });
    }
    function bassNote(info, tone) {
      var d = info.deg + (tone === '5' ? 4 : 0);
      var m = degToMidi(bassBase, scale, d);
      while (m > bassBase + 9) m -= 12;
      if (tone === 'o') m += 12;
      return m;
    }

    // Choose patterns per section type so repeats sound like the same section.
    var pat = {};
    ['intro', 'A', 'B', 'outro'].forEach(function (type) {
      var dp = st.drums ? DRUM_PATTERNS[st.drums] : null;
      pat[type] = {
        drums: dp ? {
          kick: dp.kick ? gr.pick(dp.kick) : null,
          snare: dp.snare ? gr.pick(dp.snare) : null,
          clap: dp.clap ? gr.pick(dp.clap) : null,
          hat: dp.hat ? gr.pick(dp.hat) : null,
          open: dp.open ? gr.pick(dp.open) : null
        } : null,
        bass: gr.pick(BASS_PATTERNS[st.bass]),
        epiano: gr.pick(EPIANO_PATTERNS),
        keys: gr.pick(KEYS_PATTERNS),
        arpShape: gr.pick(['up', 'updown', 'down', 'skip'])
      };
    });

    function drum(bar, step, kind, vel, pan) {
      notes.push({ t: T(bar, step), d: stepDur, midi: { kick: 36, snare: 38, clap: 39, hat: 42, open: 46, crash: 49 }[kind], vel: V(vel), inst: 'drums', drum: kind, kit: st.kit, pan: pan || 0 });
    }
    function velOf(ch) { return ch === 'x' ? 1 : ch === 'o' ? 0.55 : 0; }

    for (var bar = 0; bar < bars; bar++) {
      var info = barInfo[bar];
      var parts = info.parts;
      var type = info.sec.type;
      var P = pat[type];
      var lastOfSong = bar === bars - 1;
      var nextSec = info.j === info.sec.bars - 1 ? sections[info.secIndex + 1] : null;

      if (!info.cont) {
        chords.push({ bar: bar, time: T(bar, 0), name: chordName(keyPc, scale, info.deg, info.seventh, names), degree: info.deg });
      }

      // Drums --------------------------------------------------------------
      if (st.drums && parts.drums && P.drums) {
        var D = P.drums;
        var fill = parts.drums === 'full' && nextSec && st.drums !== 'lofi' && info.sec.bars >= 8;
        var light = parts.drums === 'light';
        for (var s = 0; s < 16; s++) {
          if (fill && s >= 12) {
            drum(bar, s, st.drums === 'dance' ? 'clap' : 'snare', 0.45 + (s - 12) * 0.18, 0);
            if (s === 12 && D.kick && velOf(D.kick[s])) drum(bar, s, 'kick', 1);
            continue;
          }
          if (D.kick && velOf(D.kick[s]) && (!light || st.drums === 'dance' && info.j >= 2)) drum(bar, s, 'kick', velOf(D.kick[s]));
          if (!light) {
            if (D.snare && velOf(D.snare[s])) drum(bar, s, 'snare', velOf(D.snare[s]), 0.05);
            if (D.clap && velOf(D.clap[s])) drum(bar, s, 'clap', velOf(D.clap[s]), 0.05);
          }
          var openHere = D.open && velOf(D.open[s]);
          if (openHere && !light) drum(bar, s, 'open', 0.7, -0.25);
          else if (D.hat && velOf(D.hat[s])) drum(bar, s, 'hat', velOf(D.hat[s]) * (light ? 0.6 : 0.85), -0.25);
        }
      }
      if (st.drums && info.j === 0 && (type === 'B' || type === 'outro' || (type === 'A' && info.secIndex > 0 && sections[info.secIndex - 1].type === 'intro'))) {
        drum(bar, 0, 'crash', 0.8, 0.3);
      }

      // Bass --------------------------------------------------------------
      if (parts.bass && !info.cont) {
        var bp = parts.bass === 'long' ? BASS_PATTERNS.long[0] : P.bass;
        var span = st.chordBars > 1 && parts.bass !== 'long' ? st.chordBars : 1;
        bp.forEach(function (e) {
          var len = (e[1] === 16 ? 16 * span : e[1]);
          if (lastOfSong) len = Math.max(len, 16);
          notes.push({ t: T(bar, e[0]), d: len * stepDur * 0.92, midi: bassNote(info, e[2]), vel: V(e[3]), inst: 'bass', patch: st.bassPatch });
        });
      }

      // Final bar of an ending: one sustained chord
      if (parts.end && lastOfSong) {
        var endPatch = st.pad || (st.chords === 'epiano' ? 'epiano' : 'pad');
        voice(info, chordCenter).forEach(function (m, i) {
          notes.push({ t: T(bar, 0) + i * (st.chords === 'epiano' ? 0.02 : 0), d: barDur, midi: m, vel: 0.8, inst: 'chords', patch: endPatch });
        });
        continue;
      }

      // Chords ------------------------------------------------------------
      if (parts.chords && st.chords && !info.cont) {
        var vc = voice(info, chordCenter);
        if (st.chords === 'epiano') {
          var ep = type === 'outro' ? [[0, 16, 0.9]] : P.epiano;
          ep.forEach(function (e) {
            vc.forEach(function (m, i) {
              notes.push({ t: T(bar, e[0]) + i * 0.013, d: e[1] * stepDur * 0.95, midi: m, vel: V(e[2] * 0.85), inst: 'chords', patch: 'epiano' });
            });
          });
        } else if (st.chords === 'keys') {
          var kp = type === 'outro' || type === 'intro' ? [[0, 16, 0.9]] : P.keys;
          kp.forEach(function (e) {
            vc.forEach(function (m) {
              notes.push({ t: T(bar, e[0]), d: e[1] * stepDur * 0.9, midi: m, vel: e[2], inst: 'chords', patch: 'keys' });
            });
          });
        } else if (st.chords === 'chiparp') {
          var tones = vc.slice(0, 3);
          var rate = type === 'intro' || type === 'outro' ? 2 : 1;
          for (var cs = 0; cs < 16; cs += rate) {
            var k = (cs / rate) % tones.length;
            notes.push({ t: T(bar, cs), d: stepDur * rate * 0.9, midi: tones[k], vel: 0.8, inst: 'chords', patch: 'chipArp' });
          }
        }
      }

      // Pad ------------------------------------------------------------------
      if (parts.pad && st.pad && !info.cont) {
        voice(info, chordCenter).forEach(function (m) {
          notes.push({ t: T(bar, 0), d: barDur * st.chordBars, midi: m, vel: 0.8, inst: 'chords', patch: st.pad });
        });
      }

      // Arpeggio -------------------------------------------------------------
      if (parts.arp && st.arp) {
        var at = voice(info, arpCenter);
        var seq;
        switch (P.arpShape) {
          case 'down': seq = at.slice().reverse(); break;
          case 'updown': seq = at.concat(at.slice(1, -1).reverse()); break;
          case 'skip': seq = at.filter(function (_, i) { return i % 2 === 0; }).concat(at.filter(function (_, i) { return i % 2 === 1; })); break;
          default: seq = at;
        }
        if (st.arp === 'bell') {
          for (var as = 0; as < 16; as += 2) {
            if (gr.chance(0.4)) notes.push({ t: T(bar, as), d: stepDur * 4, midi: gr.pick(at) + 12, vel: 0.5 + gr.next() * 0.4, inst: 'arp', patch: st.arpPatch });
          }
        } else {
          var step = st.arp === 'sixteenths' ? 1 : 2;
          for (var ar = 0, ai = 0; ar < 16; ar += step, ai++) {
            notes.push({ t: T(bar, ar), d: stepDur * step * 0.8, midi: seq[ai % seq.length], vel: ar % 4 === 0 ? 0.9 : 0.6, inst: 'arp', patch: st.arpPatch });
          }
        }
      }
    }

    // Melody --------------------------------------------------------------
    var motifs = {};
    var lo = st.melody.center[0] - 3, hi = st.melody.center[1] + 5;
    sections.forEach(function (sec) {
      if (!PARTS[sec.type].lead) return;
      if (!motifs[sec.type]) motifs[sec.type] = makeMotif(R('motif-' + sec.type), st.melody);
      var M = motifs[sec.type];
      var center = sec.type === 'B' ? st.melody.center[1] : st.melody.center[0];
      var phrases = Math.floor(sec.bars / 2);
      var prev = null;
      for (var p = 0; p < phrases; p++) {
        var isEnd = p === phrases - 1;
        var bar2 = isEnd ? M.end : (p % 2 === 0 ? M.bar2 : M.bar2b);
        var bar1 = M.bar1;
        var rhythms = [bar1, bar2];
        prev = null;
        for (var b = 0; b < 2; b++) {
          var barIdx = sec.startBar + p * 2 + b;
          var info = barInfo[barIdx];
          var rh = rhythms[b];
          for (var i = 0; i < rh.length; i++) {
            var n = rh[i];
            var d;
            if (prev === null) {
              d = nearestChordTone(center + M.offset, info, 0, lo, hi);
            } else {
              var mv = n.move;
              d = prev + mv;
              if (d > hi || d < lo) d = prev - mv;
              var strong = n.s % 4 === 0 || n.len >= 4;
              if (strong) d = nearestChordTone(d, info, mv, lo, hi);
            }
            if (isEnd && b === 1 && i === rh.length - 1) {
              d = nearestTonic(d, lo, hi);
            }
            var vel = (n.s % 4 === 0 ? 0.9 : 0.72) + (n.s === 0 ? 0.1 : 0);
            notes.push({ t: T(barIdx, n.s), d: n.len * stepDur * 0.97, midi: degToMidi(leadBase, scale, d), vel: V(vel), inst: 'lead', patch: st.lead });
            prev = d;
          }
        }
      }
    });

    function nearestChordTone(d, info, dir, lo, hi) {
      var tones = chordDegs(info).map(function (x) { return ((x % 7) + 7) % 7; });
      var order = dir >= 0 ? [0, 1, -1, 2, -2, 3, -3] : [0, -1, 1, -2, 2, -3, 3];
      for (var i = 0; i < order.length; i++) {
        var c = d + order[i];
        if (c < lo - 1 || c > hi + 1) continue;
        if (tones.indexOf(((c % 7) + 7) % 7) >= 0) return c;
      }
      return d;
    }
    function nearestTonic(d, lo, hi) {
      var best = d, bd = 99;
      for (var c = lo - 3; c <= hi + 3; c++) {
        if (((c % 7) + 7) % 7 === 0 && Math.abs(c - d) < bd) { bd = Math.abs(c - d); best = c; }
      }
      return best;
    }

    notes.sort(function (a, b) { return a.t - b.t; });

    var body = bars * barDur;
    var tail = loop ? 0 : st.fx.tail;
    var tr = R('title');
    return {
      version: VERSION,
      title: tr.pick(TITLE_A) + ' ' + tr.pick(TITLE_B),
      seed: seed,
      style: styleName,
      bpm: bpm,
      key: names[keyPc],
      mode: modeName,
      bars: bars,
      loop: loop,
      stepDuration: stepDur,
      barDuration: barDur,
      duration: body + tail,
      loopEnd: body,
      sections: sections.map(function (s) { return { type: s.type, startBar: s.startBar, bars: s.bars, start: s.start }; }),
      chords: chords,
      notes: notes
    };
  }

  function makeMotif(rng, m) {
    function rhythm(which) {
      var g = m.grid, on = [];
      for (var s = 0; s < 16; s += g) {
        var p = m.density + (s % 8 === 0 ? 0.3 : s % 4 === 0 ? 0.1 : -0.08);
        if (which === 1 && s >= 12) p -= 0.35;
        if (rng.chance(p)) on.push(s);
        else if (g === 2 && rng.chance(m.sixteenths)) on.push(s + 1);
      }
      if (on.length < 2) on = g === 4 ? [0, 8] : [0, 6];
      return finish(on, which === 1);
    }
    function finish(on, breathe) {
      var out = [];
      for (var i = 0; i < on.length; i++) {
        var next = i + 1 < on.length ? on[i + 1] : 16;
        var gap = next - on[i];
        var len = Math.max(1, Math.round(gap * m.legato));
        if (i === on.length - 1 && breathe) len = Math.min(len, 4);
        out.push({ s: on[i], len: len, move: move() });
      }
      return out;
    }
    function move() {
      var r = rng.next();
      var size = r < 0.16 ? 0 : r < 0.6 ? 1 : r < 0.84 ? 2 : r < 0.95 ? 3 : 4;
      return size * rng.sign();
    }
    var cadences = m.grid === 4
      ? [[0, 16], [0, 8, 8]]
      : [[0, 4], [0, 2, 4], [0, 6], [0], [0, 3, 6]];
    var cad = rng.pick(cadences);
    var end = cad.map(function (s, i) {
      var next = i + 1 < cad.length ? cad[i + 1] : 16;
      return { s: s, len: i === cad.length - 1 ? Math.min(16 - s, 12) : next - s, move: move() };
    });
    return { bar1: rhythm(0), bar2: rhythm(1), bar2b: rhythm(1), end: end, offset: rng.pick([0, 0, 2, -2, 4]) };
  }

  // ---------------------------------------------------------------------------
  // Synthesis
  // ---------------------------------------------------------------------------
  function polyblep(t, dt) {
    if (t < dt) { t /= dt; return t + t - t * t - 1; }
    if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
    return 0;
  }

  function Svf() { this.ic1 = 0; this.ic2 = 0; }
  function svfCoefs(fc, q, sr, out) {
    var g = Math.tan(Math.PI * Math.min(Math.max(fc, 20), sr * 0.45) / sr);
    var k = 1 / q;
    var a1 = 1 / (1 + g * (g + k));
    out[0] = a1; out[1] = g * a1; out[2] = g * g * a1; out[3] = k;
  }
  // mode: 0 = lowpass, 1 = bandpass, 2 = highpass
  Svf.prototype.run = function (x, c, mode) {
    var v3 = x - this.ic2;
    var v1 = c[0] * this.ic1 + c[1] * v3;
    var v2 = this.ic2 + c[1] * this.ic1 + c[2] * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return mode === 0 ? v2 : mode === 1 ? v1 : x - c[3] * v1 - v2;
  };

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function renderSynth(ctx, n, P) {
    var sr = ctx.sr;
    var start = Math.round(n.t * sr);
    if (start >= ctx.len) return;
    var dur = n.d;
    var total = Math.min(Math.ceil((dur + P.r) * sr), ctx.len - start);
    var f0 = mtof(n.midi);
    var U = P.unison || 1;
    var ph = new Float64Array(U), ratio = new Float64Array(U), gL = new Float64Array(U), gR = new Float64Array(U);
    for (var v = 0; v < U; v++) {
      var spread = U > 1 ? v / (U - 1) - 0.5 : 0;
      ratio[v] = Math.pow(2, (spread * 2 * (P.detune || 0)) / 1200);
      ph[v] = ctx.rand01();
      var vp = clamp(spread * 1.3, -1, 1);
      gL[v] = Math.cos((vp + 1) * Math.PI / 4);
      gR[v] = Math.sin((vp + 1) * Math.PI / 4);
    }
    var pan = clamp((P.pan || 0) + (n.pan || 0), -1, 1);
    var panL = Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2;
    var panR = Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
    var amp = P.gain * (0.35 + 0.65 * n.vel);
    var bus = ctx.music;
    var L = bus.L, Rr = bus.R, rev = ctx.rev, dly = ctx.dly;
    var revS = (P.rev || 0), dlyS = (P.dly || 0);

    var aSamp = Math.max(1, P.a * sr);
    var dMul = Math.exp(-1 / (Math.max(P.d, 0.001) / 4 * sr));
    var rMul = Math.exp(-1 / (Math.max(P.r, 0.001) / 5 * sr));
    var S = P.s;
    var env = 0;
    var durS = dur * sr;

    var useFilter = P.cutoff > 0;
    var fL = new Svf(), fR = new Svf(), coef = [0, 0, 0, 0];
    var q = 0.7 + (P.res || 0) * 6;
    var fenv = 1, fMul = Math.exp(-1 / ((P.fd || 0.3) * sr));
    var keyTrack = Math.pow(f0 / 261.6, 0.5);

    var fm = P.wave === 'fm';
    var phm = ctx.rand01(), ienv = 1, iMul = Math.exp(-1 / ((P.idecay || 0.5) * sr));
    var vibf = 1;
    var pw = P.pw || 0.5;

    for (var i = 0; i < total; i++) {
      // envelope
      if (i < durS) {
        if (i < aSamp) env = i / aSamp;
        else env = S + (env - S) * dMul;
      } else {
        env *= rMul;
      }
      if ((i & 15) === 0) {
        var t = i / sr;
        if (P.vib) vibf = 1 + 0.0578 * P.vib * Math.sin(TAU * 5.3 * t) * Math.min(1, t / 0.35);
        if (useFilter) svfCoefs((P.cutoff + (P.env || 0) * fenv * n.vel) * keyTrack, q, sr, coef);
      }
      fenv *= fMul;

      var sL = 0, sR = 0, s;
      var f = f0 * vibf;
      if (fm) {
        var dt0 = f / sr;
        ph[0] += dt0; if (ph[0] >= 1) ph[0] -= 1;
        phm += dt0 * P.ratio; if (phm >= 1) phm -= 1;
        s = Math.sin(TAU * ph[0] + P.index * ienv * Math.sin(TAU * phm));
        ienv *= iMul;
        sL = s; sR = s;
      } else {
        for (v = 0; v < U; v++) {
          var dt = f * ratio[v] / sr;
          var p = ph[v] + dt; if (p >= 1) p -= 1; ph[v] = p;
          switch (P.wave) {
            case 'saw': s = 2 * p - 1 - polyblep(p, dt); break;
            case 'square': s = (p < pw ? 1 : -1) + polyblep(p, dt) - polyblep((p + 1 - pw) % 1, dt); break;
            case 'tri': s = 1 - 4 * Math.abs(p - 0.5); break;
            case 'ntri': s = Math.round((1 - 4 * Math.abs(p - 0.5)) * 7.5) / 7.5; break;
            case 'sinesat': s = Math.sin(TAU * p); s = s + 0.25 * s * s * s; break;
            default: s = Math.sin(TAU * p);
          }
          sL += s * gL[v]; sR += s * gR[v];
        }
        if (U > 1) { var norm = 1 / Math.sqrt(U); sL *= norm; sR *= norm; }
      }
      if (useFilter) { sL = fL.run(sL, coef, 0); sR = fR.run(sR, coef, 0); }
      var g = env * amp;
      var j = start + i;
      var oL = sL * g * panL, oR = sR * g * panR;
      L[j] += oL; Rr[j] += oR;
      var mono = (oL + oR) * 0.5;
      if (revS) rev[j] += mono * revS;
      if (dlyS) dly[j] += mono * dlyS;
    }
  }

  function renderDrum(ctx, n) {
    var sr = ctx.sr;
    var start = Math.round(n.t * sr);
    if (start >= ctx.len) return;
    var kit = n.kit, kind = n.drum, vel = n.vel;
    var L = ctx.drums.L, R = ctx.drums.R, rev = ctx.rev;
    var pan = n.pan || 0;
    var pl = Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2, pr = Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
    var rnd = ctx.randSigned;
    var lenSec = { kick: 0.5, snare: 0.4, clap: 0.4, hat: 0.12, open: 0.5, crash: 2.5 }[kind] || 0.3;
    var total = Math.min(Math.ceil(lenSec * sr), ctx.len - start);
    var ph = 0, f1 = new Svf(), c = [0, 0, 0, 0], lp = 0, hold = 0, prev = 0;
    var revSend = 0;
    var dg = kit === 'std' ? 0.7 : kit === 'lofi' ? 0.85 : 1;
    var i, t, s, j;

    if (kind === 'hat' || kind === 'open' || kind === 'crash') {
      svfCoefs(kit === 'lofi' ? 6000 : kind === 'crash' ? 5000 : 8000, kit === 'lofi' ? 1.2 : 0.8, sr, c);
    } else if (kind === 'clap') svfCoefs(1400, 1.6, sr, c);
    else if (kind === 'snare') svfCoefs(kit === 'lofi' ? 2500 : 4000, 0.7, sr, c);

    var holdN = kind === 'snare' ? Math.round(sr / 7000) : Math.round(sr / 18000);
    for (i = 0; i < total; i++) {
      t = i / sr;
      s = 0;
      if (kit === 'chip') {
        if (kind === 'kick') {
          ph += (55 + 320 * Math.exp(-t / 0.018)) / sr;
          s = ((ph % 1) < 0.5 ? 0.5 : -0.5) * Math.exp(-t / 0.07);
        } else {
          if (i % Math.max(1, holdN) === 0) hold = rnd();
          var tau = kind === 'snare' ? 0.07 : kind === 'crash' ? 0.5 : kind === 'open' ? 0.12 : 0.025;
          s = hold * Math.exp(-t / tau) * (kind === 'snare' ? 0.45 : 0.22);
        }
      } else if (kind === 'kick') {
        var soft = kit === 'lofi';
        ph += ((soft ? 48 : 44) + (soft ? 90 : 120) * Math.exp(-t / (soft ? 0.045 : 0.032))) / sr;
        s = Math.sin(TAU * ph) * Math.exp(-t / (soft ? 0.13 : 0.18));
        if (t < 0.004) s += rnd() * 0.25 * (1 - t / 0.004) * (soft ? 0.3 : 1);
        s = Math.tanh(s * 1.6) * 0.95;
      } else if (kind === 'snare') {
        ph += (185 + 60 * Math.exp(-t / 0.01)) / sr;
        var tone = Math.sin(TAU * ph) * Math.exp(-t / 0.045) * 0.5;
        var nz = f1.run(rnd(), c, kit === 'lofi' ? 0 : 2) * Math.exp(-t / (kit === 'lofi' ? 0.11 : 0.085));
        s = (tone + nz * 0.8) * 0.75;
        revSend = kit === 'lofi' ? 0.22 : 0.15;
      } else if (kind === 'clap') {
        var e = 0;
        for (var k = 0; k < 3; k++) { var tk = t - k * 0.011; if (tk >= 0) e = Math.max(e, Math.exp(-tk / 0.005)); }
        if (t > 0.022) e = Math.max(e, 0.6 * Math.exp(-(t - 0.022) / 0.1));
        s = f1.run(rnd(), c, 1) * e * 1.6;
        revSend = 0.25;
      } else {
        var decay = kind === 'hat' ? (kit === 'lofi' ? 0.03 : 0.022) : kind === 'open' ? 0.14 : 0.7;
        var raw = rnd();
        var hp = raw - prev; prev = raw;
        s = f1.run(hp, c, kit === 'lofi' ? 1 : 2) * Math.exp(-t / decay) * (kind === 'crash' ? 0.35 : 0.3);
        revSend = kind === 'crash' ? 0.4 : 0.05;
      }
      if (kit === 'lofi') { lp += 0.35 * (s - lp); s = lp; }
      s *= vel * dg;
      j = start + i;
      L[j] += s * pl; R[j] += s * pr;
      if (revSend) rev[j] += s * revSend;
    }
  }

  function freeverb(input, sr, room, damp) {
    var scale = sr / 44100;
    var combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
    var apT = [556, 441, 341, 225];
    var feedback = room * 0.28 + 0.7;
    var damp1 = damp * 0.4, damp2 = 1 - damp1;
    function mkComb(n) { return { buf: new Float32Array(Math.max(1, Math.round(n * scale))), i: 0, store: 0 }; }
    function mkAp(n) { return { buf: new Float32Array(Math.max(1, Math.round(n * scale))), i: 0 }; }
    var cl = combT.map(mkComb), cr = combT.map(function (n) { return mkComb(n + 23); });
    var al = apT.map(mkAp), ar = apT.map(function (n) { return mkAp(n + 23); });
    var N = input.length;
    var outL = new Float32Array(N), outR = new Float32Array(N);
    function comb(c, x) {
      var o = c.buf[c.i];
      c.store = o * damp2 + c.store * damp1;
      c.buf[c.i] = x + c.store * feedback;
      if (++c.i >= c.buf.length) c.i = 0;
      return o;
    }
    function ap(a, x) {
      var b = a.buf[a.i];
      a.buf[a.i] = x + b * 0.5;
      if (++a.i >= a.buf.length) a.i = 0;
      return b - x;
    }
    for (var i = 0; i < N; i++) {
      var x = input[i] * 0.015;
      var sl = 0, sr2 = 0, k;
      for (k = 0; k < 8; k++) { sl += comb(cl[k], x); sr2 += comb(cr[k], x); }
      for (k = 0; k < 4; k++) { sl = ap(al[k], sl); sr2 = ap(ar[k], sr2); }
      outL[i] = sl * 3; outR[i] = sr2 * 3;
    }
    return [outL, outR];
  }

  function feedbackDelay(input, delaySamples, fb, damp) {
    var N = input.length, out = new Float32Array(N), lp = 0;
    for (var i = delaySamples; i < N; i++) {
      var v = input[i - delaySamples] + fb * out[i - delaySamples];
      lp += damp * (v - lp);
      out[i] = lp;
    }
    return out;
  }

  /**
   * Render a composed song to a WAV file.
   * @param {object} song                 Result of compose().
   * @param {object} [opts]
   * @param {number} [opts.sampleRate]    Default 44100.
   * @returns {ArrayBuffer} 16-bit stereo PCM WAV
   */
  function render(song, opts) {
    var ch = renderChannels(song, opts);
    return encodeWAV(ch[0], ch[1], ch.sampleRate);
  }

  function renderChannels(song, opts) {
    opts = opts || {};
    var sr = Math.round(opts.sampleRate || 44100);
    if (sr < 8000 || sr > 96000) throw new Error('music-composition.js: sampleRate must be between 8000 and 96000');
    var st = STYLES[song.style];
    var fx = st.fx;
    var body = song.loopEnd;
    var N = Math.ceil((body + Math.max(fx.tail, song.loop ? 4 : 0)) * sr) + 1;

    var state = hashString(song.seed + '/noise') || 1;
    function rand01() {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      return (state >>> 0) / 4294967296;
    }
    var ctx = {
      sr: sr, len: N,
      music: { L: new Float32Array(N), R: new Float32Array(N) },
      drums: { L: new Float32Array(N), R: new Float32Array(N) },
      rev: new Float32Array(N), dly: new Float32Array(N),
      rand01: rand01,
      randSigned: function () { return rand01() * 2 - 1; }
    };

    var notes = song.notes;
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      if (n.inst === 'drums') renderDrum(ctx, n);
      else renderSynth(ctx, n, PATCHES[n.patch]);
    }
    // Effects
    var step = song.stepDuration;
    var dl = feedbackDelay(ctx.dly, Math.round(step * 3 * sr), 0.38, 0.45);
    var dr = feedbackDelay(ctx.dly, Math.round(step * 4 * sr), 0.32, 0.4);
    var rv = freeverb(ctx.rev, sr, fx.room, fx.damp);

    var L = new Float32Array(N), R = new Float32Array(N);
    var duck = null;
    if (fx.sidechain) {
      duck = new Float32Array(N).fill(1);
      var dLen = Math.round(0.3 * sr);
      notes.forEach(function (nn) {
        if (nn.drum !== 'kick') return;
        var s0 = Math.round(nn.t * sr);
        for (var k = 0; k < dLen && s0 + k < N; k++) {
          var g = 1 - fx.sidechain * Math.exp(-k / (0.09 * sr));
          if (g < duck[s0 + k]) duck[s0 + k] = g;
        }
      });
    }
    var wet = fx.wet, dw = 0.5 * fx.delay;
    for (i = 0; i < N; i++) {
      var mL = ctx.music.L[i] + rv[0][i] * wet + dl[i] * dw;
      var mR = ctx.music.R[i] + rv[1][i] * wet + dr[i] * dw;
      if (duck) { mL *= duck[i]; mR *= duck[i]; }
      L[i] = mL + ctx.drums.L[i];
      R[i] = mR + ctx.drums.R[i];
    }

    if (fx.lofi) {
      var a = 1 - Math.exp(-TAU * 4200 / sr);
      var lpL = 0, lpR = 0, click = 0, hiss = 0;
      for (i = 0; i < N; i++) {
        lpL += a * (L[i] - lpL); lpR += a * (R[i] - lpR);
        if (rand01() < 5 / sr) click = (rand01() * 0.12 + 0.03) * (rand01() < 0.5 ? -1 : 1);
        click *= 0.55;
        hiss += 0.08 * ((rand01() * 2 - 1) - hiss);
        var noise = click + hiss * 0.012;
        L[i] = lpL + noise; R[i] = lpR + noise;
      }
    }

    // Loop: fold everything that rings past the loop point back onto the start
    var outLen = N;
    if (song.loop) {
      outLen = Math.round(body * sr);
      for (i = outLen; i < N && i - outLen < outLen; i++) {
        L[i - outLen] += L[i];
        R[i - outLen] += R[i];
      }
    }

    L = L.subarray(0, outLen); R = R.subarray(0, outLen);

    // Master: DC block, normalise, soft clip
    var xl = 0, yl = 0, xr = 0, yr = 0, peak = 1e-9;
    for (i = 0; i < outLen; i++) {
      var nl = L[i] - xl + 0.995 * yl; xl = L[i]; yl = nl; L[i] = nl;
      var nr = R[i] - xr + 0.995 * yr; xr = R[i]; yr = nr; R[i] = nr;
      var ab = Math.abs(nl) > Math.abs(nr) ? Math.abs(nl) : Math.abs(nr);
      if (ab > peak) peak = ab;
    }
    var pre = 1.25 / peak, drive = Math.tanh(1.25);
    var fadeIn = Math.round(0.004 * sr);
    var fadeOut = song.loop ? 0 : Math.round(Math.min(2, fx.tail * 0.6) * sr);
    for (i = 0; i < outLen; i++) {
      var gain = 0.89 / drive;
      if (!song.loop) {
        if (i < fadeIn) gain *= i / fadeIn;
        var fromEnd = outLen - i;
        if (fromEnd < fadeOut) gain *= fromEnd / fadeOut;
      }
      L[i] = Math.tanh(L[i] * pre) * gain;
      R[i] = Math.tanh(R[i] * pre) * gain;
    }
    var result = [L, R];
    result.sampleRate = sr;
    return result;
  }

  // ---------------------------------------------------------------------------
  // WAV encoding
  // ---------------------------------------------------------------------------
  /**
   * Encode float channels (-1..1) as a 16-bit PCM WAV.
   * @param {Float32Array} left
   * @param {Float32Array} [right]  omit for mono
   * @param {number} sampleRate
   * @returns {ArrayBuffer}
   */
  function encodeWAV(left, right, sampleRate) {
    var chs = right ? 2 : 1;
    var n = left.length;
    var dataBytes = n * chs * 2;
    var buf = new ArrayBuffer(44 + dataBytes);
    var v = new DataView(buf);
    function str(off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, chs, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * chs * 2, true);
    v.setUint16(32, chs * 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, dataBytes, true);
    var off = 44;
    for (var i = 0; i < n; i++) {
      var s = left[i] < -1 ? -1 : left[i] > 1 ? 1 : left[i];
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2;
      if (right) {
        s = right[i] < -1 ? -1 : right[i] > 1 ? 1 : right[i];
        v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2;
      }
    }
    return buf;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Compose and render in one call (synchronous).
   * @param {object} [options]  See compose(). Also accepts sampleRate.
   * @returns {ArrayBuffer} WAV file bytes
   */
  function generate(options) {
    var song = compose(options);
    return render(song, options);
  }

  // Worker support: generateAsync() renders off the main thread when this file
  // was loaded from a <script src>. Falls back to the main thread otherwise.
  var SCRIPT_URL = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || null;
  var worker = null, workerBroken = false, jobs = {}, jobId = 0;

  function getWorker() {
    if (workerBroken || !SCRIPT_URL || typeof Worker === 'undefined') return null;
    if (worker) return worker;
    try {
      worker = new Worker(SCRIPT_URL);
    } catch (e) {
      workerBroken = true;
      return null;
    }
    worker.onmessage = function (e) {
      var d = e.data;
      if (!d || !d.__mc || !jobs[d.id]) return;
      var job = jobs[d.id]; delete jobs[d.id];
      if (d.error) job.reject(new Error(d.error)); else job.resolve(d.wav);
    };
    worker.onerror = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      workerBroken = true;
      worker = null;
      Object.keys(jobs).forEach(function (id) {
        var job = jobs[id]; delete jobs[id];
        try { job.resolve(render(job.song, job.opts)); } catch (err) { job.reject(err); }
      });
    };
    return worker;
  }

  /**
   * Render a song without blocking the page (uses a Web Worker when possible).
   * @returns {Promise<ArrayBuffer>}
   */
  function renderAsync(song, opts) {
    return new Promise(function (resolve, reject) {
      var w = getWorker();
      if (!w) {
        setTimeout(function () {
          try { resolve(render(song, opts)); } catch (e) { reject(e); }
        }, 0);
        return;
      }
      var id = ++jobId;
      jobs[id] = { resolve: resolve, reject: reject, song: song, opts: opts };
      w.postMessage({ __mc: 1, id: id, song: song, opts: { sampleRate: opts && opts.sampleRate } });
    });
  }

  /**
   * Compose and render without blocking the page.
   * @returns {Promise<ArrayBuffer>}
   */
  function generateAsync(options) {
    try { return renderAsync(compose(options), options); }
    catch (e) { return Promise.reject(e); }
  }

  function toBlob(wav) { return new Blob([wav], { type: 'audio/wav' }); }
  function toURL(wav) { return URL.createObjectURL(toBlob(wav)); }

  // Running inside a Worker that loaded this file directly: answer render jobs.
  if (typeof document === 'undefined' && typeof self !== 'undefined' && typeof self.postMessage === 'function' &&
      typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
    self.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || !d.__mc) return;
      try {
        var wav = render(d.song, d.opts);
        self.postMessage({ __mc: 1, id: d.id, wav: wav }, [wav]);
      } catch (err) {
        self.postMessage({ __mc: 1, id: d.id, error: String(err && err.message || err) });
      }
    });
  }

  return {
    version: VERSION,
    generate: generate,
    generateAsync: generateAsync,
    compose: compose,
    render: render,
    renderAsync: renderAsync,
    encodeWAV: encodeWAV,
    toBlob: toBlob,
    toURL: toURL,
    styles: STYLE_NAMES.slice(),
    modes: Object.keys(MODES),
    keys: NOTE_NAMES.slice()
  };
}));
