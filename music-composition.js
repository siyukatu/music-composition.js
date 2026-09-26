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

  var VERSION = '1.0.0-beta.1';
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

  var HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];
  var MELODIC_MINOR = [0, 2, 3, 5, 7, 9, 11];
  // Chords borrowed from the parallel mode (modal interchange): degree -> scale.
  var BORROW_FROM = {
    major: { 3: MODES.minor, 5: MODES.minor, 6: MODES.minor },      // iv, bVI, bVII
    mixolydian: { 3: MODES.minor, 5: MODES.minor },                 // iv, bVI
    lydian: { 5: MODES.minor, 6: MODES.minor },                     // bVI, bVII
    minor: { 3: MODES.dorian, 4: HARMONIC_MINOR },                  // IV, V
    dorian: { 4: MELODIC_MINOR, 5: MODES.minor }                    // V, bVI
  };
  // Where harmony tends to go next (weights), by mode family. Degrees are 0-based.
  var MARKOV = {
    major: { 0: { 3: 5, 4: 4, 5: 5, 1: 3, 2: 1 }, 1: { 4: 6, 3: 1, 2: 1 }, 2: { 5: 5, 3: 4, 1: 1 },
      3: { 4: 4, 0: 3, 1: 1.5, 5: 1, 2: 0.5 }, 4: { 0: 5, 5: 2.5, 3: 1.5 }, 5: { 3: 4, 1: 3, 4: 2, 2: 1 } },
    minor: { 0: { 5: 3, 3: 3, 6: 2.5, 2: 1, 4: 1.5 }, 2: { 5: 3, 6: 2, 3: 3, 0: 1 }, 3: { 4: 3, 0: 2.5, 6: 2.5, 5: 1 },
      4: { 0: 6, 5: 3 }, 5: { 6: 3.5, 3: 2.5, 2: 2, 4: 2 }, 6: { 0: 3.5, 2: 3.5, 5: 2 } },
    dorian: { 0: { 3: 5, 6: 3, 1: 2, 4: 1 }, 1: { 4: 2, 0: 2, 3: 2 }, 2: { 3: 3, 6: 2, 0: 1 }, 3: { 0: 4, 6: 2, 4: 2, 1: 1 },
      4: { 0: 3, 3: 2 }, 6: { 0: 3, 3: 3, 2: 1 } },
    mixolydian: { 0: { 6: 5, 3: 4, 4: 1, 1: 1 }, 1: { 6: 2, 3: 2, 0: 1 }, 3: { 0: 4, 6: 2, 4: 1 }, 4: { 3: 2, 0: 2 },
      5: { 6: 2, 3: 2 }, 6: { 3: 4, 0: 4, 5: 1 } },
    lydian: { 0: { 1: 6, 4: 2, 5: 2 }, 1: { 0: 5, 4: 1, 2: 1 }, 2: { 1: 2, 5: 2 }, 4: { 0: 3, 5: 2, 1: 1 }, 5: { 1: 3, 4: 2, 0: 1 } }
  };

  // A chord is a root scale degree plus the scale it lives in: the key's own
  // scale, or an altered one for borrowed and secondary chords. Melodies are
  // written in scale degrees and sound through the chord's scale, so they
  // follow chromatic harmony (a G# over E7 in C major, an Ab over Fm).
  function makeChord(deg, scale, extra) {
    var c = { deg: ((deg % 7) + 7) % 7, scale: scale, tones: [0, 2, 4], bass: 0, shift: 0, kind: 'dia' };
    for (var k in extra) c[k] = extra[k];
    return c;
  }
  function withProps(c, extra) {
    var o = {};
    for (var k in c) o[k] = c[k];
    for (k in extra) o[k] = extra[k];
    return o;
  }
  // Semitones above the (unshifted) key's tonic for scale degree d under chord c.
  function chordPitch(c, d) {
    var oct = Math.floor(d / 7);
    return oct * 12 + c.scale[d - oct * 7] + c.shift;
  }
  function isChordDeg(c, d) {
    var m = ((d - c.deg) % 7 + 7) % 7;
    for (var i = 0; i < c.tones.length; i++) if (c.tones[i] % 7 === m) return true;
    return false;
  }
  function sameChord(a, b) {
    return a.deg === b.deg && a.shift === b.shift && a.scale.join() === b.scale.join() && a.tones.join() === b.tones.join() && a.bass === b.bass;
  }
  // V(7) of `target`: the key's scale with the chord's 3rd, 5th and 7th adjusted.
  function secondaryDominant(scale, target, seventh) {
    var r = (target + 4) % 7, s = scale.slice(), root = scale[r];
    [[2, 4], [4, 7], [6, 10]].forEach(function (p) {
      var idx = r + p[0];
      s[idx % 7] = root + p[1] - (idx >= 7 ? 12 : 0);
    });
    return makeChord(r, s, { tones: seventh ? [0, 2, 4, 6] : [0, 2, 4], kind: 'sec' });
  }

  var LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  var LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
  // Spell pitch class pc as scale degree `deg` of the key whose tonic is `tonicName`
  // (so bVII in C is Bb, the 3rd of E7 is G#).
  function spell(tonicName, deg, pc) {
    var li = (LETTERS.indexOf(tonicName.charAt(0)) + ((deg % 7) + 7) % 7) % 7;
    var acc = ((pc - LETTER_PC[li]) % 12 + 18) % 12 - 6;
    if (acc < -2 || acc > 2) return NOTE_NAMES[((pc % 12) + 12) % 12];
    return LETTERS[li] + (acc > 0 ? '##'.slice(0, acc) : 'bb'.slice(0, -acc));
  }
  function chordName(c, tonicName, keyPc) {
    var iv = function (t) { return ((chordPitch(c, c.deg + t) - chordPitch(c, c.deg)) % 12 + 12) % 12; };
    var has = function (t) { return c.tones.indexOf(t) >= 0; };
    var pc = function (d) { return ((keyPc + chordPitch(c, d)) % 12 + 12) % 12; };
    var name = spell(tonicName, c.deg, pc(c.deg));
    var third = iv(2), fifth = iv(4), sev = has(6) ? iv(6) : -1;
    var q;
    if (has(3)) q = (sev >= 0 ? '7' : '') + 'sus4';
    else if (has(1)) q = 'sus2';
    else if (third === 4 && fifth === 7) q = sev === 11 ? 'maj7' : sev === 10 ? '7' : has(8) ? 'add9' : '';
    else if (third === 3 && fifth === 7) q = sev === 10 ? 'm7' : sev === 11 ? 'mM7' : has(8) ? 'madd9' : 'm';
    else if (third === 3 && fifth === 6) q = sev === 10 ? 'm7b5' : sev === 9 ? 'dim7' : 'dim';
    else if (third === 4 && fifth === 8) q = 'aug';
    else q = '';
    if (c.bass) name += q + '/' + spell(tonicName, c.deg + c.bass, pc(c.deg + c.bass));
    else name += q;
    return name;
  }
  function wpick(rng, weights) {
    var keys = Object.keys(weights), sum = 0, i;
    for (i = 0; i < keys.length; i++) sum += weights[keys[i]];
    var r = rng.next() * sum;
    for (i = 0; i < keys.length; i++) { r -= weights[keys[i]]; if (r <= 0) return keys[i]; }
    return keys[keys.length - 1];
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
      spice: 0.5, loopProg: 0.5, form: { pre: 0.6, bridge: 0.7, modulate: 0.5 }, expr: { bend: 0.2, ghost: 0.3, harmony: true },
      melody: { slow: false, notes: 5, legato: 0.85, center: [3, 6], octave: 0 },
      fx: { room: 0.78, damp: 0.35, wet: 1, delay: 1, sidechain: 0, lofi: false, tail: 3 }
    },
    dance: {
      label: 'Dance', bpm: [118, 128], modes: ['minor', 'minor', 'dorian'],
      chordBars: 1, swing: 0, sevenths: 0.3, humanize: 0,
      drums: 'dance', kit: 'std', bass: 'dance', bassPatch: 'bassSaw', bassOct: 0,
      chords: null, pad: 'padWide', arp: 'sixteenths', arpPatch: 'arp', lead: 'leadPluck',
      spice: 0.3, loopProg: 0.7, form: { pre: 0.6, bridge: 0.4, modulate: 0.25 }, expr: { bend: 0.1, ghost: 0, harmony: true },
      melody: { slow: false, notes: 5, legato: 0.7, center: [3, 6], octave: 0 },
      fx: { room: 0.82, damp: 0.3, wet: 1, delay: 1.2, sidechain: 0.7, lofi: false, tail: 3 }
    },
    lofi: {
      label: 'Lo-fi', bpm: [68, 86], modes: ['dorian', 'minor', 'major'],
      chordBars: 1, swing: 0.3, sevenths: 0.95, humanize: 1,
      drums: 'lofi', kit: 'lofi', bass: 'lofi', bassPatch: 'bassSine', bassOct: 0,
      chords: 'epiano', pad: null, arp: null, lead: 'leadSoft',
      spice: 0.85, loopProg: 0.4, form: { pre: 0.2, bridge: 0.5, modulate: 0 }, expr: { bend: 0.3, ghost: 0.5, harmony: false },
      melody: { slow: false, notes: 4, legato: 0.9, center: [2, 4], octave: 0 },
      fx: { room: 0.7, damp: 0.5, wet: 0.9, delay: 0.6, sidechain: 0, lofi: true, tail: 3 }
    },
    chiptune: {
      label: 'Chiptune', bpm: [128, 160], modes: ['major', 'minor', 'dorian', 'mixolydian'],
      chordBars: 1, swing: 0, sevenths: 0, humanize: 0,
      drums: 'chip', kit: 'chip', bass: 'chip', bassPatch: 'bassChip', bassOct: 12,
      chords: 'chiparp', pad: null, arp: null, lead: 'leadSquare',
      spice: 0.45, loopProg: 0.5, form: { pre: 0.5, bridge: 0.6, modulate: 0.6 }, expr: { bend: 0.25, ghost: 0, harmony: true },
      melody: { slow: false, notes: 6, legato: 0.8, center: [3, 6], octave: 12 },
      fx: { room: 0.5, damp: 0.5, wet: 0.35, delay: 0.5, sidechain: 0, lofi: false, tail: 2 }
    },
    ambient: {
      label: 'Ambient', bpm: [62, 78], modes: ['lydian', 'major', 'dorian', 'minor'],
      chordBars: 2, swing: 0, sevenths: 0.6, humanize: 0,
      drums: null, kit: 'std', bass: 'ambient', bassPatch: 'bassSine', bassOct: 0,
      chords: null, pad: 'padAmbient', arp: 'bell', arpPatch: 'bellSoft', lead: 'bell',
      spice: 0.35, loopProg: 0.5, form: { pre: 0, bridge: 0.5, modulate: 0 }, expr: { bend: 0, ghost: 0, harmony: false },
      melody: { slow: true, notes: 2.5, legato: 1, center: [4, 7], octave: 0 },
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

  // spice: how much chromatic colour (secondary dominants, borrowed chords,
  // appoggiaturas); loopProg: chance of an idiomatic 4-chord loop instead of a
  // functional walk; form: chances of pre-chorus, bridge and a final key change;
  // expr: pitch scoops, ghost notes, a harmony line in the last chorus.

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

  // Melody rhythms, one bar each: [step, length]. Gaps are rests.
  // A section's melody is built from 4-bar phrases: motif, answer, motif, cadence.
  var MELODY_RHYTHMS = {
    motif: [
      [[0, 3], [3, 1], [4, 2], [6, 2], [8, 4], [12, 4]],
      [[0, 3], [3, 3], [6, 4], [10, 2], [12, 4]],
      [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]],
      [[2, 2], [4, 2], [6, 4], [10, 2], [12, 4]],
      [[0, 6], [6, 2], [8, 2], [10, 2], [12, 4]],
      [[0, 2], [2, 4], [6, 2], [8, 2], [10, 6]],
      [[0, 4], [4, 2], [6, 4], [10, 6]],
      [[0, 2], [2, 2], [4, 2], [6, 2], [8, 4], [12, 2], [14, 2]],
      [[0, 1], [1, 1], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 4]],
      [[0, 3], [3, 3], [6, 2], [8, 3], [11, 3], [14, 2]],
      [[0, 4], [6, 2], [8, 4], [12, 4]],
      [[0, 3], [3, 1], [4, 4 / 3], [16 / 3, 4 / 3], [20 / 3, 4 / 3], [8, 4], [12, 4]],   // triplet on beat 2
      [[0, 8 / 3], [8 / 3, 8 / 3], [16 / 3, 8 / 3], [8, 6]]                               // quarter-note triplets
    ],
    answer: [
      [[0, 6], [6, 2], [8, 6]],
      [[0, 4], [4, 4], [8, 6]],
      [[0, 8], [8, 2], [10, 4]],
      [[0, 2], [2, 2], [4, 10]],
      [[0, 3], [3, 3], [6, 8]],
      [[0, 2], [2, 2], [4, 2], [6, 2], [8, 6]],
      [[0, 4], [4, 2], [6, 2], [8, 6]],
      [[0, 3], [3, 1], [4, 2], [6, 2], [8, 6]],
      [[0, 8 / 3], [8 / 3, 8 / 3], [16 / 3, 8 / 3], [8, 6]]
    ],
    cadence: [
      [[0, 12]],
      [[0, 4], [4, 4], [8, 6]],
      [[0, 2], [2, 2], [4, 10]],
      [[0, 3], [3, 1], [4, 8]],
      [[0, 2], [2, 2], [4, 2], [6, 6]]
    ],
    slowMotif: [
      [[0, 8], [8, 4], [12, 4]],
      [[0, 4], [4, 4], [8, 8]],
      [[0, 12], [12, 4]],
      [[0, 6], [6, 2], [8, 8]],
      [[4, 4], [8, 8]]
    ],
    slowAnswer: [[[0, 14]], [[0, 8], [8, 6]], [[0, 4], [4, 10]]],
    slowCadence: [[[0, 14]], [[0, 8], [8, 6]]]
  };

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
   * @param {number} [options.duration]      Target length in seconds, including the reverb tail (used when bars is omitted).
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
    else if (o.duration) bars = Math.round((+o.duration - (loop ? 0 : st.fx.tail)) / barDur / 4) * 4;
    else bars = 32;
    bars = clamp(bars || 32, 8, 256);

    // Registers
    var leadBase = 60 + keyPc - (keyPc >= 6 ? 12 : 0) + st.melody.octave;
    var chordCenter = 64;
    var spice = st.spice;
    var bright = modeName === 'major' || modeName === 'lydian' || modeName === 'mixolydian';
    var isDim = function (deg) {
      var d = ((deg % 7) + 7) % 7;
      return (scale[(d + 4) % 7] - scale[d] + 12) % 12 === 6;
    };
    function tonicName(shift) {
      var pc = ((keyPc + shift) % 12 + 12) % 12;
      return spelling(pc, modeName)[pc];
    }

    // Form -------------------------------------------------------------------
    // Verse (A), pre-chorus (P), chorus (B), bridge (C). Choruses may end in a
    // key change a step up.
    var fr = R('form');
    var usePre = fr.chance(st.form.pre), useBridge = fr.chance(st.form.bridge);
    var LEN = { A: 8, P: 4, B: 8, C: 8 };
    var first = ['A'].concat(usePre ? ['P'] : [], ['B', 'A'], usePre ? ['P'] : [], ['B'], useBridge ? ['C', 'B'] : []);
    var again = ['A'].concat(usePre ? ['P'] : [], ['B']);
    var sections = [];
    var remaining = bars;
    var hasIntroOutro = !loop && bars >= 16;
    if (hasIntroOutro) { remaining -= 8; sections.push({ type: 'intro', bars: 4 }); }
    for (var fi = 0; remaining > 0; fi++) {
      var ftype = fi < first.length ? first[fi] : again[(fi - first.length) % again.length];
      // A pre-chorus or bridge needs a chorus after it; whatever is left becomes (part of) a chorus.
      if ((ftype === 'P' && remaining < 12) || (ftype === 'C' && remaining < 16) || LEN[ftype] > remaining) ftype = 'B';
      var flen = Math.min(LEN[ftype], remaining);
      sections.push({ type: ftype, bars: flen });
      remaining -= flen;
    }
    if (hasIntroOutro) sections.push({ type: 'outro', bars: 4 });
    var chorusIdx = [];
    sections.forEach(function (s, i) { if (s.type === 'B') chorusIdx.push(i); });
    var modAt = -1;
    if (!loop && chorusIdx.length >= 2 && fr.chance(st.form.modulate)) {
      modAt = chorusIdx[chorusIdx.length - 1];
      while (modAt > 0 && sections[modAt - 1].type === 'B') modAt--;
      if (modAt <= chorusIdx[0]) modAt = -1;
    }
    var modShift = fr.chance(0.7) ? 2 : 1;
    var startBar = 0;
    sections.forEach(function (s, i) {
      s.shift = modAt >= 0 && i >= modAt ? modShift : 0;
      s.startBar = startBar; s.start = startBar * barDur; startBar += s.bars;
    });
    var lastChorus = chorusIdx.length ? chorusIdx[chorusIdx.length - 1] : -1;

    // Harmony ----------------------------------------------------------------
    var hr = R('harmony');
    var cb = st.chordBars;
    var sevenths = {};
    function dia(deg) {
      deg = ((deg % 7) + 7) % 7;
      if (sevenths[deg] === undefined) sevenths[deg] = hr.chance(st.sevenths);
      var tones = sevenths[deg] ? [0, 2, 4, 6] : [0, 2, 4];
      // Colour: add9 on stable major chords.
      if (!sevenths[deg] && (deg === 0 || deg === 3) && !isDim(deg) && (scale[(deg + 2) % 7] - scale[deg] + 12) % 12 === 4 && hr.chance(spice * 0.25)) tones = [0, 2, 4, 8];
      return makeChord(deg, scale, { tones: tones });
    }
    function borrowed(deg) {
      var b = BORROW_FROM[modeName][deg];
      return b ? makeChord(deg, b, { kind: 'bor', tones: hr.chance(st.sevenths * 0.5) ? [0, 2, 4, 6] : [0, 2, 4] }) : dia(deg);
    }
    // The chord that pulls to the tonic: V (with a raised leading tone in minor keys).
    function dominant(seventh) {
      // (Lydian's raised 4th would make it Vmaj7; mixolydian's v is minor.)
      var s = modeName === 'mixolydian' || modeName === 'lydian' ? MODES.major : modeName === 'minor' ? HARMONIC_MINOR : modeName === 'dorian' ? MELODIC_MINOR : scale;
      return makeChord(4, s, { tones: seventh ? [0, 2, 4, 6] : [0, 2, 4], kind: s === scale ? 'dia' : 'bor' });
    }
    var pool = (PROGRESSIONS[modeName] || []).concat(bright ? PROGRESSIONS.bright : PROGRESSIONS.dark);
    if (modeName === 'lydian') pool = PROGRESSIONS.lydian.concat(PROGRESSIONS.bright.filter(function (p) { return p.indexOf(3) < 0; }));
    pool = pool.filter(function (p) { return !p.some(isDim); });
    var markov = MARKOV[modeName];
    // A 4-chord progression: an idiomatic loop, or a walk through functional harmony.
    function progression(type, avoid) {
      var degs;
      if ((type === 'A' || type === 'B') && hr.chance(st.loopProg)) {
        degs = hr.pick(pool);
        for (var t = 0; t < 8 && avoid && degs.join() === avoid.join(); t++) degs = hr.pick(pool);
      } else {
        var starts = {
          A: { 0: 1 },
          B: bright ? { 3: 2, 5: 2, 0: 2 } : { 5: 2, 3: 2, 0: 1.5 },
          P: bright ? { 3: 3, 1: 2, 5: 1.5 } : { 3: 3, 5: 2, 6: 1 },
          C: bright ? { 5: 3, 3: 2, 1: 1 } : { 3: 2, 6: 2, 2: 1.5 }
        }[type];
        var ends = { A: { 4: 2, 3: 1.5 }, B: { 4: 2, 3: 1.5, 5: 1 }, P: { 4: 6 }, C: { 4: 5, 3: 1 } }[type];
        degs = [+wpick(hr, filterDeg(starts))];
        for (var i = 1; i < 4; i++) {
          var w = {}, from = markov[degs[i - 1]] || markov[0];
          for (var k in from) if (+k !== degs[i - 1]) w[k] = from[k];
          if (i === 3) for (var e in ends) if (+e !== degs[2]) w[e] = (w[e] || 0.5) * ends[e];
          degs.push(+wpick(hr, filterDeg(w)));
        }
      }
      return degs.map(function (d, i) {
        // A dominant at the end of a phrase gets its leading tone in minor keys.
        if (d === 4 && i === 3 && !bright && hr.chance(0.6)) return dominant(hr.chance(0.5));
        return dia(d);
      });
    }
    function filterDeg(w) {
      var out = {}, any = false;
      for (var k in w) if (!isDim(+k)) { out[k] = w[k]; any = true; }
      return any ? out : { 0: 1 };
    }

    // Per section type: one chord per bar (or per chordBars), then embellished.
    function basePlan(prog, L) {
      var pl = [];
      for (var j = 0; j < L; j++) pl.push({ segs: [{ s: 0, c: prog[Math.floor(j / cb) % prog.length] }], cont: cb > 1 && j % cb !== 0 });
      return pl;
    }
    function embellish(pl) {
      if (cb > 1) return pl;
      var splits = 0;
      for (var j = 0; j < pl.length; j++) {
        var b = pl[j], c = b.segs[0].c, next = j + 1 < pl.length ? pl[j + 1].segs[0].c : null;
        if (b.segs.length > 1) continue;
        // Suspension: Vsus4 resolving to V inside the bar.
        if (c.deg === 4 && hr.chance(0.2 + 0.3 * spice)) {
          var res = bright ? c : dominant(c.tones.indexOf(6) >= 0); // resolve to a real V in minor keys
          b.segs = [{ s: 0, c: withProps(res, { tones: c.tones.indexOf(6) >= 0 ? [0, 3, 4, 6] : [0, 3, 4] }) }, { s: 8, c: res }];
        // Modal interchange: IV turning minor (iv) on its way home.
        } else if (bright && c.deg === 3 && c.kind === 'dia' && BORROW_FROM[modeName][3] && next && next.deg === 0 && hr.chance(0.55 * spice)) {
          b.segs = [{ s: 0, c: c }, { s: 8, c: borrowed(3) }];
        // Secondary dominant: tonicize the next chord for half a bar.
        } else if (next && next.deg !== c.deg && next.deg !== 0 && !isDim(next.deg) && next.kind === 'dia' && splits < pl.length / 4 && hr.chance(0.4 * spice)) {
          // V/IV shares its root with I: only the 7th makes it a dominant.
          var sd = secondaryDominant(scale, next.deg, hr.chance(0.75) || (next.deg + 4) % 7 === c.deg);
          b.segs = [{ s: 0, c: c }, { s: 8, c: sd }];
          splits++;
        }
      }
      // Inversions that turn root leaps into a stepwise bass line (I - V/B - vi).
      var flat = [];
      pl.forEach(function (b) { if (!b.cont) b.segs.forEach(function (sg) { flat.push(sg); }); });
      for (var i = 1; i + 1 < flat.length; i++) {
        var a = flat[i - 1].c, m = flat[i].c, z = flat[i + 1].c;
        if (m.tones.length > 3 || m.kind !== 'dia' || hr.next() > 0.35 + 0.45 * spice) continue;
        var ba = a.deg + a.bass, bz = z.deg + z.bass;
        [2, 4].some(function (off) {
          var bm = m.deg + off;
          var step1 = ((bm - ba) % 7 + 7) % 7, step2 = ((bz - bm) % 7 + 7) % 7;
          if ((step1 === 1 && step2 === 1) || (step1 === 6 && step2 === 6)) { flat[i].c = withProps(m, { bass: off }); return true; }
          return false;
        });
      }
      return pl;
    }
    var progs = {};
    progs.A = progression('A');
    progs.B = progression('B', progs.A.map(function (c) { return c.deg; }));
    if (usePre) progs.P = progression('P');
    if (useBridge) progs.C = progression('C');
    var planCache = {};
    function planFor(type, L) {
      var key = type + L;
      if (!planCache[key]) planCache[key] = embellish(basePlan(progs[type], L));
      return planCache[key].map(function (b) { return { segs: b.segs.map(function (sg) { return { s: sg.s, c: sg.c }; }), cont: b.cont }; });
    }
    function introPlan() { return basePlan(progs.A, 4); }
    function outroPlan() {
      // IV-V-I / VI-VII-i, using the mode's own colour where that degree is diminished
      // (lydian's II instead of #iv, dorian's IV instead of vi).
      var degs = (bright ? [3, 4, 0, 0] : [5, 6, 0, 0]).map(function (d) { return isDim(d) ? (bright ? 1 : 3) : d; });
      var cs;
      if (bright && BORROW_FROM[modeName][5] && BORROW_FROM[modeName][6] && hr.chance(spice * 0.6)) cs = [borrowed(5), borrowed(6), dia(0), dia(0)]; // bVI - bVII - I
      else if (bright && hr.chance(0.4)) cs = [dia(1), dominant(true), dia(0), dia(0)];                                    // ii - V7 - I
      else cs = degs.map(function (d) { return d === 4 ? dominant(false) : dia(d); });
      var last = makeChord(0, scale, {});
      if (!bright && hr.chance(0.3)) last = makeChord(0, modeName === 'dorian' ? MODES.mixolydian : MODES.major, { kind: 'bor' }); // Picardy third
      cs[3] = last;
      return cs.map(function (c) { return { segs: [{ s: 0, c: c }], cont: false }; });
    }
    sections.forEach(function (sec) {
      var pl = sec.type === 'intro' ? introPlan() : sec.type === 'outro' ? outroPlan() : planFor(sec.type, sec.bars);
      if (sec.shift) pl = pl.map(function (b) { return { cont: b.cont, segs: b.segs.map(function (sg) { return { s: sg.s, c: withProps(sg.c, { shift: sec.shift }) }; }) }; });
      sec.plan = pl;
    });
    // Lead each section into the next: a dominant before the tonic, a secondary
    // dominant before anything else, the new key's V7 before a key change.
    sections.forEach(function (sec, si) {
      var next = sections[si + 1] || (loop ? sections[0] : null);
      var b = sec.plan[sec.plan.length - 1];
      if (!next || sec.type === 'outro' || b.cont) return;
      var last = b.segs[b.segs.length - 1].c, x = next.plan[0].segs[0].c;
      if (next.shift !== sec.shift) {
        b.segs = [{ s: 0, c: b.segs[0].c }, { s: 8, c: withProps(dominant(true), { shift: next.shift }) }];
        return;
      }
      if (b.segs.length > 1) return;
      if (x.deg === 0) {
        if (last.deg === 4 || (!bright && last.deg === 6)) return;
        if (last.deg === 0) {
          b.segs = bright && hr.chance(0.5)
            ? [{ s: 0, c: withProps(dia(!isDim(3) && hr.chance(0.5) ? 3 : 1), { shift: sec.shift }) }, { s: 8, c: withProps(dominant(true), { shift: sec.shift }) }]
            : [{ s: 0, c: withProps(dominant(hr.chance(0.5)), { shift: sec.shift }) }];
        } else if (hr.chance(0.35 + 0.5 * spice)) {
          b.segs = [{ s: 0, c: last }, { s: 8, c: withProps(dominant(hr.chance(0.6)), { shift: sec.shift }) }];
        }
      } else if (x.deg !== last.deg && !isDim(x.deg) && hr.chance(0.2 + 0.5 * spice)) {
        b.segs = [{ s: 0, c: last }, { s: 8, c: withProps(secondaryDominant(scale, x.deg, true), { shift: sec.shift }) }];
      }
    });

    // Arrangement --------------------------------------------------------------
    var PARTS = {
      intro: { drums: 'light', pad: true, chords: true, arp: true },
      A: { drums: 'verse', bass: true, chords: true, lead: true },
      P: { drums: 'build', bass: true, chords: true, pad: true, lead: true },
      B: { drums: 'full', bass: true, chords: true, pad: true, arp: true, lead: true },
      C: { drums: 'half', bass: 'long', chords: true, pad: true, lead: true },
      outro: { pad: true, chords: true, bass: 'long', end: true }
    };
    var ENERGY = { intro: 0.78, A: 0.84, P: 0.86, B: 1, C: 0.8, outro: 0.8 };
    var fl = R('fills');
    var FILLS = { pop: { roll: 4, synco: 4, stop: 2 }, dance: { roll: 6, stop: 4 }, lofi: { synco: 5, none: 5 }, chip: { roll: 5, synco: 4, stop: 1 } };
    var barInfo = [];
    sections.forEach(function (sec, si) {
      var next = sections[si + 1];
      for (var j = 0; j < sec.bars; j++) {
        var info = {
          sec: sec, secIndex: si, j: j, segs: sec.plan[j].segs, cont: sec.plan[j].cont, parts: PARTS[sec.type],
          energy: ENERGY[sec.type] + (sec.type === 'P' ? 0.14 * j / Math.max(1, sec.bars - 1) : 0) + (sec.shift ? 0.05 : 0)
        };
        // A drum fill (or a sudden stop) leads into the next section.
        if (j === sec.bars - 1 && next && st.drums && sec.type !== 'P' && sec.type !== 'intro' && sec.bars >= 4) {
          var f = wpick(fl, FILLS[st.drums]);
          if (f === 'stop' && next.type !== 'B') f = 'roll';
          if (f !== 'none') info.fill = f;
          if (f === 'stop') info.stopAt = 12;
        }
        barInfo.push(info);
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
    function chordAt(bar, step) {
      var segs = barInfo[bar].segs, c = segs[0].c;
      for (var i = 1; i < segs.length; i++) if (segs[i].s <= step) c = segs[i].c;
      return c;
    }
    // Bars covered by the chord that starts in `bar` (chordBars > 1 holds a chord).
    function spanOf(bar) {
      var n = 1;
      while (barInfo[bar + n] && barInfo[bar + n].cont) n++;
      return n;
    }

    // Voice leading: each chord is voiced (within an octave, around chordCenter)
    // to move as little as possible from the previous one.
    var prevVoicing = null;
    function voicing(seg) {
      if (seg.v) return seg.v;
      var pcs = seg.c.tones.map(function (t) { return ((keyPc + chordPitch(seg.c, seg.c.deg + t)) % 12 + 12) % 12; });
      var best = null, bestCost = 1e9;
      for (var base = chordCenter - 8; base <= chordCenter + 1; base++) {
        var v = pcs.map(function (pc) { var m = base; while (((m % 12) + 12) % 12 !== pc) m++; return m; }).sort(function (a, b) { return a - b; });
        var cost = Math.abs((v[0] + v[v.length - 1]) / 2 - chordCenter) * 0.4;
        if (prevVoicing) v.forEach(function (m) { cost += Math.min.apply(null, prevVoicing.map(function (p) { return Math.abs(p - m); })); });
        if (cost < bestCost) { bestCost = cost; best = v; }
      }
      prevVoicing = best;
      seg.v = best;
      return best;
    }
    function bassNote(c, tone) {
      var d = c.deg + (tone === '5' ? 4 : c.bass);
      var m = 36 + keyPc + chordPitch(c, d);
      while (m > 42) m -= 12;
      while (m < 31) m += 12;
      if (tone === 'o') m += 12;
      return m + st.bassOct;
    }
    // A note one step from `to` on the side we come from: chromatic or diatonic.
    function approachNote(from, to, cNext) {
      if (Math.abs(to - from) <= 2) return from;
      var up = to > from;
      if (gr.chance(spice * 0.5)) return to + (up ? -1 : 1);
      var m = 36 + keyPc + chordPitch(cNext, cNext.deg + cNext.bass + (up ? -1 : 1));
      while (m - to > 6) m -= 12;
      while (to - m > 6) m += 12;
      return m;
    }
    // Pattern events inside [s0, end), always starting with one at s0.
    function segEvents(pattern, s0, end, head) {
      var evs = pattern.filter(function (e) { return e[0] >= s0 && e[0] < end; }).map(function (e) { return e.slice(); });
      if (!evs.length || evs[0][0] !== s0) evs.unshift([s0, (evs.length ? evs[0][0] : end) - s0].concat(head));
      evs.forEach(function (e) { e[1] = Math.min(e[1], end - e[0]); });
      return evs;
    }

    // Choose patterns per section type so repeats sound like the same section.
    var pat = {};
    ['intro', 'A', 'P', 'B', 'C', 'outro'].forEach(function (type) {
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

    var E = 1;
    function drum(bar, step, kind, vel, pan) {
      notes.push({ t: T(bar, step), d: stepDur, midi: { kick: 36, snare: 38, clap: 39, hat: 42, open: 46, crash: 49 }[kind], vel: V(Math.min(1, vel * E)), inst: 'drums', drum: kind, kit: st.kit, pan: pan || 0 });
    }
    function velOf(ch) { return ch === 'x' ? 1 : ch === 'o' ? 0.55 : 0; }
    var snareKind = st.drums === 'dance' ? 'clap' : 'snare';

    for (var bar = 0; bar < bars; bar++) {
      var info = barInfo[bar];
      var parts = info.parts;
      var type = info.sec.type;
      var P = pat[type];
      var lastOfSong = bar === bars - 1;
      var stopAt = info.stopAt || 16;
      E = info.energy;
      var span = spanOf(bar);
      var segs = info.segs;
      var segEnd = function (k) { return k + 1 < segs.length ? segs[k + 1].s : 16 * span; };
      if (!info.cont) segs.forEach(function (sg) { voicing(sg); });

      if (!info.cont) {
        segs.forEach(function (sg) {
          chords.push({ bar: bar, time: T(bar, sg.s), name: chordName(sg.c, tonicName(sg.c.shift), keyPc), degree: sg.c.deg });
        });
      }

      // Drums --------------------------------------------------------------
      if (st.drums && parts.drums && P.drums) {
        var D = P.drums, dm = parts.drums;
        var buildBar = dm === 'build' && st.drums !== 'lofi' ? info.j - (info.sec.bars - 2) : -1;
        for (var s = 0; s < stopAt; s++) {
          if (info.fill === 'roll' && s >= 12) {
            drum(bar, s, snareKind, 0.45 + (s - 12) * 0.18, 0);
            if (s === 12 && D.kick && velOf(D.kick[s])) drum(bar, s, 'kick', 1);
            continue;
          }
          if (info.fill === 'synco' && s >= 8) {
            var sy = { 8: 'kick', 10: 'snare', 11: 'snare', 13: 'snare', 14: 'kick', 15: 'snare' }[s];
            if (sy) drum(bar, s, sy === 'snare' ? snareKind : 'kick', sy === 'kick' ? 0.9 : 0.55 + 0.08 * (s - 10), 0.05);
            if (D.hat && s % 2 === 0) drum(bar, s, 'hat', 0.4, -0.25);
            continue;
          }
          // Pre-chorus build: the snare speeds up over the last two bars.
          if (buildBar >= 0) {
            var every = buildBar === 1 ? (s < 8 ? 2 : 1) : 4;
            if (s % every === 0) drum(bar, s, snareKind, 0.3 + 0.6 * (buildBar * 16 + s) / 32, 0.05);
            if (s % 4 === 0 && (buildBar === 0 || s < 8)) drum(bar, s, 'kick', 0.9);
            continue;
          }
          // Bridge: half-time feel.
          if (dm === 'half') {
            if (s === 0 || (s === 10 && D.kick && velOf(D.kick[10]))) drum(bar, s, 'kick', s ? 0.7 : 0.9);
            if (s === 8) drum(bar, s, snareKind, 0.85, 0.05);
            if (s % 2 === 0 && D.hat) drum(bar, s, 'hat', s % 4 ? 0.3 : 0.5, -0.25);
            continue;
          }
          var light = dm === 'light';
          if (D.kick && velOf(D.kick[s]) && (!light || st.drums === 'dance' && info.j >= 2)) drum(bar, s, 'kick', velOf(D.kick[s]));
          if (!light) {
            if (D.snare && velOf(D.snare[s])) drum(bar, s, 'snare', velOf(D.snare[s]), 0.05);
            if (D.clap && velOf(D.clap[s])) drum(bar, s, 'clap', velOf(D.clap[s]), 0.05);
            // Ghost notes between the backbeats.
            if (st.expr.ghost && D.snare && !velOf(D.snare[s]) && s % 2 === 1 && fl.chance(st.expr.ghost * 0.3)) drum(bar, s, 'snare', 0.2, 0.05);
          }
          var openHere = D.open && velOf(D.open[s]) && dm === 'full';
          if (openHere) drum(bar, s, 'open', 0.7, -0.25);
          else if (D.hat && velOf(D.hat[s])) drum(bar, s, 'hat', velOf(D.hat[s]) * (light ? 0.6 : dm === 'verse' ? 0.7 : 0.85), -0.25);
        }
      }
      var prevSec = info.secIndex > 0 ? sections[info.secIndex - 1] : null;
      if (st.drums && info.j === 0 && prevSec && (type === 'B' || type === 'outro' || type === 'C' || prevSec.type === 'intro' || info.sec.shift !== prevSec.shift)) {
        drum(bar, 0, 'crash', 0.8, 0.3);
      }

      // Bass --------------------------------------------------------------
      if (parts.bass && !info.cont) {
        var bp = parts.bass === 'long' ? [[0, 8, 'r', 0.8], [8, 8, '5', 0.6]] : P.bass;
        if (parts.bass === 'long' && (type === 'outro' || span > 1 || gr.chance(0.5))) bp = [[0, 16 * span, 'r', 0.8]];
        segs.forEach(function (sg, k) {
          var end = segEnd(k);
          var evs = segEvents(bp, sg.s, end, ['r', 0.9]);
          var nextC = k + 1 < segs.length ? segs[k + 1].c : (barInfo[bar + span] && barInfo[bar + span].parts.bass ? barInfo[bar + span].segs[0].c : null);
          evs.forEach(function (e, ei) {
            if (e[0] >= stopAt) return;
            var len = Math.min(e[1], stopAt - e[0]);
            if (lastOfSong) len = Math.max(len, 16);
            var m = bassNote(sg.c, e[2]);
            // Walk into the next chord on the last short note.
            if (st.bass !== 'dance' && ei === evs.length - 1 && ei > 0 && e[1] <= 4 && e[0] >= end - 4 && nextC && !sameChord(nextC, sg.c)) {
              m = approachNote(bassNote(sg.c, 'r'), bassNote(nextC, 'r'), nextC);
            }
            notes.push({ t: T(bar, e[0]), d: len * stepDur * 0.92, midi: m, vel: V(Math.min(1, e[3] * E)), inst: 'bass', patch: st.bassPatch });
          });
        });
      }

      // Final bar of an ending: one sustained chord
      if (parts.end && lastOfSong) {
        var endPatch = st.pad || (st.chords === 'epiano' ? 'epiano' : 'pad');
        voicing(segs[0]).forEach(function (m, i) {
          notes.push({ t: T(bar, 0) + i * (st.chords === 'epiano' ? 0.02 : 0), d: barDur, midi: m, vel: 0.8, inst: 'chords', patch: endPatch });
        });
        continue;
      }

      // Chords ------------------------------------------------------------
      if (parts.chords && st.chords && !info.cont) {
        segs.forEach(function (sg, k) {
          var end = Math.min(segEnd(k), stopAt), vc = voicing(sg);
          if (sg.s >= stopAt) return;
          if (st.chords === 'epiano' || st.chords === 'keys') {
            var still = type === 'outro' || (type === 'intro' && st.chords === 'keys') || type === 'C';
            var cp = still ? [[0, 16, 0.9]] : st.chords === 'epiano' ? P.epiano : P.keys;
            segEvents(cp, sg.s, end, [0.9]).forEach(function (e) {
              vc.forEach(function (m, i) {
                var ep = st.chords === 'epiano';
                notes.push({ t: T(bar, e[0]) + (ep ? i * 0.013 : 0), d: e[1] * stepDur * (ep ? 0.95 : 0.9), midi: m, vel: V(Math.min(1, e[2] * (ep ? 0.85 : 1) * E)), inst: 'chords', patch: st.chords === 'epiano' ? 'epiano' : 'keys' });
              });
            });
          } else if (st.chords === 'chiparp') {
            var tones = vc.slice(0, 3);
            var rate = type === 'intro' || type === 'outro' || type === 'C' ? 2 : 1;
            for (var cs = sg.s; cs < end; cs += rate) {
              notes.push({ t: T(bar, cs), d: stepDur * rate * 0.9, midi: tones[((cs - sg.s) / rate) % tones.length], vel: 0.8 * E, inst: 'chords', patch: 'chipArp' });
            }
          }
        });
      }

      // Pad ------------------------------------------------------------------
      if (parts.pad && st.pad && !info.cont) {
        segs.forEach(function (sg, k) {
          voicing(sg).forEach(function (m) {
            notes.push({ t: T(bar, sg.s), d: (segEnd(k) - sg.s) * stepDur, midi: m, vel: 0.8 * E, inst: 'chords', patch: st.pad });
          });
        });
      }

      // Arpeggio -------------------------------------------------------------
      if (parts.arp && st.arp) {
        var arpFor = function (step) {
          var sg = segs[0];
          for (var i = 1; i < segs.length; i++) if (segs[i].s <= step) sg = segs[i];
          if (info.cont) { var b0 = bar; while (barInfo[b0].cont) b0--; sg = barInfo[b0].segs[barInfo[b0].segs.length - 1]; }
          var at = voicing(sg).map(function (m) { return m + 12; });
          switch (P.arpShape) {
            case 'down': return { at: at, seq: at.slice().reverse() };
            case 'updown': return { at: at, seq: at.concat(at.slice(1, -1).reverse()) };
            case 'skip': return { at: at, seq: at.filter(function (_, i) { return i % 2 === 0; }).concat(at.filter(function (_, i) { return i % 2 === 1; })) };
            default: return { at: at, seq: at };
          }
        };
        if (st.arp === 'bell') {
          for (var as = 0; as < 16; as += 2) {
            if (gr.chance(0.4)) notes.push({ t: T(bar, as), d: stepDur * 4, midi: gr.pick(arpFor(as).at), vel: (0.5 + gr.next() * 0.4) * E, inst: 'arp', patch: st.arpPatch });
          }
        } else {
          var step = st.arp === 'sixteenths' ? 1 : 2;
          for (var ar = 0, ai = 0; ar < stopAt; ar += step, ai++) {
            var sq = arpFor(ar).seq;
            notes.push({ t: T(bar, ar), d: stepDur * step * 0.8, midi: sq[ai % sq.length], vel: (ar % 4 === 0 ? 0.9 : 0.6) * E, inst: 'arp', patch: st.arpPatch });
          }
        }
      }
    }

    // Melody --------------------------------------------------------------
    // Sections are built from 4-bar phrases: motif, answer, the motif again
    // (moved onto the new chord, or developed: inverted or with a new ending),
    // cadence. Strong beats sit on chord tones, with the occasional
    // appoggiatura; lines move mostly by step; a repeated section repeats its
    // melody; the final chorus gets a harmony a third or sixth below.
    var c0 = st.melody.center[0], c1 = st.melody.center[1];
    var lo = c0 - 3, hi = c1 + 5;
    var BASE = { A: c0, B: c1, P: c0 + 1, C: Math.round((c0 + c1) / 2) };
    var REG = { A: [0, 1, 1, 0, 0, 3, 2, 0], B: [0, 1, 2, 1, 0, 2, 4, 1], C: [1, 2, 1, 0, 2, 3, 2, 0], P: [0, 1, 2, 3] };
    var themes = {};
    var pending = [];   // pickup notes waiting for the pitch they lead into
    var dropped = [];
    var leadNotes = [];
    function pitch(bar, step, d) { return leadBase + chordPitch(chordAt(bar, step), d); }
    sections.forEach(function (sec, si) {
      if (!PARTS[sec.type].lead) return;
      if (!themes[sec.type]) themes[sec.type] = makeTheme(R('motif-' + sec.type), st.melody, sec.type);
      var th = themes[sec.type];
      var mr = R('melody-' + sec.type);
      var base = BASE[sec.type];
      var plan = sec.bars >= 8 ? REG[sec.type] : sec.type === 'P' ? REG.P : [0, 1, 1, 0];
      var nextSec = sections[si + 1];
      var harmonize = st.expr.harmony && sec.type === 'B' && (si === lastChorus || sec.shift);
      var prev = null;
      for (var j = 0; j < sec.bars; j++) {
        var barIdx = sec.startBar + j;
        var target = base + plan[j % plan.length];
        var role = j % 2 === 0 ? 'motif' : j % 4 === 1 ? 'answer' : 'cadence';
        var half = Math.floor(j / 4) % 2;
        var develop = j === 6 && sec.type !== 'B';
        var rh, degs = [];
        var cAt = function (n) { return chordAt(barIdx, n[0]); };
        if (role === 'motif') {
          rh = develop && th.devel === 'vary' ? th.motifVar : th.motif;
          var sign = develop && th.devel === 'invert' ? -1 : 1;
          var d = nearestChordTone(target, cAt(rh[0]), 0, lo, hi);
          for (var i = 0; i < rh.length; i++) {
            if (i > 0) {
              var mv = sign * th.contour[(i - 1) % th.contour.length];
              var nd = d + mv;
              if (nd > hi || nd < lo) nd = d - mv;
              d = isStrong(rh[i]) ? nearestChordTone(nd, cAt(rh[i]), mv, lo, hi) : nd;
            }
            degs.push(d);
          }
        } else if (role === 'answer') {
          rh = th.answers[half];
          d = prev === null ? nearestChordTone(target, cAt(rh[0]), 0, lo, hi) : prev;
          for (i = 0; i < rh.length; i++) {
            var step = clamp(Math.round((target - d) / (rh.length - i)), -2, 2);
            if (step === 0) step = mr.chance(0.8) ? mr.sign() : 0;
            else if (mr.chance(0.25)) step += mr.sign();
            var nd2 = d + step;
            if (nd2 > hi || nd2 < lo) nd2 = d - step;
            d = isStrong(rh[i]) || i === rh.length - 1 ? nearestChordTone(nd2, cAt(rh[i]), step, lo, hi) : nd2;
            degs.push(d);
          }
        } else {
          rh = th.cadences[half];
          var endChord = cAt(rh[rh.length - 1]);
          // A full close on the tonic at the end of a section (not before a chorus
          // from the pre-chorus), a half close elsewhere.
          var full = j === sec.bars - 1 && sec.type !== 'P';
          var gc = prev === null ? target : prev + clamp(target - prev, -3, 3);
          var goal = null;
          if (full) {
            goal = nearestTonic(prev === null ? gc : (gc + prev) / 2, lo, hi);
            if (!isChordDeg(endChord, 0)) goal = nearestChordTone(goal, endChord, 0, lo, hi);
          } else {
            for (var k = 0; k <= 3 && goal === null; k++) {
              [gc + k, gc - k].forEach(function (c) {
                if (goal === null && c >= lo && c <= hi && isChordDeg(endChord, c) && ((c % 7) + 7) % 7 !== 0) goal = c;
              });
            }
            if (goal === null) goal = nearestChordTone(gc, endChord, 0, lo, hi);
          }
          var from = prev === null ? goal + 1 : prev;
          var dir = from > goal ? 1 : from < goal ? -1 : (mr.chance(0.6) ? 1 : -1);
          for (i = 0; i < rh.length; i++) {
            var dd = goal + dir * (rh.length - 1 - i);
            if (i === 0 && rh.length > 1 && isStrong(rh[i])) dd = nearestChordTone(dd, cAt(rh[i]), -dir, lo, hi);
            degs.push(dd);
          }
        }

        // Appoggiatura: lean on the step above a chord tone, then resolve down.
        if (role !== 'cadence' && mr.chance(spice * 0.5)) {
          for (i = 1; i + 1 < rh.length; i++) {
            if (isStrong(rh[i]) && rh[i][1] <= 4 && rh[i + 1][0] - rh[i][0] <= 4 && degs[i + 1] !== degs[i] - 1 &&
                isChordDeg(cAt(rh[i]), degs[i]) && isChordDeg(cAt(rh[i + 1]), degs[i]) && degs[i] + 1 <= hi + 1) {
              degs[i + 1] = degs[i];
              degs[i] = degs[i] + 1;
              break;
            }
          }
        }

        // Fill pickups from the previous bar now that we know where they lead.
        if (pending.length) {
          var into = degs[0], fromAbove = mr.chance(0.35);
          var firstP = into + (fromAbove ? 1 : -1) * pending.length;
          pending.forEach(function (p, pi) {
            var dist = pending.length - pi;
            p.midi = leadBase + chordPitch(p.chord, into + (fromAbove ? dist : -dist));
            if (Math.abs(firstP - p.after) > 4) dropped.push(p);
          });
          pending = [];
        }

        for (i = 0; i < rh.length; i++) {
          var n = rh[i];
          var vel = (n[0] % 4 === 0 ? 0.88 : 0.72) + (n[0] === 0 ? 0.08 : 0);
          var len = n[1] * stepDur * Math.min(0.97, st.melody.legato + 0.12);
          var note = { t: T(barIdx, n[0]), d: len, midi: pitch(barIdx, n[0], degs[i]), vel: V(Math.min(1, vel * info_energy(barIdx))), inst: 'lead', patch: st.lead };
          notes.push(note);
          leadNotes.push({ n: note, phrase: sec.startBar + Math.floor(j / 4) * 4, last: role === 'cadence' && i === rh.length - 1 });
          if (harmonize) {
            var hc = cAt(n), hd = degs[i] - 2;
            if (isStrong(n)) for (var hk = 2; hk <= 5; hk++) if (isChordDeg(hc, degs[i] - hk)) { hd = degs[i] - hk; break; }
            notes.push({ t: note.t, d: len, midi: pitch(barIdx, n[0], hd), vel: note.vel * 0.55, inst: 'lead', patch: st.lead, pan: -0.35, harmony: true });
          }
        }
        prev = degs[degs.length - 1];

        // Pickup into the next phrase when this bar ends early.
        var endStep = rh[rh.length - 1][0] + rh[rh.length - 1][1];
        var leadsOn = role !== 'motif' && !st.melody.slow && (j < sec.bars - 1 || (nextSec && PARTS[nextSec.type].lead));
        if (leadsOn && endStep <= 14 && mr.chance(0.55)) {
          var steps = endStep <= 12 && mr.chance(0.5) ? [12, 14] : [14];
          steps.forEach(function (s) {
            var p = { t: T(barIdx, s), d: 2 * stepDur * 0.9, midi: 0, vel: V(0.62), inst: 'lead', patch: st.lead, after: prev, chord: chordAt(barIdx, s) };
            notes.push(p);
            pending.push(p);
          });
        }
      }
    });
    // Also drop a pickup with nothing after it (end of a loop).
    dropped = dropped.concat(pending);
    if (dropped.length) notes = notes.filter(function (n) { return dropped.indexOf(n) < 0; });
    notes.forEach(function (n) { delete n.after; delete n.chord; });
    function info_energy(bar) { return barInfo[bar].energy; }

    // Expression: the highest note of each phrase is accented, phrase ends
    // relax, and some notes scoop up into pitch.
    var ex = R('expression');
    var peaks = {};
    leadNotes.forEach(function (l) { if (!peaks[l.phrase] || l.n.midi > peaks[l.phrase].midi) peaks[l.phrase] = l.n; });
    var prevLead = null;
    leadNotes.forEach(function (l) {
      var n = l.n;
      if (peaks[l.phrase] === n) n.vel = Math.min(1, n.vel + 0.1);
      if (l.last) n.vel = Math.max(0.3, n.vel - 0.08);
      var afterRest = !prevLead || n.t - (prevLead.t + prevLead.d) > stepDur * 1.5;
      var leapUp = prevLead && n.midi - prevLead.midi >= 3;
      if (st.expr.bend && n.d >= stepDur * 2 && (afterRest || leapUp) && ex.chance(st.expr.bend)) {
        n.bend = -(ex.chance(0.7) ? 1 : 2);
        n.bendTime = st.lead === 'leadSquare' ? 0.04 : 0.08;
      }
      prevLead = n;
    });

    function isStrong(n) { return n[0] % 8 === 0 || n[1] >= 4 || (n[0] % 4 === 0 && n[1] >= 3); }
    function nearestChordTone(d, c, dir, lo, hi) {
      // Keep going the way the line moves before turning back.
      var order = dir > 0 ? [0, 1, 2, -1, 3, -2, -3] : dir < 0 ? [0, -1, -2, 1, -3, 2, 3] : [0, 1, -1, 2, -2, 3, -3];
      for (var i = 0; i < order.length; i++) {
        var x = d + order[i];
        if (x < lo - 1 || x > hi + 1) continue;
        if (isChordDeg(c, x)) return x;
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
      sections: sections.map(function (s) { return { type: s.type, startBar: s.startBar, bars: s.bars, start: s.start, key: tonicName(s.shift), shift: s.shift }; }),
      chords: chords,
      notes: notes
    };
  }

  // The fixed material of a section: rhythms for each phrase role, the
  // motif's melodic shape (in scale steps) and how it is developed.
  function makeTheme(rng, m, type) {
    var MR = MELODY_RHYTHMS;
    function pick(list, target, preferSync) {
      var w = list.map(function (r) {
        var x = Math.exp(-Math.abs(r.length - target) * 0.9);
        // Choruses like notes that start off the beat and ring across it.
        if (preferSync && r.some(function (n) { return n[0] % 4 !== 0 && n[0] % 4 + n[1] > 4; })) x *= 2.2;
        return x;
      });
      var sum = w.reduce(function (a, b) { return a + b; }, 0), r = rng.next() * sum;
      for (var i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
      return list[list.length - 1];
    }
    var n = m.notes + (type === 'P' ? 1 : type === 'C' ? -1 : 0);
    var motifs = m.slow ? MR.slowMotif : MR.motif, answersL = m.slow ? MR.slowAnswer : MR.answer, cadL = m.slow ? MR.slowCadence : MR.cadence;
    var motif = pick(motifs, n, type === 'B');
    var other = pick(motifs, n, false);
    // Same start, new ending: the classic way to vary a repeated motif.
    var motifVar = motif.filter(function (x) { return x[0] < 8; }).concat(other.filter(function (x) { return x[0] >= 8; }));
    if (motifVar.length < 2) motifVar = motif;
    var answers = [pick(answersL, n - 2), pick(answersL, n - 2)];
    var cadences = [pick(cadL, n - 3), pick(cadL, n - 3)];
    var shape = type === 'P' ? 'rise' : rng.pick(['rise', 'fall', 'arch', 'arch', 'valley']);
    // A motif needs a shape: at least one leap and a span of a 4th or more
    // over its notes, not a zig-zag around one pitch.
    var contour;
    for (var attempt = 0; attempt < 12; attempt++) {
      contour = [];
      var flipped = false;
      for (var i = 1; i < 13; i++) {
        var firstHalf = i < motif.length / 2;
        var dir = shape === 'rise' ? 1 : shape === 'fall' ? -1 : shape === 'arch' ? (firstHalf ? 1 : -1) : (firstHalf ? -1 : 1);
        var r = rng.next();
        var size = r < 0.1 ? 0 : r < 0.66 ? 1 : r < 0.9 ? 2 : 3;
        var before = contour[i - 2];
        if (before !== undefined && Math.abs(before) >= 2) { size = 1; dir = before > 0 ? -1 : 1; } // leap, then step back
        else if (!flipped && rng.chance(0.15)) { dir = -dir; flipped = true; }
        else flipped = false;
        contour.push(size * dir);
      }
      var pos = 0, top = 0, bottom = 0, leap = false;
      for (i = 0; i < motif.length - 1; i++) {
        pos += contour[i]; top = Math.max(top, pos); bottom = Math.min(bottom, pos);
        if (Math.abs(contour[i]) >= 2) leap = true;
      }
      if (leap && top - bottom >= 3) break;
    }
    return { motif: motif, motifVar: motifVar, answers: answers, cadences: cadences, contour: contour, devel: rng.pick(['same', 'invert', 'vary', 'vary']) };
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
    var bend = n.bend || 0, bendN = (n.bendTime || 0.08) * sr;

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
        vibf = P.vib ? 1 + 0.0578 * P.vib * Math.sin(TAU * 5.3 * t) * Math.min(1, t / 0.35) : 1;
        // Scoop: start `bend` semitones off and glide into the note.
        if (bend && i < bendN) vibf *= Math.pow(2, bend * (1 - i / bendN) / 12);
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
