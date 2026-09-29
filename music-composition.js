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

  var VERSION = '1.0.0-beta.4';
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
  // The scale of bII7 (the tritone substitute for V7), by the key's letter
  // names: Cb Db Eb F G Ab Bb in C, i.e. Db lydian dominant. Its 7th (Cb) sits
  // on the tonic's letter, hence -1.
  var TRITONE_SUB = [-1, 1, 3, 5, 7, 8, 10];
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
    // No double flats or sharps in chord symbols: bII7 in Gb is G7, not Abb7.
    if (acc < -1 || acc > 1) return (acc < 0 ? NOTE_NAMES_FLAT : NOTE_NAMES)[((pc % 12) + 12) % 12];
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
    // Tensions on seventh chords: 9 (b9 on a dominant), 13.
    if (sev >= 0 && !has(3) && (has(8) || has(12))) {
      var nine = has(8) ? iv(8) : -1, dom = third === 4 && sev === 10;
      if (dom && has(12) && iv(12) === 9) q = nine === 1 ? '13b9' : '13';
      else if (dom && nine === 1) q = '7b9';
      else if (nine === 2) q = q === 'maj7' ? 'maj9' : q === '7' ? '9' : q === 'm7' ? 'm9' : q === 'm7b5' ? 'm9b5' : q;
    }
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
  // Parts: what plays, and how. A style is a preset of parts plus composition
  // settings; compose({ parts }) overrides any of them.
  // ---------------------------------------------------------------------------
  var PART_OPTIONS = {
    drums: ['acoustic', 'electronic', 'lofi', 'chip', 'brush', 'perc', 'jazz', 'bossa', 'none'],
    groove: ['eightbeat', 'sixteenbeat', 'fourfloor', 'halftime', 'shuffle', 'swing', 'breakbeat', 'chip', 'bossa'],
    bass: ['synth', 'finger', 'sine', 'chip', 'upright', 'fm', 'tuba', 'none'],
    bassLine: ['root', 'drive', 'offbeat', 'syncopated', 'walking', 'long', 'bossa'],
    chords: ['piano', 'cutpiano', 'epiano', 'synth', 'organ', 'chip', 'harp', 'marimba', 'vibes', 'accordion', 'pizzicato', 'musicbox', 'none'],
    comping: ['block', 'rhythm', 'arpeggio', 'sustain', 'stab', 'broken', 'jazz', 'bossa'],
    guitar: ['strum', 'cutting', 'arpeggio', 'fingerpick', 'bossa', 'none'],
    pad: ['warm', 'wide', 'strings', 'ambient', 'choir', 'none'],
    lead: ['saw', 'pluck', 'soft', 'square', 'pwm', 'fm', 'robot', 'flute', 'whistle', 'sax', 'brass', 'violin', 'voice', 'bell', 'piano', 'vibes', 'harp', 'marimba', 'musicbox', 'accordion'],
    arp: ['eighths', 'sixteenths', 'bells', 'harp', 'marimba', 'musicbox', 'digital', 'none']
  };
  var PART_KEYS = Object.keys(PART_OPTIONS).concat('swing');
  // Parts whose instruments can sound together (parts.together).
  var LAYERABLE = ['lead', 'bass', 'chords', 'pad', 'arp'];
  // Part value -> synth patch (or drum kit).
  var SOUND = {
    drums: { acoustic: 'std', electronic: 'elec', lofi: 'lofi', chip: 'chip', brush: 'brush', perc: 'perc', jazz: 'jazz', bossa: 'bossa' },
    bass: { synth: 'bassSaw', finger: 'bassFinger', sine: 'bassSine', chip: 'bassChip', upright: 'bassUpright', fm: 'bassFM', tuba: 'tuba' },
    chords: { piano: 'piano', cutpiano: 'cutPiano', epiano: 'epiano', synth: 'keys', organ: 'organ', chip: 'chipArp', harp: 'harp', marimba: 'marimba', vibes: 'vibes', accordion: 'accordion', pizzicato: 'pizzicato', musicbox: 'musicbox' },
    pad: { warm: 'pad', wide: 'padWide', strings: 'strings', ambient: 'padAmbient', choir: 'choir' },
    lead: { saw: 'leadSaw', pluck: 'leadPluck', soft: 'leadSoft', square: 'leadSquare', pwm: 'leadPWM', fm: 'leadFM', robot: 'leadRobot', flute: 'flute', whistle: 'whistle', sax: 'sax',
      brass: 'brass', violin: 'violin', voice: 'voice', bell: 'bell', piano: 'pianoLead', vibes: 'vibesLead', harp: 'harpLead', marimba: 'marimbaLead', musicbox: 'musicboxLead', accordion: 'accordionLead' },
    arp: { eighths: 'arp', sixteenths: 'arp', bells: 'bellSoft', harp: 'harpArp', marimba: 'marimbaArp', musicbox: 'musicboxArp', digital: 'digitalArp' }
  };

  // spice: chromatic colour (secondary dominants, borrowed chords, appoggiaturas).
  // idioms: which progression idioms suit the style; functional: chance of a free
  // walk through functional harmony instead of an idiom.
  // form: chances of pre-chorus, bridge, a quiet drop chorus, a final key change.
  // expr: pitch scoops, ghost notes, a harmony line in the last chorus.
  // melody.sync: how much the melody likes syncopation; melody.gen: chance of a
  // generated (rather than stock) rhythm for each phrase role.
  // parts3: instruments that suit triple meter better (a harp, a music box, a
  // jazz waltz on brushes and upright bass), used for 3/4 unless overridden.
  var STYLES = {
    pop: {
      label: 'Pop', bpm: [98, 124], modes: ['major', 'major', 'mixolydian', 'minor'],
      chordBars: 1, sevenths: 0.2, humanize: 0,
      parts: { drums: 'acoustic', groove: 'eightbeat', bass: 'synth', bassLine: 'drive', chords: 'synth', comping: 'rhythm', guitar: 'none', pad: 'warm', lead: 'saw', arp: 'eighths', swing: 0 },
      parts3: { arp: 'harp' },
      spice: 0.5, idioms: 'pop', functional: 0.2, form: { pre: 0.6, bridge: 0.7, drop: 0.3, modulate: 0.5 },
      expr: { bend: 0.2, ghost: 0.3, harmony: true },
      melody: { slow: false, notes: 5, legato: 0.85, center: [3, 6], octave: 0, sync: 0.45, gen: 0.6 },
      fx: { room: 0.78, damp: 0.35, wet: 1, delay: 1, sidechain: 0, lofi: false, tail: 3 }
    },
    jpop: {
      label: 'J-POP', bpm: [128, 172], modes: ['major', 'major', 'major', 'minor'],
      chordBars: 1, sevenths: 0.5, humanize: 0,
      parts: { drums: 'acoustic', groove: 'eightbeat', bass: 'finger', bassLine: 'drive', chords: 'piano', comping: 'rhythm', guitar: 'strum', pad: 'strings', lead: 'flute', arp: 'none', swing: 0 },
      parts3: { guitar: 'fingerpick' },
      spice: 0.55, idioms: 'jpop', functional: 0.05, form: { pre: 1, bridge: 0.8, drop: 0.7, modulate: 0.7 },
      expr: { bend: 0.15, ghost: 0.25, harmony: true },
      melody: { slow: false, notes: 6, legato: 0.9, center: [2, 6], octave: 0, sync: 0.7, gen: 0.85, halves: true },
      fx: { room: 0.8, damp: 0.35, wet: 1, delay: 0.9, sidechain: 0, lofi: false, tail: 3 }
    },
    dance: {
      label: 'Dance', bpm: [118, 128], modes: ['minor', 'minor', 'dorian'],
      chordBars: 1, sevenths: 0.3, humanize: 0,
      parts: { drums: 'electronic', groove: 'fourfloor', bass: 'synth', bassLine: 'offbeat', chords: 'none', comping: 'block', guitar: 'none', pad: 'wide', lead: 'pluck', arp: 'sixteenths', swing: 0 },
      spice: 0.3, idioms: 'dance', functional: 0.1, form: { pre: 0.6, bridge: 0.4, drop: 0.4, modulate: 0.25 },
      expr: { bend: 0.1, ghost: 0, harmony: true },
      melody: { slow: false, notes: 5, legato: 0.7, center: [3, 6], octave: 0, sync: 0.6, gen: 0.6 },
      fx: { room: 0.82, damp: 0.3, wet: 1, delay: 1.2, sidechain: 0.7, lofi: false, tail: 3 }
    },
    lofi: {
      label: 'Lo-fi', bpm: [68, 86], modes: ['dorian', 'minor', 'major'],
      chordBars: 1, sevenths: 0.95, humanize: 1,
      parts: { drums: 'lofi', groove: 'shuffle', bass: 'sine', bassLine: 'syncopated', chords: 'epiano', comping: 'rhythm', guitar: 'none', pad: 'none', lead: 'soft', arp: 'none', swing: 0.3 },
      parts3: { drums: 'brush', bass: 'upright', bassLine: 'walking' },
      spice: 0.85, idioms: 'lofi', functional: 0.3, form: { pre: 0.2, bridge: 0.5, drop: 0, modulate: 0 },
      expr: { bend: 0.3, ghost: 0.5, harmony: false },
      melody: { slow: false, notes: 4, legato: 0.9, center: [2, 4], octave: 0, sync: 0.5, gen: 0.6 },
      fx: { room: 0.7, damp: 0.5, wet: 0.9, delay: 0.6, sidechain: 0, lofi: true, tail: 3 }
    },
    chiptune: {
      label: 'Chiptune', bpm: [128, 160], modes: ['major', 'minor', 'dorian', 'mixolydian'],
      chordBars: 1, sevenths: 0, humanize: 0,
      parts: { drums: 'chip', groove: 'chip', bass: 'chip', bassLine: 'drive', chords: 'chip', comping: 'arpeggio', guitar: 'none', pad: 'none', lead: 'square', arp: 'none', swing: 0 },
      spice: 0.45, idioms: 'chip', functional: 0.2, form: { pre: 0.5, bridge: 0.6, drop: 0.2, modulate: 0.6 },
      expr: { bend: 0.25, ghost: 0, harmony: true },
      melody: { slow: false, notes: 6, legato: 0.8, center: [3, 6], octave: 12, sync: 0.5, gen: 0.6 },
      fx: { room: 0.5, damp: 0.5, wet: 0.35, delay: 0.5, sidechain: 0, lofi: false, tail: 2 }
    },
    ambient: {
      label: 'Ambient', bpm: [62, 78], modes: ['lydian', 'major', 'dorian', 'minor'],
      chordBars: 2, sevenths: 0.6, humanize: 0,
      parts: { drums: 'none', groove: 'halftime', bass: 'sine', bassLine: 'long', chords: 'none', comping: 'sustain', guitar: 'none', pad: 'ambient', lead: 'bell', arp: 'bells', swing: 0 },
      parts3: { arp: 'musicbox' },
      spice: 0.35, idioms: 'ambient', functional: 0.4, form: { pre: 0, bridge: 0.5, drop: 0, modulate: 0 },
      expr: { bend: 0, ghost: 0, harmony: false },
      melody: { slow: true, notes: 2.5, legato: 1, center: [4, 7], octave: 0, sync: 0.1, gen: 0.3 },
      fx: { room: 0.93, damp: 0.2, wet: 1.4, delay: 1.2, sidechain: 0, lofi: false, tail: 6 }
    },
    // Swing: ride cymbal and hi-hat on 2 and 4, walking bass, rootless piano
    // voicings with 9ths and 13ths, ii-V-I and tritone substitutions, a sax
    // playing eighth-note lines (swung two to one).
    jazz: {
      label: 'Jazz', bpm: [112, 176], modes: ['major', 'major', 'minor', 'dorian'],
      chordBars: 1, sevenths: 1, humanize: 0.6, tensions: 0.75, rootless: true,
      parts: { drums: 'jazz', groove: 'swing', bass: 'upright', bassLine: 'walking', chords: 'piano', comping: 'jazz', guitar: 'none', pad: 'none', lead: 'sax', arp: 'none', swing: 0.33 },
      spice: 0.8, idioms: 'jazz', functional: 0.1, form: { pre: 0.2, bridge: 0.8, drop: 0.3, modulate: 0.2 },
      expr: { bend: 0.3, ghost: 0.4, harmony: false },
      melody: { slow: false, notes: 5.5, legato: 0.8, center: [3, 6], octave: 0, sync: 0.65, gen: 0.8, eighths: true },
      fx: { room: 0.72, damp: 0.45, wet: 0.8, delay: 0.15, sidechain: 0, lofi: false, tail: 3 }
    },
    // Bossa nova: nylon guitar playing the batida (thumb on the beats, fingers
    // syncopated), a bass on 1 and the "and" of 2, rim click on the bossa clave
    // over two bars, a shaker; maj7/m7 chords with 9ths, ii-V and bII7; straight eighths.
    bossa: {
      label: 'Bossa Nova', bpm: [118, 142], modes: ['major', 'major', 'minor', 'dorian'],
      chordBars: 1, sevenths: 1, humanize: 0.4, tensions: 0.6,
      parts: { drums: 'bossa', groove: 'bossa', bass: 'upright', bassLine: 'bossa', chords: 'epiano', comping: 'bossa', guitar: 'bossa', pad: 'none', lead: 'flute', arp: 'none', swing: 0 },
      spice: 0.7, idioms: 'bossa', functional: 0.1, form: { pre: 0.3, bridge: 0.7, drop: 0.2, modulate: 0.3 },
      expr: { bend: 0.1, ghost: 0.2, harmony: false },
      melody: { slow: false, notes: 4.5, legato: 0.85, center: [2, 5], octave: 0, sync: 0.75, gen: 0.8, eighths: true },
      fx: { room: 0.7, damp: 0.5, wet: 0.8, delay: 0.25, sidechain: 0, lofi: false, tail: 3 }
    }
  };
  var STYLE_NAMES = Object.keys(STYLES);

  // A style's own parts (with its triple-meter instruments in 3/4).
  function styleParts(st, three) {
    var p = {}, k;
    for (k in st.parts) p[k] = st.parts[k];
    if (three && st.parts3) for (k in st.parts3) p[k] = st.parts3[k];
    return p;
  }
  // Parts on top of a base. A value may be a list: the song uses all of them,
  // section by section (see sectionParts in compose), all at once for the
  // parts named in parts.together, or layered and arranged by section for the
  // parts in parts.arrange. parts.sometimes lists parts that some songs leave out.
  function resolveParts(base, custom) {
    var p = {};
    for (var k in base) p[k] = base[k];
    if (custom) {
      if (typeof custom !== 'object') throw new Error('music-composition.js: parts must be an object');
      Object.keys(custom).forEach(function (k) {
        var v = custom[k];
        if (v === undefined || v === null || v === '' || v === 'auto') return;
        if (k === 'together' || k === 'arrange') {
          var tk = typeof v === 'string' ? v.split(/[,|\s]+/).filter(Boolean) : v;
          if (!Array.isArray(tk)) throw new Error('music-composition.js: parts.' + k + ' must list parts');
          tk.forEach(function (x) {
            if (LAYERABLE.indexOf(x) < 0) throw new Error('music-composition.js: parts.' + k + ': "' + x + '" cannot be layered (use ' + LAYERABLE.join(', ') + ')');
          });
          if (tk.length) p[k] = tk.filter(function (x, i) { return tk.indexOf(x) === i; });
          return;
        }
        if (k === 'sometimes') {
          var ks = typeof v === 'string' ? v.split(/[,|\s]+/).filter(Boolean) : v;
          if (!Array.isArray(ks)) throw new Error('music-composition.js: parts.sometimes must list parts');
          ks.forEach(function (x) {
            if (!PART_OPTIONS[x] || PART_OPTIONS[x].indexOf('none') < 0) throw new Error('music-composition.js: parts.sometimes: "' + x + '" cannot be left out (use ' + Object.keys(PART_OPTIONS).filter(function (q) { return PART_OPTIONS[q].indexOf('none') >= 0; }).join(', ') + ')');
          });
          if (ks.length) p.sometimes = ks.filter(function (x, i) { return ks.indexOf(x) === i; });
          return;
        }
        var list = Array.isArray(v) ? v.filter(function (x) { return x !== undefined && x !== null && x !== '' && x !== 'auto'; }) : [v];
        list = list.filter(function (x, i) { return list.indexOf(x) === i; });
        if (!list.length) return;
        list.forEach(function (x) {
          if (k === 'swing') {
            if (typeof x !== 'number' || !(x >= 0 && x <= 0.5)) throw new Error('music-composition.js: parts.swing must be a number from 0 to 0.5');
            return;
          }
          if (!PART_OPTIONS[k]) throw new Error('music-composition.js: unknown part "' + k + '" (use ' + Object.keys(PART_OPTIONS).concat('swing', 'sometimes').join(', ') + ')');
          if (PART_OPTIONS[k].indexOf(x) < 0) throw new Error('music-composition.js: unknown ' + k + ' "' + x + '" (use ' + PART_OPTIONS[k].join(', ') + ')');
        });
        p[k] = list.length === 1 ? list[0] : list;
      });
    }
    return p;
  }

  // Style mixes: 'jpop+lofi', 'jpop:2+lofi', 'jpop,lofi', ['jpop', 'lofi'] or
  // { jpop: 2, lofi: 1 }. Returns the styles with weights summing to 1, and a
  // canonical name ('jpop+lofi', or 'jpop:2+lofi:1' when the weights differ).
  function parseMix(spec) {
    var list = [];
    function add(name, w) {
      name = String(name).trim().toLowerCase();
      if (!STYLES[name]) throw new Error('music-composition.js: unknown style "' + name + '" (use ' + STYLE_NAMES.join(', ') + ', or a mix such as "jpop+lofi")');
      w = +w;
      if (!(w >= 0 && w < Infinity)) throw new Error('music-composition.js: style weights must be positive numbers');
      if (!w) return;
      for (var i = 0; i < list.length; i++) if (list[i][0] === name) { list[i][1] += w; return; }
      list.push([name, w]);
    }
    if (typeof spec === 'string') {
      spec.split(/[+,\s]+/).forEach(function (t) {
        if (!t) return;
        var m = /^([A-Za-z]+)(?:[:*]([\d.]+))?$/.exec(t);
        if (!m) throw new Error('music-composition.js: unknown style "' + spec + '"');
        add(m[1], m[2] === undefined ? 1 : m[2]);
      });
    } else if (Array.isArray(spec)) {
      spec.forEach(function (n) { add(n, 1); });
    } else if (spec && typeof spec === 'object') {
      Object.keys(spec).forEach(function (n) { add(n, spec[n]); });
    }
    if (!list.length) throw new Error('music-composition.js: no style given');
    var sum = 0, same = true;
    list.forEach(function (x) { sum += x[1]; if (x[1] !== list[0][1]) same = false; });
    return {
      list: list.map(function (x) { return [x[0], x[1] / sum]; }),
      name: list.map(function (x) { return x[0] + (same ? '' : ':' + (Math.round(x[1] * 100) / 100)); }).join('+')
    };
  }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  // A blend of styles: the numbers are weighted averages, the modes and
  // idioms are drawn from all of them by weight, and each group of parts that
  // belongs together (drums and groove, bass and its line, chords and their
  // comping, guitar, pad, lead, arpeggio) comes from one of the styles.
  function blendStyles(list, rng, three) {
    var S = list.map(function (x) { return STYLES[x[0]]; }), W = list.map(function (x) { return x[1]; });
    var avg = function (get) { var t = 0; for (var i = 0; i < S.length; i++) t += W[i] * get(S[i]); return t; };
    var weights = {}, modeW = {}, tagW = {};
    S.forEach(function (s, i) {
      weights[i] = W[i];
      s.modes.forEach(function (m) { modeW[m] = (modeW[m] || 0) + W[i] / s.modes.length; });
      tagW[s.idioms] = (tagW[s.idioms] || 0) + W[i];
    });
    var parts = {};
    [['drums', 'groove', 'swing'], ['bass', 'bassLine'], ['chords', 'comping'], ['guitar'], ['pad'], ['lead'], ['arp']].forEach(function (g) {
      var from = styleParts(S[+wpick(rng, weights)], three);
      g.forEach(function (k) { parts[k] = from[k]; });
    });
    var main = 0;
    for (var i = 1; i < S.length; i++) if (W[i] > W[main]) main = i;
    var r2 = function (v) { return Math.round(v * 1000) / 1000; };
    return {
      label: S.map(function (s) { return s.label; }).join(' × '),
      bpm: [Math.round(avg(function (s) { return s.bpm[0]; })), Math.round(avg(function (s) { return s.bpm[1]; }))],
      modes: S[main].modes.slice(), modeW: modeW,
      chordBars: avg(function (s) { return s.chordBars; }) >= 1.5 ? 2 : 1,
      sevenths: r2(avg(function (s) { return s.sevenths; })),
      humanize: r2(avg(function (s) { return s.humanize; })),
      tensions: r2(avg(function (s) { return s.tensions || 0; })),
      rootless: avg(function (s) { return s.rootless ? 1 : 0; }) >= 0.5,
      parts: parts,
      spice: r2(avg(function (s) { return s.spice; })),
      idioms: S[main].idioms, tagW: tagW,
      functional: r2(avg(function (s) { return s.functional; })),
      form: {
        pre: r2(avg(function (s) { return s.form.pre; })), bridge: r2(avg(function (s) { return s.form.bridge; })),
        drop: r2(avg(function (s) { return s.form.drop; })), modulate: r2(avg(function (s) { return s.form.modulate; }))
      },
      expr: {
        bend: r2(avg(function (s) { return s.expr.bend; })), ghost: r2(avg(function (s) { return s.expr.ghost; })),
        harmony: avg(function (s) { return s.expr.harmony ? 1 : 0; }) >= 0.5
      },
      melody: {
        slow: avg(function (s) { return s.melody.slow ? 1 : 0; }) >= 0.5,
        notes: r2(avg(function (s) { return s.melody.notes; })),
        legato: r2(avg(function (s) { return s.melody.legato; })),
        center: [Math.round(avg(function (s) { return s.melody.center[0]; })), Math.round(avg(function (s) { return s.melody.center[1]; }))],
        octave: avg(function (s) { return s.melody.octave; }) >= 6 ? 12 : 0,
        sync: r2(avg(function (s) { return s.melody.sync; })),
        gen: r2(avg(function (s) { return s.melody.gen; })),
        eighths: avg(function (s) { return s.melody.eighths ? 1 : 0; }) >= 0.5,
        halves: avg(function (s) { return s.melody.halves ? 1 : 0; }) >= 0.3
      },
      fx: {
        room: r2(avg(function (s) { return s.fx.room; })), damp: r2(avg(function (s) { return s.fx.damp; })),
        wet: r2(avg(function (s) { return s.fx.wet; })), delay: r2(avg(function (s) { return s.fx.delay; })),
        sidechain: r2(avg(function (s) { return s.fx.sidechain; })),
        lofi: avg(function (s) { return s.fx.lofi ? 1 : 0; }) >= 0.35,
        tail: Math.max.apply(null, S.map(function (s) { return s.fx.tail; }))
      }
    };
  }

  function styleSettings(st) {
    var r2 = function (v) { return Math.round(Math.min(1, v) * 100) / 100; };
    return {
      bpm: st.bpm.slice(), modes: st.modes.filter(function (m, i) { return st.modes.indexOf(m) === i; }),
      spice: st.spice, sevenths: st.sevenths, functional: st.functional, sync: st.melody.sync, notes: st.melody.notes,
      humanize: st.humanize, chordBars: st.chordBars, form: copy(st.form), harmony: st.expr.harmony, bend: st.expr.bend,
      reverb: r2(st.fx.wet / 1.4), delay: r2(st.fx.delay / 1.2), sidechain: st.fx.sidechain, lofi: st.fx.lofi,
      parts: copy(st.parts), parts3: copy(st.parts3 || {})
    };
  }

  // A custom style: a base (one style or a mix) with its settings changed.
  var CUSTOM_KEYS = ['name', 'base', 'bpm', 'modes', 'parts', 'spice', 'sevenths', 'functional', 'sync', 'notes', 'humanize', 'chordBars', 'form', 'harmony', 'bend', 'reverb', 'delay', 'sidechain', 'lofi'];
  function isCustomStyle(spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return false;
    return Object.keys(spec).some(function (k) { return !STYLES[k]; });
  }
  function customStyle(def, rng, three) {
    Object.keys(def).forEach(function (k) {
      if (CUSTOM_KEYS.indexOf(k) < 0) throw new Error('music-composition.js: unknown style setting "' + k + '" (use ' + CUSTOM_KEYS.join(', ') + ')');
    });
    var mix = parseMix(def.base === undefined || def.base === null || def.base === '' ? 'pop' : def.base);
    var st;
    if (mix.list.length === 1) {
      st = copy(STYLES[mix.list[0][0]]);
      st.parts = styleParts(st, three);
    } else {
      st = blendStyles(mix.list, rng, three);
    }
    delete st.parts3;
    st.mix = mix;
    st.label = def.name ? String(def.name).slice(0, 60) : 'Custom';
    function num(v, what, lo, hi) {
      if (v === undefined || v === null || v === '') return undefined;
      if (typeof v === 'string') v = +v;
      if (typeof v !== 'number' || !(v >= lo && v <= hi)) throw new Error('music-composition.js: style.' + what + ' must be a number from ' + lo + ' to ' + hi);
      return v;
    }
    var v;
    if (def.bpm !== undefined && def.bpm !== null) {
      var b = Array.isArray(def.bpm) ? def.bpm : [def.bpm, def.bpm];
      var b0 = num(b[0], 'bpm', 40, 240), b1 = num(b[1] === undefined ? b[0] : b[1], 'bpm', 40, 240);
      st.bpm = [Math.min(b0, b1), Math.max(b0, b1)];
    }
    if (def.modes !== undefined && def.modes !== null) {
      var modes = typeof def.modes === 'string' ? def.modes.split(/[,+\s]+/).filter(Boolean) : def.modes;
      if (!Array.isArray(modes) || !modes.length) throw new Error('music-composition.js: style.modes must list one or more modes');
      modes.forEach(function (m) { if (!MODES[m]) throw new Error('music-composition.js: unknown mode "' + m + '" (use ' + Object.keys(MODES).join(', ') + ')'); });
      st.modes = modes.slice();
      delete st.modeW;
    }
    if ((v = num(def.spice, 'spice', 0, 1)) !== undefined) st.spice = v;
    if ((v = num(def.sevenths, 'sevenths', 0, 1)) !== undefined) st.sevenths = v;
    if ((v = num(def.functional, 'functional', 0, 1)) !== undefined) st.functional = v;
    if ((v = num(def.humanize, 'humanize', 0, 1)) !== undefined) st.humanize = v;
    if ((v = num(def.sync, 'sync', 0, 1)) !== undefined) st.melody.sync = v;
    if ((v = num(def.notes, 'notes', 1.5, 8)) !== undefined) { st.melody.notes = v; st.melody.slow = v < 3; }
    if ((v = num(def.chordBars, 'chordBars', 1, 2)) !== undefined) st.chordBars = Math.round(v);
    if ((v = num(def.bend, 'bend', 0, 1)) !== undefined) st.expr.bend = v;
    if (def.harmony !== undefined && def.harmony !== null) st.expr.harmony = !!def.harmony;
    if (def.form !== undefined && def.form !== null) {
      if (typeof def.form !== 'object') throw new Error('music-composition.js: style.form must be an object');
      Object.keys(def.form).forEach(function (k) {
        if (!(k in st.form)) throw new Error('music-composition.js: unknown style.form setting "' + k + '" (use pre, bridge, drop, modulate)');
        var x = num(def.form[k], 'form.' + k, 0, 1);
        if (x !== undefined) st.form[k] = x;
      });
    }
    if ((v = num(def.reverb, 'reverb', 0, 1)) !== undefined) { st.fx.wet = v * 1.4; st.fx.room = 0.5 + 0.45 * v; }
    if ((v = num(def.delay, 'delay', 0, 1)) !== undefined) st.fx.delay = v * 1.2;
    if ((v = num(def.sidechain, 'sidechain', 0, 1)) !== undefined) st.fx.sidechain = v;
    if (def.lofi !== undefined && def.lofi !== null) st.fx.lofi = !!def.lofi;
    st.parts = resolveParts(st.parts, def.parts);
    return st;
  }

  // Synth patches. a/d/r in seconds, s = sustain level 0..1,
  // cutoff/env in Hz (cutoff 0 = no filter), fd = filter-envelope decay (s).
  // wave 'add': additive partials [harmonic, level, decay s (0 = none)], inh = inharmonicity.
  // wave 'ks': plucked string (Karplus-Strong); bright 0..1, ring = decay time (s).
  // Optional: pwm {rate, depth} (square), ifloor = FM index that never decays away,
  // ring {ratio, mix} ring modulation, crush {bits, hold} bit/sample-rate reduction,
  // formants [[Hz, Q, gain]] band-pass bank, trem {rate, depth}, transpose (semitones).
  // In the arrangement: roll = seconds between chord notes, lh = add a left-hand
  // bass note, gate = cut notes after this many 16ths.
  var PATCHES = {
    leadSaw:    { wave: 'saw', unison: 2, detune: 7, a: 0.01, d: 0.3, s: 0.65, r: 0.18, cutoff: 1800, env: 2600, fd: 0.25, res: 0.15, gain: 0.32, pan: 0.08, rev: 0.25, dly: 0.28, vib: 0.18 },
    leadPluck:  { wave: 'saw', unison: 2, detune: 9, a: 0.003, d: 0.35, s: 0.25, r: 0.15, cutoff: 900, env: 4200, fd: 0.14, res: 0.3, gain: 0.4, pan: 0.05, rev: 0.3, dly: 0.35, vib: 0 },
    leadSoft:   { wave: 'tri', unison: 1, a: 0.02, d: 0.4, s: 0.55, r: 0.3, cutoff: 1600, env: 600, fd: 0.3, res: 0.05, gain: 0.4, pan: 0.12, rev: 0.35, dly: 0.2, vib: 0.12 },
    leadSquare: { wave: 'square', pw: 0.5, unison: 1, a: 0.002, d: 0.12, s: 0.75, r: 0.04, cutoff: 0, gain: 0.19, pan: 0.05, rev: 0.12, dly: 0.18, vib: 0.22 },
    flute:      { wave: 'add', partials: [[1, 1, 0], [2, 0.2, 0], [3, 0.09, 0], [4, 0.03, 0]], breath: 0.05, a: 0.05, d: 0.3, s: 0.85, r: 0.12, cutoff: 0, gain: 0.34, pan: 0.06, rev: 0.35, dly: 0.2, vib: 0.26 },
    brass:      { wave: 'saw', unison: 2, detune: 5, a: 0.03, d: 0.4, s: 0.7, r: 0.15, cutoff: 600, env: 2800, fd: 0.2, res: 0.12, gain: 0.26, pan: 0.05, rev: 0.28, dly: 0.2, vib: 0.14 },
    pianoLead:  { wave: 'add', partials: [[1, 1, 1.6], [2, 0.55, 0.9], [3, 0.3, 0.5], [4, 0.15, 0.35], [5, 0.08, 0.25], [6, 0.05, 0.2]], inh: 0.0004, a: 0.002, d: 3, s: 0, r: 0.3, cutoff: 0, gain: 0.3, pan: 0.05, rev: 0.3, dly: 0.15, vib: 0 },
    bell:       { wave: 'fm', ratio: 3.5, index: 2.2, idecay: 0.5, a: 0.004, d: 2.2, s: 0, r: 1.6, cutoff: 0, gain: 0.2, pan: 0.15, rev: 0.6, dly: 0.35, vib: 0 },
    bellSoft:   { wave: 'fm', ratio: 2, index: 1.4, idecay: 0.3, a: 0.004, d: 1.6, s: 0, r: 1.2, cutoff: 0, gain: 0.07, pan: -0.3, rev: 0.7, dly: 0.4, vib: 0 },
    epiano:     { wave: 'fm', roll: 0.012, ratio: 1, index: 1.6, idecay: 0.35, a: 0.003, d: 1.6, s: 0.3, r: 0.35, cutoff: 2600, env: 0, res: 0, gain: 0.12, pan: 0, rev: 0.3, dly: 0, vib: 0.05 },
    piano:      { wave: 'add', roll: 0.012, lh: true, partials: [[1, 1, 1.8], [2, 0.5, 1], [3, 0.26, 0.6], [4, 0.13, 0.4], [5, 0.07, 0.3], [6, 0.04, 0.22]], inh: 0.0004, a: 0.002, d: 3, s: 0, r: 0.25, cutoff: 0, gain: 0.1, pan: -0.08, rev: 0.3, dly: 0.04, vib: 0 },
    organ:      { wave: 'add', partials: [[1, 1, 0], [2, 0.7, 0], [3, 0.4, 0], [4, 0.28, 0], [6, 0.16, 0], [8, 0.12, 0]], a: 0.008, d: 0.2, s: 1, r: 0.08, cutoff: 0, gain: 0.045, pan: -0.1, rev: 0.3, dly: 0, vib: 0.1 },
    keys:       { wave: 'saw', unison: 1, a: 0.004, d: 0.5, s: 0.15, r: 0.12, cutoff: 700, env: 2000, fd: 0.18, res: 0.1, gain: 0.13, pan: -0.1, rev: 0.3, dly: 0.1, vib: 0 },
    guitar:     { wave: 'ks', bright: 0.55, body: 3200, ring: 2.2, a: 0.001, d: 1, s: 1, r: 0.08, cutoff: 0, gain: 0.19, pan: 0.3, rev: 0.3, dly: 0.08, vib: 0 },
    guitarMute: { wave: 'ks', bright: 0.35, body: 2600, ring: 0.18, a: 0.001, d: 1, s: 1, r: 0.03, cutoff: 0, gain: 0.19, pan: 0.32, rev: 0.15, dly: 0.05, vib: 0 },
    pad:        { wave: 'saw', unison: 3, detune: 14, a: 0.45, d: 1.2, s: 0.8, r: 0.9, cutoff: 800, env: 300, fd: 1.5, res: 0.05, gain: 0.07, pan: 0, rev: 0.6, dly: 0, vib: 0 },
    padWide:    { wave: 'saw', unison: 3, detune: 18, a: 0.08, d: 1.2, s: 0.8, r: 0.5, cutoff: 1300, env: 500, fd: 0.8, res: 0.1, gain: 0.08, pan: 0, rev: 0.5, dly: 0, vib: 0 },
    strings:    { wave: 'saw', unison: 3, detune: 9, a: 0.3, d: 1, s: 0.9, r: 0.6, cutoff: 2000, env: 500, fd: 1, res: 0.05, gain: 0.055, pan: 0, rev: 0.55, dly: 0, vib: 0.12 },
    padAmbient: { wave: 'saw', unison: 3, detune: 12, a: 1.8, d: 3, s: 0.85, r: 2.5, cutoff: 650, env: 250, fd: 3, res: 0.1, gain: 0.05, pan: 0, rev: 0.8, dly: 0, vib: 0 },
    arp:        { wave: 'square', pw: 0.3, unison: 1, a: 0.002, d: 0.14, s: 0, r: 0.06, cutoff: 1800, env: 2500, fd: 0.08, res: 0.2, gain: 0.12, pan: -0.35, rev: 0.3, dly: 0.45, vib: 0 },
    chipArp:    { wave: 'square', pw: 0.25, unison: 1, a: 0.001, d: 0.06, s: 0.55, r: 0.01, cutoff: 0, gain: 0.11, pan: -0.2, rev: 0.1, dly: 0, vib: 0 },
    bassSaw:    { wave: 'saw', unison: 1, a: 0.003, d: 0.3, s: 0.55, r: 0.06, cutoff: 260, env: 1000, fd: 0.12, res: 0.3, gain: 0.34, pan: 0, rev: 0, dly: 0, vib: 0 },
    bassFinger: { wave: 'add', partials: [[1, 1, 1.4], [2, 0.45, 0.6], [3, 0.2, 0.3], [4, 0.08, 0.2]], a: 0.004, d: 1.2, s: 0.35, r: 0.07, cutoff: 0, gain: 0.44, pan: 0, rev: 0.02, dly: 0, vib: 0 },
    bassSine:   { wave: 'sinesat', unison: 1, a: 0.008, d: 0.5, s: 0.7, r: 0.1, cutoff: 0, gain: 0.38, pan: 0, rev: 0.02, dly: 0, vib: 0 },
    bassChip:   { wave: 'ntri', unison: 1, a: 0.001, d: 0.1, s: 1, r: 0.02, cutoff: 0, gain: 0.34, pan: 0, rev: 0.02, dly: 0, vib: 0 },

    // Machines: pulse-width modulation, FM with a bright sustain, ring modulation through a bit-crusher.
    leadPWM:    { wave: 'square', pw: 0.5, pwm: { rate: 0.7, depth: 0.38 }, unison: 2, detune: 6, a: 0.005, d: 0.3, s: 0.75, r: 0.12, cutoff: 2600, env: 1800, fd: 0.2, res: 0.12, gain: 0.2, pan: 0.05, rev: 0.25, dly: 0.25, vib: 0.16 },
    leadFM:     { wave: 'fm', ratio: 1, index: 3.4, idecay: 0.25, ifloor: 0.4, a: 0.003, d: 0.5, s: 0.72, r: 0.12, cutoff: 0, gain: 0.25, pan: 0.05, rev: 0.25, dly: 0.25, vib: 0.14 },
    leadRobot:  { wave: 'square', pw: 0.5, unison: 1, ring: { ratio: 2, mix: 0.75 }, crush: { bits: 5, hold: 3 }, a: 0.003, d: 0.25, s: 0.8, r: 0.05, cutoff: 3400, env: 0, res: 0.25, gain: 0.26, pan: 0.05, rev: 0.2, dly: 0.25, vib: 0 },
    digitalArp: { wave: 'fm', ratio: 3, index: 2.5, idecay: 0.05, a: 0.001, d: 0.12, s: 0, r: 0.05, cutoff: 0, gain: 0.13, pan: -0.35, rev: 0.25, dly: 0.45, vib: 0 },
    bassFM:     { wave: 'fm', ratio: 1, index: 3.6, idecay: 0.07, ifloor: 0.12, a: 0.002, d: 0.5, s: 0.6, r: 0.05, cutoff: 0, gain: 0.34, pan: 0, rev: 0, dly: 0, vib: 0 },

    // Voices and winds: formant filters on a sawtooth (vowel 'ah'), a whistle, a violin, reeds.
    voice:      { wave: 'saw', unison: 1, formants: [[730, 7, 1], [1090, 9, 0.55], [2440, 12, 0.3]], a: 0.07, d: 0.4, s: 0.85, r: 0.2, cutoff: 0, gain: 1.2, pan: 0.05, rev: 0.4, dly: 0.2, vib: 0.3 },
    choir:      { wave: 'saw', unison: 3, detune: 12, formants: [[570, 6, 1], [840, 8, 0.6], [2410, 12, 0.25]], a: 0.6, d: 1.2, s: 0.9, r: 1.1, cutoff: 0, gain: 0.24, pan: 0, rev: 0.7, dly: 0, vib: 0.08 },
    whistle:    { wave: 'add', partials: [[1, 1, 0], [2, 0.04, 0]], breath: 0.03, a: 0.04, d: 0.3, s: 0.9, r: 0.1, cutoff: 0, gain: 0.3, pan: 0.06, rev: 0.4, dly: 0.25, vib: 0.3 },
    violin:     { wave: 'saw', unison: 2, detune: 5, a: 0.09, d: 0.5, s: 0.85, r: 0.2, cutoff: 3000, env: 600, fd: 0.4, res: 0.1, formants: [[280, 2, 0.6], [2900, 3, 0.5]], gain: 1.55, pan: 0.05, rev: 0.4, dly: 0.12, vib: 0.32 },
    accordion:  { wave: 'add', partials: [[1, 1, 0], [2, 0.75, 0], [3, 0.55, 0], [4, 0.4, 0], [5, 0.28, 0], [6, 0.18, 0], [7, 0.12, 0], [8, 0.08, 0]], trem: { rate: 5.8, depth: 0.28 }, a: 0.03, d: 0.2, s: 1, r: 0.08, cutoff: 0, gain: 0.05, pan: -0.1, rev: 0.25, dly: 0, vib: 0 },
    accordionLead: { wave: 'add', partials: [[1, 1, 0], [2, 0.75, 0], [3, 0.55, 0], [4, 0.4, 0], [5, 0.28, 0], [6, 0.18, 0], [7, 0.12, 0], [8, 0.08, 0]], trem: { rate: 5.8, depth: 0.28 }, a: 0.03, d: 0.2, s: 1, r: 0.08, cutoff: 0, gain: 0.16, pan: 0.05, rev: 0.25, dly: 0.12, vib: 0 },
    tuba:       { wave: 'saw', unison: 1, a: 0.025, d: 0.3, s: 0.75, r: 0.08, cutoff: 260, env: 650, fd: 0.15, res: 0.05, gain: 0.42, pan: 0, rev: 0.05, dly: 0, vib: 0 },

    // Jazz: a saxophone (a sawtooth through the horn's formants, breathy vibrato
    // that comes in late) and a vibraphone (mallet partials with the motor's tremolo).
    sax:        { wave: 'saw', unison: 1, formants: [[520, 4, 1], [1200, 5, 0.6], [2500, 6, 0.35]], a: 0.035, d: 0.4, s: 0.85, r: 0.1, cutoff: 2400, env: 1600, fd: 0.25, res: 0.1, gain: 0.42, pan: 0.05, rev: 0.3, dly: 0.1, vib: 0.28 },
    vibes:      { wave: 'add', roll: 0.01, partials: [[1, 1, 2.2], [4, 0.22, 0.5], [10, 0.05, 0.1]], trem: { rate: 5.5, depth: 0.3 }, a: 0.001, d: 3, s: 0, r: 0.6, cutoff: 0, gain: 0.1, pan: -0.1, rev: 0.4, dly: 0.05, vib: 0 },
    vibesLead:  { wave: 'add', partials: [[1, 1, 2.2], [4, 0.22, 0.5], [10, 0.05, 0.1]], trem: { rate: 5.5, depth: 0.3 }, a: 0.001, d: 3, s: 0, r: 0.6, cutoff: 0, gain: 0.3, pan: 0.05, rev: 0.4, dly: 0.15, vib: 0 },

    // Keys and mallets: a piano cut short, a marimba, a music box (an octave up).
    cutPiano:   { wave: 'add', gate: 1.6, partials: [[1, 1, 1.8], [2, 0.6, 1], [3, 0.35, 0.6], [4, 0.2, 0.4], [5, 0.1, 0.3], [6, 0.06, 0.22]], inh: 0.0004, a: 0.002, d: 3, s: 0, r: 0.025, cutoff: 0, gain: 0.1, pan: -0.05, rev: 0.25, dly: 0.12, vib: 0 },
    marimba:    { wave: 'add', roll: 0.008, partials: [[1, 1, 0.5], [4, 0.3, 0.09], [9.9, 0.07, 0.03]], a: 0.001, d: 1.2, s: 0, r: 0.3, cutoff: 0, gain: 0.14, pan: -0.1, rev: 0.3, dly: 0.05, vib: 0 },
    marimbaLead: { wave: 'add', partials: [[1, 1, 0.55], [4, 0.3, 0.09], [9.9, 0.07, 0.03]], a: 0.001, d: 1.2, s: 0, r: 0.3, cutoff: 0, gain: 0.42, pan: 0.05, rev: 0.3, dly: 0.2, vib: 0 },
    marimbaArp: { wave: 'add', partials: [[1, 1, 0.45], [4, 0.3, 0.08], [9.9, 0.07, 0.03]], a: 0.001, d: 1, s: 0, r: 0.25, cutoff: 0, gain: 0.07, pan: -0.35, rev: 0.3, dly: 0.3, vib: 0 },
    musicbox:   { wave: 'add', transpose: 12, roll: 0.02, partials: [[1, 1, 1.4], [2, 0.12, 0.5], [5.4, 0.28, 0.12], [8.9, 0.1, 0.06]], a: 0.001, d: 2.5, s: 0, r: 0.8, cutoff: 0, gain: 0.08, pan: -0.15, rev: 0.5, dly: 0.2, vib: 0 },
    musicboxLead: { wave: 'add', transpose: 12, partials: [[1, 1, 1.4], [2, 0.12, 0.5], [5.4, 0.28, 0.12], [8.9, 0.1, 0.06]], a: 0.001, d: 2.5, s: 0, r: 0.8, cutoff: 0, gain: 0.26, pan: 0.1, rev: 0.5, dly: 0.25, vib: 0 },
    musicboxArp: { wave: 'add', transpose: 12, partials: [[1, 1, 1.4], [2, 0.12, 0.5], [5.4, 0.28, 0.12], [8.9, 0.1, 0.06]], a: 0.001, d: 2.5, s: 0, r: 0.8, cutoff: 0, gain: 0.06, pan: -0.3, rev: 0.6, dly: 0.35, vib: 0 },

    // Plucked strings: harp (chords rolled, with a left hand), pizzicato, nylon guitar, upright bass.
    harp:       { wave: 'ks', roll: 0.035, lh: true, bright: 0.42, body: 1900, ring: 3.5, a: 0.001, d: 1, s: 1, r: 1.4, cutoff: 0, gain: 0.41, pan: -0.15, rev: 0.45, dly: 0.05, vib: 0 },
    harpLead:   { wave: 'ks', bright: 0.5, body: 2200, ring: 3, a: 0.001, d: 1, s: 1, r: 0.9, cutoff: 0, gain: 2.37, pan: 0.05, rev: 0.4, dly: 0.2, vib: 0 },
    harpArp:    { wave: 'ks', bright: 0.45, body: 2200, ring: 2.5, a: 0.001, d: 1, s: 1, r: 1, cutoff: 0, gain: 0.52, pan: -0.35, rev: 0.45, dly: 0.25, vib: 0 },
    pizzicato:  { wave: 'ks', roll: 0.006, bright: 0.3, body: 1800, ring: 0.45, a: 0.001, d: 1, s: 1, r: 0.05, cutoff: 0, gain: 0.76, pan: -0.1, rev: 0.4, dly: 0, vib: 0 },
    nylon:      { wave: 'ks', bright: 0.3, body: 1500, ring: 2.6, a: 0.001, d: 1, s: 1, r: 0.3, cutoff: 0, gain: 0.23, pan: 0.25, rev: 0.3, dly: 0.05, vib: 0 },
    bassUpright: { wave: 'ks', bright: 0.12, body: 420, ring: 1.1, a: 0.001, d: 1, s: 1, r: 0.08, cutoff: 0, gain: 2.8, pan: 0, rev: 0.05, dly: 0, vib: 0 }
  };

  // Progression idioms, in Roman numerals relative to the key (major-key
  // numerals; b = lowered, lowercase = minor, X7 on a non-dominant degree = a
  // secondary dominant). '|' separates bars, ',' splits a bar in two.
  // roles: sections the idiom suits (A verse, P pre-chorus, B chorus, C bridge).
  var IDIOMS = {
    major: [
      { p: 'IVmaj7 | V7 | iii7 | vi', roles: 'BP', tags: 'jpop pop' },                      // 王道進行
      { p: 'IVmaj7 | V | iii7 | vi | ii7 | V7 | I | I', roles: 'B', tags: 'jpop' },          // 王道 + cadence
      { p: 'vi | IV | V | I', roles: 'BA', tags: 'jpop pop dance' },                        // 小室進行
      { p: 'I,V/3 | vi,iii | IV,I/3 | IV,V', roles: 'AB', tags: 'jpop pop' },               // カノン進行
      { p: 'IVmaj7 | III7 | vi7 | v7,I7', roles: 'AB', tags: 'jpop lofi' },                 // 丸サ進行
      { p: 'I | V/3 | vi | I/5 | IV | I/3 | ii7 | V7', roles: 'AB', tags: 'jpop pop' },     // descending bass
      { p: 'IV | V | iii | vi | ii | iii | IVmaj7 | Vsus4,V', roles: 'B', tags: 'jpop' },
      { p: 'I | vi | IV | V', roles: 'AB', tags: 'pop jpop chip' },                        // 50s
      { p: 'I | V | vi | IV', roles: 'BA', tags: 'pop dance chip' },
      { p: 'vi | IV | I | V', roles: 'B', tags: 'pop dance' },
      { p: 'IV | I | V | vi', roles: 'B', tags: 'pop jpop' },
      { p: 'I | iii | IV | V', roles: 'A', tags: 'pop jpop' },
      { p: 'I | IV | I | V', roles: 'A', tags: 'chip pop' },
      { p: 'I | IV | vi | V', roles: 'AB', tags: 'pop chip' },
      { p: 'IV | V | vi | vi', roles: 'P', tags: 'jpop pop' },
      { p: 'ii7 | iii7 | IVmaj7 | V', roles: 'P', tags: 'jpop pop' },
      { p: 'vi | V | IV | V', roles: 'PC', tags: 'pop jpop dance' },
      { p: 'IV | V/3 | vi | V', roles: 'P', tags: 'jpop' },
      { p: 'ii7 | V7 | Imaj7 | vi7', roles: 'A', tags: 'lofi jpop' },
      { p: 'Imaj7 | I7 | IVmaj7 | iv7', roles: 'AC', tags: 'lofi jpop' },
      { p: 'IVmaj7 | iii7 | ii7 | Imaj7', roles: 'A', tags: 'lofi' },
      { p: 'IVmaj7 | III7 | vi7 | II7,V7', roles: 'AC', tags: 'lofi jpop' },
      { p: 'bVI | bVII | I | I', roles: 'C', tags: 'pop jpop chip dance' },
      { p: 'IV | iv | I | vi', roles: 'C', tags: 'pop jpop lofi' },
      { p: 'vi | iii | IV | I', roles: 'CA', tags: 'pop jpop' },
      { p: 'Imaj7 | IVmaj7 | Imaj7 | IVmaj7', roles: 'ABC', tags: 'ambient' },
      // Jazz: ii-V-I, I-vi-ii-V (rhythm changes), the circle from iii, tritone substitutes (bII7 for V7).
      { p: 'ii7 | V7 | Imaj7 | Imaj7', roles: 'AB', tags: 'jazz bossa', only: true },
      { p: 'Imaj7 | vi7 | ii7 | V7', roles: 'AB', tags: 'jazz bossa', only: true },
      { p: 'iii7 | VI7 | ii7 | V7', roles: 'ACP', tags: 'jazz bossa', only: true },
      { p: 'Imaj7,vi7 | ii7,V7 | iii7,VI7 | ii7,V7', roles: 'AB', tags: 'jazz', only: true },
      { p: 'ii7 | bII7 | Imaj7 | VI7', roles: 'B', tags: 'jazz bossa', only: true },
      { p: 'Imaj7 | I7 | IVmaj7 | iv7', roles: 'BC', tags: 'jazz bossa', only: true },
      { p: 'IVmaj7 | iv7 | iii7 | VI7', roles: 'C', tags: 'jazz bossa', only: true },
      { p: 'ii7 | V7 | iii7 | VI7', roles: 'P', tags: 'jazz bossa', only: true },
      { p: 'Imaj7 | II7 | ii7 | bII7', roles: 'A', tags: 'jazz bossa', only: true },
      // Bossa nova: a chord held for two bars, then the II7 (V7 of V) sliding down
      // by half steps (ii7 - bII7 - I), the bridge up to IV with a backdoor bVII7.
      { p: 'Imaj7 | Imaj7 | II7 | II7 | ii7 | bII7 | Imaj7 | bII7', roles: 'A', tags: 'bossa', only: true },
      { p: 'Imaj7 | II7 | ii7,V7 | Imaj7', roles: 'AB', tags: 'bossa', only: true },
      { p: 'IVmaj7 | IVmaj7 | bVII7 | bVII7 | iii7 | VI7 | ii7 | V7', roles: 'C', tags: 'bossa', only: true },
      { p: 'IVmaj7 | iv7 | Imaj7 | VI7', roles: 'BP', tags: 'bossa', only: true },
      { p: 'Iadd9 | vi7 | IVmaj7 | V', roles: 'AB', tags: 'ambient pop' }
    ],
    minor: [
      { p: 'i | bVI | bIII | bVII', roles: 'BA', tags: 'dance pop jpop chip' },
      { p: 'i | bVII | bVI | V', roles: 'BC', tags: 'dance pop jpop chip' },              // Andalusian
      { p: 'i | iv | bVII | bIII', roles: 'A', tags: 'pop dance jpop' },
      { p: 'bVI | bVII | i | i', roles: 'BP', tags: 'dance pop jpop chip' },
      { p: 'i | bVI | iv | V', roles: 'AB', tags: 'pop jpop chip' },
      { p: 'iv | V | i | i', roles: 'P', tags: 'pop jpop' },
      { p: 'bVImaj7 | V7 | i7 | i7', roles: 'AB', tags: 'lofi jpop' },
      { p: 'iv7 | bVII7 | bIIImaj7 | bVImaj7', roles: 'AC', tags: 'lofi jpop' },         // circle of fifths
      { p: 'i7 | iv7 | i7 | V7', roles: 'A', tags: 'lofi' },
      { p: 'bVI | bVII | V | i', roles: 'PC', tags: 'jpop pop dance' },
      { p: 'i | bIII | bVII | iv', roles: 'AB', tags: 'pop dance' },
      { p: 'i7 | bVImaj7 | i7 | bVImaj7', roles: 'ABC', tags: 'ambient' },
      // Jazz in minor: ii-V-i with the half-diminished ii and V7(b9), the minor circle, tritone substitutes.
      { p: 'iiø7 | V7 | i7 | i7', roles: 'AB', tags: 'jazz bossa', only: true },
      { p: 'i7 | iv7 | iiø7 | V7', roles: 'AP', tags: 'jazz bossa', only: true },
      { p: 'iv7 | bVII7 | bIIImaj7 | bVImaj7', roles: 'AC', tags: 'jazz bossa', only: true },
      { p: 'bVImaj7 | iiø7 | V7 | i7', roles: 'B', tags: 'jazz bossa', only: true },
      { p: 'i7 | bII7 | i7 | V7', roles: 'BC', tags: 'jazz', only: true },
      { p: 'iiø7 | V7 | iiø7 | V7', roles: 'P', tags: 'jazz bossa', only: true },
      // Minor bossa: the tonic and the iv for two bars each, the relative major, a ii-V back.
      { p: 'i7 | i7 | iv7 | iv7 | iiø7 | V7 | i7 | V7', roles: 'A', tags: 'bossa', only: true },
      { p: 'i7 | iv7 | bIIImaj7 | bVImaj7', roles: 'BC', tags: 'bossa', only: true }
    ],
    dorian: [
      { p: 'i7 | IV7 | i7 | IV7', roles: 'AB', tags: 'lofi pop dance ambient jazz bossa' },
      // Modal jazz: a dorian vamp, up a half step for the bridge feel; ii-V back home.
      { p: 'i7 | i7 | i7 | i7', roles: 'AC', tags: 'jazz', only: true },
      { p: 'ii7 | V7 | i7 | IV7', roles: 'BP', tags: 'jazz bossa', only: true },
      { p: 'i | bVII | IV | i', roles: 'AB', tags: 'pop dance chip' },
      { p: 'i7 | bIIImaj7 | IV7 | bVII', roles: 'BC', tags: 'lofi pop' }
    ],
    mixolydian: [
      { p: 'I | bVII | IV | I', roles: 'AB', tags: 'pop chip dance' },
      { p: 'I | IV | bVII | IV', roles: 'AB', tags: 'pop chip' }
    ],
    lydian: [
      { p: 'I | II | I | II', roles: 'AB', tags: 'ambient pop' },
      { p: 'Imaj7 | II | vi | V', roles: 'AB', tags: 'ambient pop chip' }
    ]
  };

  // ---------------------------------------------------------------------------
  // Pattern generators. Each song generates its own grooves, bass lines and
  // comping from a family ("eightbeat", "walking", ...) with the rules of that
  // family, instead of picking from a short fixed list.
  // ---------------------------------------------------------------------------
  function steps16() { return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; }
  function hit(arr, list, v) { list.forEach(function (s) { arr[s] = Math.max(arr[s], v); }); }
  // Add up to n hits chosen from candidates.
  function sprinkle(rng, arr, cands, n, v) {
    var c = cands.slice();
    for (var i = 0; i < n && c.length; i++) {
      var k = Math.floor(rng.next() * c.length);
      arr[c[k]] = Math.max(arr[c[k]], v);
      c.splice(k, 1);
    }
  }

  // A one-bar groove: velocity (0..1) per 16th for kick, snare, closed and open hat.
  // level 0 = intro (light), 1 = verse, 2 = chorus.
  function makeGroove(rng, family, level, ghost) {
    var g = { kick: steps16(), snare: steps16(), hat: steps16(), open: steps16() };
    var hats8 = function (on, off) { for (var s = 0; s < 16; s += 2) g.hat[s] = s % 4 === 0 ? on : off; };
    var hats16 = function (accent) { for (var s = 0; s < 16; s++) g.hat[s] = s % 4 === 0 ? accent : s % 2 === 0 ? accent * 0.7 : accent * 0.45; };
    switch (family) {
      case 'fourfloor':
        hit(g.kick, [0, 4, 8, 12], 1);
        hit(g.snare, [4, 12], 1);
        if (level >= 2 || rng.chance(0.5)) hit(g.open, [2, 6, 10, 14], 0.7); else hit(g.hat, [2, 6, 10, 14], 0.85);
        if (level >= 2) hit(g.hat, [1, 3, 5, 7, 9, 11, 13, 15], 0.35);
        else if (rng.chance(0.5)) hit(g.hat, [0, 4, 8, 12], 0.35);
        if (rng.chance(0.35)) sprinkle(rng, g.kick, [14, 15, 7, 11], 1, 0.55);
        break;
      case 'halftime':
        hit(g.kick, [0], 1);
        hit(g.snare, [8], 1);
        sprinkle(rng, g.kick, [10, 11, 14, 3, 6], rng.int(1, 2), 0.8);
        if (level >= 2 && rng.chance(0.5)) hats16(0.7); else hats8(0.7, 0.45);
        break;
      case 'swing':
        // Ride "ding, ding-a-ding" (the a is the swung eighth), hi-hat pedal on 2 and 4,
        // a feathered kick on every beat, and the snare comping on off-beats.
        hit(g.hat, [0, 8], 0.75); hit(g.hat, [4, 12], 0.9); hit(g.hat, [6, 14], 0.5);
        g.pedal = steps16(); hit(g.pedal, [4, 12], 0.55);
        hit(g.kick, [0, 4, 8, 12], 0.22);
        sprinkle(rng, g.snare, [2, 6, 10, 14], level >= 2 ? 2 : 1, 0.35);
        if (level >= 2 && rng.chance(0.4)) g.kick[rng.pick([6, 14])] = 0.6; // a "bomb"
        break;
      case 'bossa':
        // Bass drum on 1, the "and" of 2, 3 and the "and" of 4 (with the bass);
        // the rim click plays the bossa clave across two bars (g.alt is the second);
        // a shaker on the eighths, sixteenths in a chorus.
        hit(g.kick, [0, 8], 0.8); hit(g.kick, [6, 14], 0.5);
        hit(g.snare, [0, 6, 12], 0.6);
        if (level >= 2) hats16(0.5); else hats8(0.5, 0.32);
        g.alt = { kick: g.kick.slice(), snare: steps16(), hat: g.hat.slice(), open: steps16() };
        hit(g.alt.snare, [4, 10], 0.6);
        if (level === 0) { g.alt.snare = steps16(); g.alt.kick = steps16(); for (var ai = 0; ai < 16; ai++) g.alt.hat[ai] *= 0.7; }
        break;
      case 'shuffle':
        hit(g.kick, [0], 1);
        sprinkle(rng, g.kick, [7, 8, 10, 11, 14], rng.int(1, 2), 0.85);
        hit(g.snare, [4, 12], 1);
        hats8(0.75, rng.chance(0.5) ? 0.5 : 0.35);
        if (rng.chance(0.4)) sprinkle(rng, g.hat, [3, 7, 11, 15], 1, 0.3);
        break;
      case 'breakbeat':
        hit(g.kick, [0, 10], 1);
        sprinkle(rng, g.kick, [2, 3, 6, 11, 14], rng.int(1, 2), 0.8);
        hit(g.snare, [4, 12], 1);
        sprinkle(rng, g.snare, [7, 9, 15], 1, 0.4);
        if (level >= 2) hats16(0.7); else hats8(0.75, 0.5);
        break;
      case 'sixteenbeat':
        hit(g.kick, [0], 1);
        sprinkle(rng, g.kick, [3, 6, 7, 8, 10, 11, 13, 14], level >= 2 ? 3 : 2, 0.85);
        hit(g.snare, [4, 12], 1);
        hats16(0.8);
        if (level >= 2 && rng.chance(0.6)) { g.open[rng.pick([6, 14])] = 0.65; }
        break;
      case 'chip':
        hit(g.kick, [0, 8], 1);
        sprinkle(rng, g.kick, [6, 10, 14, 3], 1, 0.9);
        hit(g.snare, [4, 12], 1);
        if (rng.chance(0.4)) sprinkle(rng, g.snare, [14, 15, 7], 1, 0.5);
        if (level >= 2 && rng.chance(0.5)) hats16(0.6); else hats8(0.8, 0.55);
        break;
      default: // eightbeat
        hit(g.kick, [0], 1);
        if (rng.chance(0.7)) hit(g.kick, [8], 0.95);
        sprinkle(rng, g.kick, [6, 7, 10, 11, 14, 3], level >= 2 ? 2 : 1, 0.85);
        hit(g.snare, [4, 12], 1);
        if (level >= 2 && rng.chance(0.35)) hats16(0.75); else hats8(0.85, 0.55);
        if (level >= 2 && rng.chance(0.55)) { var o = rng.pick([6, 14]); g.open[o] = 0.65; g.hat[o] = 0; }
    }
    // Ghost notes between the backbeats (not in swing, where 16ths don't belong,
    // nor on the bossa clave).
    if (ghost && level >= 1 && family !== 'swing' && family !== 'bossa') {
      for (var s = 1; s < 16; s += 2) if (!g.snare[s] && rng.chance(ghost * 0.25)) g.snare[s] = 0.2;
    }
    if (level === 0) {
      // Intro: time only, maybe a soft kick on one.
      g.snare = steps16();
      g.kick = family === 'fourfloor' ? g.kick : steps16();
      g.open = steps16();
      for (s = 0; s < 16; s++) g.hat[s] *= 0.7;
    }
    return g;
  }
  // The same groove with a turnaround for the end of a 4-bar phrase.
  function grooveVariation(rng, g) {
    var v = { kick: g.kick.slice(), snare: g.snare.slice(), hat: g.hat.slice(), open: g.open.slice() };
    if (g.pedal) {
      // Swing: the snare kicks the band into the next phrase on swung eighths.
      v.pedal = g.pedal.slice();
      if (rng.chance(0.5)) { v.snare[10] = 0.5; v.snare[14] = 0.65; } else { v.snare[6] = 0.45; v.snare[14] = 0.6; v.kick[14] = 0.55; }
      return v;
    }
    if (g.alt) {
      // Bossa: the phrase ends on the clave's second bar, with one more rim click into the next.
      v = { kick: g.alt.kick.slice(), snare: g.alt.snare.slice(), hat: g.alt.hat.slice(), open: g.alt.open.slice() };
      if (v.snare[4]) v.snare[rng.pick([13, 14])] = 0.5;
      return v;
    }
    switch (rng.int(0, 3)) {
      case 0: v.snare[14] = 0.55; v.snare[15] = 0.7; break;
      case 1: v.kick[13] = 0.8; v.kick[14] = 0; v.snare[15] = 0.6; break;
      case 2: v.open[14] = 0.7; v.hat[14] = 0; v.kick[11] = Math.max(v.kick[11], 0.7); break;
      default: v.snare[10] = Math.max(v.snare[10], 0.45); v.snare[13] = 0.55; v.snare[15] = 0.5;
    }
    return v;
  }

  // Bass: events [step, length, tone, velocity]. Tones: r root (or the slash-chord
  // bass), 5 fifth, 3 third, o octave, s scale step above, a approach to the next
  // chord, p anticipation (the next chord's root, tied over the bar line).
  function makeBassLine(rng, line, groove, level, sync) {
    var ev = [], s;
    switch (line) {
      case 'long':
        return [[0, 16, 'r', 0.8]];
      case 'root':
        ev = [[0, 8, 'r', 0.95], [8, 8, rng.chance(0.4) ? '5' : 'r', 0.75]];
        if (level >= 2 && rng.chance(0.5)) ev = [[0, 4, 'r', 1], [4, 4, 'r', 0.7], [8, 4, rng.pick(['5', 'r', 'o']), 0.85], [12, 4, 'a', 0.7]];
        return ev;
      case 'offbeat':
        [2, 6, 10, 14].forEach(function (x) { ev.push([x, 2, 'r', 1]); });
        if (level >= 2 && rng.chance(0.6)) [3, 7, 11, 15].forEach(function (x) { ev.push([x, 1, rng.chance(0.4) ? 'o' : 'r', 0.55]); });
        return ev.sort(function (a, b) { return a[0] - b[0]; });
      case 'walking':
        return [[0, 4, 'r', 1], [4, 4, rng.pick(['3', '5']), 0.75], [8, 4, rng.pick(['5', 's', 'o']), 0.85], [12, 4, 'a', 0.75]];
      case 'bossa':
        // Root on 1 (a dotted quarter), the fifth on the "and" of 2 and on 3, and on
        // the "and" of 4 back to the root, or already the next chord's root.
        if (level === 0) return [[0, 8, 'r', 0.85], [8, 8, '5', 0.7]];
        return [[0, 6, 'r', 0.95], [6, 2, '5', 0.65], [8, 6, '5', 0.85], [14, 2, rng.chance(0.5 + 0.3 * sync) ? 'p' : 'r', 0.7]];
      case 'syncopated':
        // Lock to the kick drum, then fill a little.
        var on = [];
        for (s = 0; s < 16; s++) if (groove && groove.kick[s]) on.push(s);
        if (!on.length || on[0] !== 0) on.unshift(0);
        if (rng.chance(0.6)) on.push(rng.pick([6, 11, 14]));
        on = on.filter(function (x, i) { return on.indexOf(x) === i; }).sort(function (a, b) { return a - b; });
        on.forEach(function (x, i) {
          var next = i + 1 < on.length ? on[i + 1] : 16;
          ev.push([x, Math.min(next - x, 6), i === 0 ? 'r' : rng.pick(['r', 'r', '5', 'o']), i === 0 ? 1 : 0.8]);
        });
        if (ev.length > 1 && ev[ev.length - 1][0] >= 12 && rng.chance(0.5)) ev[ev.length - 1][2] = 'a';
        return ev;
      default: // drive: steady eighths (quarters in quieter sections)
        var q = level < 2 && rng.chance(0.5) ? 4 : 2;
        var oct = rng.chance(0.3);
        for (s = 0; s < 16; s += q) ev.push([s, q, oct && s % 4 === 2 ? 'o' : 'r', s % 4 === 0 ? 0.95 : 0.72]);
        if (rng.chance(0.4)) ev[ev.length - 1][2] = 'a';
        // J-POP style push: the last eighth anticipates the next chord.
        if (level >= 2 && q === 2 && rng.chance(sync * 0.6)) ev[ev.length - 1][2] = 'p';
        return ev;
    }
  }

  // Chord comping: events [step, length, velocity, flag]; flag 'p' = anticipate the
  // next chord, a number = which chord tone (arpeggio).
  function makeComp(rng, style, level, sync) {
    var ev = [];
    switch (style) {
      case 'sustain':
        return [[0, 16, 0.85]];
      case 'block':
        return level >= 2 && rng.chance(0.5) ? [[0, 6, 0.95], [6, 2, 0.6], [8, 8, 0.85]] : [[0, 8, 0.9], [8, 8, 0.8]];
      case 'stab':
        // Short chords on the offbeats (house piano, ska); a busier chorus adds 16ths.
        ev = [[2, 1, 0.85], [6, 1, 0.75], [10, 1, 0.85], [14, 1, 0.75]];
        if (level >= 2 && rng.chance(0.3 + 0.5 * sync)) ev.push([rng.pick([3, 11]), 1, 0.6], [rng.pick([7, 15]), 1, 0.55]);
        if (level >= 1 && rng.chance(0.5)) ev.push([0, 1, 0.9]);
        ev.sort(function (a, b) { return a[0] - b[0]; });
        ev.noHead = true;
        return ev;
      case 'jazz':
        // Comping figures on the (swung) eighths: the Charleston, its reverse,
        // 2 and 4, pushes into the next bar. The bass has the downbeat.
        if (level === 0) return [[0, 8, 0.7]];
        var figs = [
          [[0, 3, 0.8], [6, 4, 0.7]],
          [[2, 3, 0.7], [8, 4, 0.75]],
          [[4, 2, 0.6], [12, 2, 0.6]],
          [[6, 6, 0.7], [14, 2, 0.75, 'p']],
          [[0, 3, 0.75], [10, 3, 0.65]],
          [[6, 3, 0.7], [14, 2, 0.7, 'p']]
        ];
        ev = rng.pick(figs).map(function (e) { return e.slice(); });
        // A chorus adds a stab where the figure leaves room.
        if (level >= 2 && rng.chance(0.6)) {
          var free = [2, 4, 10, 12].filter(function (x) { return ev.every(function (e) { return x < e[0] || x >= e[0] + e[1]; }); });
          if (free.length) ev.push([rng.pick(free), 2, 0.6]);
        }
        ev.sort(function (a, b) { return a[0] - b[0]; });
        ev.noHead = true;
        return ev;
      case 'bossa':
        // Keys leave the downbeat to the guitar and answer it on the offbeats, softly.
        if (level === 0) return [[0, 16, 0.55]];
        ev = rng.pick([
          [[3, 3, 0.55], [10, 4, 0.5]],
          [[6, 4, 0.55], [12, 4, 0.5]],
          [[2, 2, 0.5], [6, 6, 0.55]],
          [[6, 6, 0.55], [14, 2, 0.5, 'p']]
        ]).map(function (e) { return e.slice(); });
        ev.noHead = true;
        return ev;
      case 'broken':
        // Broken chords (Alberti bass): low, high, middle, high, held as if pedalled.
        var al = rng.pick([[0, 3, 1, 3], [0, 2, 1, 2], [0, 3, 2, 3], [0, 1, 2, 3]]);
        for (var bs = 0, bi = 0; bs < 16; bs += 2, bi++) ev.push([bs, 16 - bs, bs % 4 === 0 ? 0.8 : 0.58, al[bi % 4]]);
        return ev;
      case 'arpeggio':
        var rate = rng.chance(0.3) ? 1 : 2;
        var order = rng.pick([[0, 1, 2, 3], [0, 2, 1, 3], [0, 1, 2, 1], [0, 2, 3, 2], [0, 3, 2, 1], [0, 1, 3, 2]]);
        for (var s = 0, i = 0; s < 16; s += rate, i++) ev.push([s, rate, s % 4 === 0 ? 0.85 : 0.6, order[i % order.length]]);
        return ev;
      default: // rhythm: a syncopated pattern on the eighth/sixteenth grid
        var cands = { 3: 0.25 * sync, 4: 0.3, 6: 0.55, 8: 0.45, 10: 0.5, 11: 0.3 * sync, 12: 0.3, 14: 0.35 + 0.3 * sync };
        var dens = level >= 2 ? 1.2 : level === 1 ? 0.8 : 0.4;
        var on = [0];
        Object.keys(cands).forEach(function (k) { if (rng.chance(Math.min(0.95, cands[k] * dens))) on.push(+k); });
        on.forEach(function (x, j) {
          var next = j + 1 < on.length ? on[j + 1] : 16;
          var e = [x, Math.max(1, next - x), x === 0 ? 0.95 : x % 4 === 0 ? 0.8 : 0.68];
          // A push into the next chord (not in an intro, which sets out the harmony plainly).
          if (x === 14 && rng.chance(0.5 + 0.4 * sync) && level > 0) e[3] = 'p';
          ev.push(e);
        });
        return ev;
    }
  }

  // Guitar: events [step, length, velocity, how]; how = 'D' down strum, 'U' up
  // strum, 'M' muted (cutting) stroke, or a string index (arpeggio).
  function makeGuitar(rng, style, level) {
    var ev = [], s;
    if (style === 'cutting') {
      for (s = 0; s < 16; s++) {
        var p = s % 4 === 2 ? 0.9 : s % 2 === 1 ? 0.55 : s % 4 === 0 ? 0.35 : 0.5;
        if (rng.chance(p * (level >= 2 ? 1.1 : 0.8))) ev.push([s, 1, s % 4 === 2 ? 0.9 : 0.6, 'M']);
      }
      return ev;
    }
    if (style === 'fingerpick') {
      // Thumb on the beats (alternating bass), fingers between; a pinch on one in a chorus.
      var thumb = rng.pick([[0, 2, 1, 2], [0, 1, 0, 2], [0, 2, 0, 1]]), fing = rng.pick([[3, 4, 5, 4], [4, 3, 5, 3], [5, 4, 3, 4]]);
      for (s = 0; s < 16; s += 4) {
        ev.push([s, 8, s === 0 ? 0.85 : 0.7, s === 0 && level >= 2 && rng.chance(0.5) ? 'P' : thumb[s / 4]]);
        if (level >= 1 || s % 8 === 4) ev.push([s + 2, 4, 0.55, fing[s / 4]]);
      }
      if (level >= 2 && rng.chance(0.4)) ev.push([7, 3, 0.5, 5]);
      return ev.sort(function (a, b) { return a[0] - b[0]; });
    }
    if (style === 'bossa') {
      // The batida: the thumb on 1 and 3 (root, then fifth), the fingers pluck
      // the upper strings together ('C') on a syncopated figure.
      ev.push([0, 8, 0.8, 0], [8, 8, 0.7, 1]);
      var fig = level === 0 ? [0, 6, 12] : rng.pick([[0, 3, 6, 10, 12], [0, 3, 6, 10, 14], [2, 6, 8, 12], [0, 4, 6, 10, 14]]);
      fig.forEach(function (x, i) {
        var next = i + 1 < fig.length ? fig[i + 1] : 16;
        ev.push([x, Math.min(3, next - x), x % 4 === 0 ? 0.6 : 0.52, 'C']);
      });
      return ev.sort(function (a, b) { return a[0] - b[0]; });
    }
    if (style === 'arpeggio') {
      var order = rng.pick([[0, 2, 3, 4, 5, 4, 3, 2], [0, 3, 4, 5, 3, 4, 2, 4], [0, 2, 4, 3, 5, 3, 4, 2]]);
      for (s = 0; s < 16; s += 2) ev.push([s, 4, s % 4 === 0 ? 0.8 : 0.6, order[(s / 2) % order.length]]);
      return ev;
    }
    // Strumming: down on the beat, up on the offbeat, some left out.
    var grid = level >= 2 && rng.chance(0.4) ? 1 : 2;
    for (s = 0; s < 16; s += grid) {
      var down = s % 4 === 0 || (grid === 2 && s % 4 === 2 && rng.chance(0.2));
      var keep = s === 0 ? 1 : down ? 0.8 : s % 2 === 0 ? 0.65 : 0.35;
      if (rng.chance(keep)) ev.push([s, grid * 2, down ? 0.85 : 0.6, down ? 'D' : 'U']);
    }
    for (var i = 0; i < ev.length; i++) ev[i][1] = (i + 1 < ev.length ? ev[i + 1][0] : 16) - ev[i][0];
    return ev;
  }

  // Melody rhythm for one bar, built from one-beat cells: [start, length] in
  // 16ths within the beat. Syncopation ties a note over the next beat.
  var BEAT_CELLS = [
    { c: [[0, 4]], w: 1 },
    { c: [[0, 2], [2, 2]], w: 1.4 },
    { c: [[0, 3], [3, 1]], w: 0.8 },
    { c: [[0, 2]], w: 0.5 },                  // eighth, then rest
    { c: [[2, 2]], w: 0.35, sync: 1 },        // rest, then offbeat
    { c: [[0, 1], [1, 1], [2, 2]], w: 0.55 },
    { c: [[0, 2], [2, 1], [3, 1]], w: 0.55 },
    { c: [[0, 1], [1, 2], [3, 1]], w: 0.3, sync: 1 },
    { c: [[1, 3]], w: 0.15, sync: 1 },
    { c: [], w: 0.25 }                        // rest
  ];
  // J-POP melody rhythm: a bar is two half-bar figures from the way J-POP
  // vocal lines move (runs of eighths, 3+3+2, a short 16th run, a breath and
  // an entry on the "and"), the second half often repeating the first; the
  // chorus sometimes anticipates beat 3 (the "食い"), tied over.
  var HALVES = [
    { c: [[0, 2], [2, 2], [4, 2], [6, 2]], w: 1.2 },          // o-o-o-o-
    { c: [[0, 2], [2, 2], [4, 4]], w: 1 },                    // o-o-o---
    { c: [[0, 4], [4, 2], [6, 2]], w: 0.7 },                  // o---o-o-
    { c: [[0, 3], [3, 3], [6, 2]], w: 0.8, sync: 1 },         // o--o--o- (3+3+2)
    { c: [[0, 2], [2, 1], [3, 1], [4, 2], [6, 2]], w: 0.55 }, // o-ooo-o-
    { c: [[0, 1], [1, 1], [2, 2], [4, 4]], w: 0.35 },         // ooo-o---
    { c: [[0, 2], [2, 2], [4, 1], [5, 1], [6, 2]], w: 0.45 }, // o-o-ooo-
    { c: [[2, 2], [4, 2], [6, 2]], w: 0.5, breath: 1 },       // --o-o-o-
    { c: [[0, 3], [3, 5]], w: 0.45, sync: 1 },                // o--o----
    { c: [[0, 2], [2, 6]], w: 0.45, long: 1 },                // o-o-----
    { c: [[0, 8]], w: 0.3, long: 1 }                          // o-------
  ];
  function genHalves(rng, target, sync, isAnswer) {
    var perHalf = target / 2;
    function pickHalf(second, first) {
      var w = HALVES.map(function (h) {
        var x = h.w * Math.exp(-Math.abs(h.c.length - perHalf) * 0.8);
        if (h.sync) x *= 0.5 + sync;
        if (h.breath) x *= second ? 1.2 : isAnswer ? 0.8 : 0.15; // a bar rarely opens with a rest
        if (isAnswer && second) x *= h.long ? 3 : h.c.length <= 3 ? 1.3 : 0.5; // answers settle
        if (first && first.sync && h.sync) x *= 0.3;
        return x;
      });
      var sum = w.reduce(function (a, x) { return a + x; }, 0), r = rng.next() * sum;
      for (var i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return HALVES[i]; }
      return HALVES[0];
    }
    var h1 = pickHalf(false, null);
    var h2 = !isAnswer && !h1.long && !h1.breath && rng.chance(0.4) ? h1 : pickHalf(true, h1);
    var notes = h1.c.map(function (n) { return n.slice(); }).concat(h2.c.map(function (n) { return [n[0] + 8, n[1]]; }));
    // Anticipate beat 3: its note comes an eighth (or a 16th) early and is held over.
    var at8 = -1;
    for (var i = 0; i < notes.length; i++) if (notes[i][0] === 8) at8 = i;
    if (at8 > 0 && !isAnswer && rng.chance(0.3 * sync)) {
      var prevN = notes[at8 - 1], early = prevN[0] <= 5 && rng.chance(0.6) ? 2 : 1;
      if (prevN[0] < 8 - early) {
        prevN[1] = Math.min(prevN[1], 8 - early - prevN[0]);
        notes[at8] = [8 - early, notes[at8][1] + early];
      }
    }
    // Hold the last note (answers ring longer).
    var last = notes[notes.length - 1];
    last[1] = Math.max(last[1], Math.min(isAnswer ? 6 : 4, 16 - last[0]));
    return notes;
  }

  // opt.eighths: keep to the eighth-note grid (swing). opt.bpm: the faster the
  // tempo, the rarer the 16th-note figures, and a note entering on the second
  // 16th of a beat (which displaces the line) is kept for slow tempos.
  function genRhythm(rng, target, sync, isAnswer, beats, opt) {
    beats = beats || 4;
    opt = opt || {};
    var bpm = opt.bpm || 110;
    for (var attempt = 0; attempt < 10; attempt++) {
      var notes = [];
      var perBeat = target / beats;
      var prev = null;
      for (var b = 0; b < beats; b++) {
        var w = BEAT_CELLS.map(function (cell) {
          if (opt.eighths && cell.c.some(function (n) { return n[0] % 2 || n[1] % 2; })) return 0;
          var x = cell.w * Math.exp(-Math.abs(cell.c.length - perBeat) * 1.1);
          if (cell.sync) x *= 0.4 + sync * 1.6;
          if (b === 0 && !cell.c.length) x *= 0.2;
          if (isAnswer && b >= 2) x *= cell.c.length <= 1 ? 2 : 0.5; // answers settle down
          var sixteenths = cell.c.some(function (n) { return n[0] % 2 || n[1] % 2; });
          if (cell.c.length && cell.c[0][0] === 1) x *= bpm >= 100 ? 0.08 : 0.5;  // enters on the "e"
          else if (sixteenths && bpm >= 130) x *= cell.sync ? 0.35 : 0.6;
          // One syncopated beat at a time: two in a row lose the beat.
          if (cell.sync && prev && prev.sync) x *= 0.25;
          return x;
        });
        var sum = w.reduce(function (a, x) { return a + x; }, 0), r = rng.next() * sum, pick = BEAT_CELLS[0];
        for (var i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) { pick = BEAT_CELLS[i]; break; } }
        pick.c.forEach(function (n) { notes.push([b * 4 + n[0], n[1]]); });
        prev = pick;
      }
      // Ties across beats: a note that ends on a beat swallows the note there.
      for (i = 0; i + 1 < notes.length; i++) {
        var endAt = notes[i][0] + notes[i][1];
        if (endAt % 4 === 0 && notes[i + 1][0] === endAt && notes[i][0] % 4 !== 0 && rng.chance(sync * 0.5)) {
          notes[i][1] += notes[i + 1][1];
          notes.splice(i + 1, 1);
        }
      }
      // Hold the last note (answers ring longer, leaving room to breathe).
      if (notes.length) {
        var last = notes[notes.length - 1];
        last[1] = Math.max(last[1], Math.min(isAnswer ? 6 : 4, beats * 4 - last[0]));
      }
      // In 3/4 a phrase starts on the downbeat (a pickup before it is added separately).
      if (notes.length >= 2 && (beats === 3 ? notes[0][0] === 0 : notes[0][0] <= 4)) return notes;
    }
    return beats === 3 ? [[0, 4], [4, 4], [8, 4]] : [[0, 4], [4, 4], [8, 8]];
  }

  // ---------------------------------------------------------------------------
  // Triple meter (3/4): 12 sixteenths per bar, strong-weak-weak. These are
  // written for the meter rather than cut down from 4/4: the kick marks the
  // downbeat only, waltz comping plays on beats 2 and 3 ("oom-pah-pah"),
  // chords change on beat 1 (or on beat 3 in a 2+1 split).
  // ---------------------------------------------------------------------------
  function steps12() { return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; }
  function makeGroove3(rng, family, level, ghost) {
    var g = { kick: steps12(), snare: steps12(), hat: steps12(), open: steps12() };
    var s;
    var hats8 = function (on, off) { for (s = 0; s < 12; s += 2) g.hat[s] = s % 4 === 0 ? on : off; };
    switch (family) {
      case 'fourfloor':
        // A driving waltz: every beat, the first one heaviest.
        hit(g.kick, [0], 1); hit(g.kick, [4, 8], 0.7);
        hit(g.snare, [4, 8], 0.6);
        if (level >= 2) hit(g.open, [2, 6, 10], 0.6); else hit(g.hat, [2, 6, 10], 0.75);
        break;
      case 'swing':
        // Jazz waltz with a hi-hat pedal on 2 and 3.
        hit(g.kick, [0], 0.6);
        hit(g.hat, [0], 0.8); hit(g.hat, [4, 8], 0.6); g.hat[6] = 0.45; g.hat[10] = 0.4;
        g.pedal = steps12(); hit(g.pedal, [4, 8], 0.5);
        if (rng.chance(0.6)) g.snare[rng.pick([6, 10])] = 0.35;
        break;
      case 'shuffle':
        // Jazz waltz: ride on "1, 2-and, 3", feathered kick, snare comping.
        hit(g.kick, [0], 0.9);
        if (rng.chance(0.4)) g.kick[10] = 0.5;
        hit(g.hat, [0], 0.8); hit(g.hat, [4, 8], 0.6); g.hat[6] = 0.45;
        if (rng.chance(0.5)) g.snare[rng.pick([6, 10])] = 0.35;
        break;
      case 'halftime':
        hit(g.kick, [0], 1);
        g.snare[8] = 0.55;
        for (s = 0; s < 12; s += 4) g.hat[s] = s ? 0.5 : 0.7;
        break;
      case 'chip':
        hit(g.kick, [0], 1);
        hit(g.snare, [4, 8], 0.6);
        if (rng.chance(0.4)) g.kick[10] = 0.7;
        hats8(0.75, 0.5);
        break;
      default: // eightbeat, sixteenbeat, breakbeat: a pop waltz
        hit(g.kick, [0], 1);
        if (level >= 2 && rng.chance(0.5)) g.kick[rng.pick([6, 10])] = 0.7;
        if (level >= 2 && rng.chance(0.5)) {
          g.snare[8] = 0.85; // ballad 3/4: a backbeat on three
        } else {
          hit(g.snare, [4, 8], 0.5); // "boom-chick-chick"
        }
        if (family === 'sixteenbeat' || (level >= 2 && rng.chance(0.3))) {
          for (s = 0; s < 12; s++) g.hat[s] = s % 4 === 0 ? 0.75 : s % 2 === 0 ? 0.5 : 0.32;
        } else hats8(0.8, 0.5);
    }
    if (ghost && level >= 1 && family !== 'swing') {
      for (s = 1; s < 12; s += 2) if (!g.snare[s] && rng.chance(ghost * 0.2)) g.snare[s] = 0.2;
    }
    if (level === 0) {
      g.snare = steps12();
      g.kick = steps12();
      g.open = steps12();
      for (s = 0; s < 12; s++) g.hat[s] *= 0.7;
    }
    return g;
  }
  function grooveVariation3(rng, g) {
    var v = { kick: g.kick.slice(), snare: g.snare.slice(), hat: g.hat.slice(), open: g.open.slice() };
    if (g.pedal) {
      v.pedal = g.pedal.slice();
      v.snare[10] = 0.55;
      return v;
    }
    switch (rng.int(0, 2)) {
      case 0: v.snare[10] = 0.55; v.snare[11] = 0.7; break;
      case 1: if (g.kick[0]) v.kick[9] = 0.75; v.snare[11] = 0.6; break; // a kick pickup only where the downbeat has one
      default: v.snare[8] = Math.max(v.snare[8], 0.6); v.snare[10] = 0.5; v.snare[11] = 0.6;
    }
    return v;
  }
  function makeBassLine3(rng, line, groove, level, sync) {
    var ev = [], s;
    switch (line) {
      case 'long':
        return [[0, 12, 'r', 0.8]];
      case 'root':
        // Waltz bass: the downbeat, sometimes the fifth on three.
        return rng.chance(0.5) ? [[0, 12, 'r', 0.95]] : [[0, 4, 'r', 1], [8, 4, '5', 0.65]];
      case 'offbeat':
        return [[2, 2, 'r', 1], [6, 2, 'r', 0.9], [10, 2, 'r', 0.9]];
      case 'walking':
        return [[0, 4, 'r', 1], [4, 4, rng.pick(['3', '5']), 0.75], [8, 4, 'a', 0.75]];
      case 'syncopated':
        var on = [0];
        for (s = 1; s < 12; s++) if (groove && groove.kick[s]) on.push(s);
        if (rng.chance(0.5)) on.push(rng.pick([6, 10]));
        on = on.filter(function (x, i) { return on.indexOf(x) === i; }).sort(function (a, b) { return a - b; });
        on.forEach(function (x, i) {
          var next = i + 1 < on.length ? on[i + 1] : 12;
          ev.push([x, Math.min(next - x, 6), i === 0 ? 'r' : rng.pick(['r', '5', 'o']), i === 0 ? 1 : 0.75]);
        });
        return ev;
      default: // drive: quarter notes (eighths in a chorus)
        var q = level >= 2 && rng.chance(0.5) ? 2 : 4;
        for (s = 0; s < 12; s += q) ev.push([s, q, s === 0 ? 'r' : rng.chance(0.3) ? 'o' : 'r', s === 0 ? 1 : 0.7]);
        if (rng.chance(0.4)) ev[ev.length - 1][2] = 'a';
        if (level >= 2 && q === 2 && rng.chance(sync * 0.5)) ev[ev.length - 1][2] = 'p';
        return ev;
    }
  }
  // Waltz comping has no chord on the downbeat (the bass takes it): the
  // pattern starts on beat 2 and `noHead` tells the renderer not to add one.
  function makeComp3(rng, style, level, sync) {
    switch (style) {
      case 'sustain':
        return [[0, 12, 0.85]];
      case 'block':
        return level >= 2 && rng.chance(0.5) ? [[0, 8, 0.9], [8, 4, 0.75]] : [[0, 12, 0.9]];
      case 'arpeggio':
        var order = rng.pick([[0, 1, 2, 3, 2, 1], [0, 2, 1, 2, 3, 2], [0, 1, 2, 1, 2, 1]]);
        return order.map(function (k, i) { return [i * 2, 2, i % 2 === 0 ? (i === 0 ? 0.85 : 0.65) : 0.55, k]; });
      case 'stab':
        var st3 = [[2, 1, 0.8], [6, 1, 0.7], [10, 1, 0.7]];
        if (level >= 2 && rng.chance(0.5)) st3.push([0, 1, 0.9]);
        st3.sort(function (a, b) { return a[0] - b[0]; });
        st3.noHead = true;
        return st3;
      case 'jazz':
        // Jazz waltz comping: beats 2 and 3, the "and" of 1, or a push on the "and" of 2.
        var jw = rng.pick([[[4, 4, 0.6], [8, 2, 0.55]], [[2, 4, 0.65], [8, 3, 0.6]], [[6, 5, 0.65]], [[4, 3, 0.6], [10, 2, 0.6, 'p']]]).map(function (e) { return e.slice(); });
        jw.noHead = true;
        return jw;
      case 'broken':
        // Waltz accompaniment broken up: the low note on one, the rest rising and falling.
        var br = rng.pick([[0, 2, 1, 3, 1, 2], [0, 1, 2, 3, 2, 1], [0, 2, 3, 2, 1, 2]]);
        return br.map(function (k, i) { return [i * 2, 12 - i * 2, i === 0 ? 0.8 : i % 2 === 0 ? 0.6 : 0.52, k]; });
      default: // rhythm: "pah-pah" on beats 2 and 3
        var ev = [[4, 4, 0.7], [8, 4, 0.65]];
        if (level >= 2 && rng.chance(0.3 * sync)) ev = [[4, 4, 0.7], [8, 2, 0.65], [10, 2, 0.55]];
        ev.noHead = true;
        return ev;
    }
  }
  function makeGuitar3(rng, style, level) {
    var ev = [], s;
    if (style === 'cutting') {
      for (s = 0; s < 12; s++) {
        var p = s % 4 === 0 ? (s ? 0.8 : 0.4) : s % 2 === 0 ? 0.5 : 0.35;
        if (rng.chance(p)) ev.push([s, 1, s % 4 === 0 ? 0.85 : 0.6, 'M']);
      }
      return ev;
    }
    if (style === 'fingerpick' || style === 'bossa') {
      // Waltz fingerstyle: bass on one, the fingers pinch (or roll) beats 2 and 3.
      if (level < 2 && rng.chance(0.5)) return [[0, 12, 0.85, 0], [4, 4, 0.6, 'P'], [8, 4, 0.55, 'P']];
      var roll = rng.pick([[3, 4, 5, 4, 3], [4, 5, 3, 5, 4], [3, 5, 4, 5, 3]]);
      ev.push([0, 12, 0.85, 0]);
      for (s = 2; s < 12; s += 2) ev.push([s, 12 - s, s % 4 === 0 ? 0.6 : 0.5, roll[s / 2 - 1]]);
      return ev;
    }
    if (style === 'arpeggio') {
      var order = rng.pick([[0, 2, 3, 4, 3, 2], [0, 3, 4, 5, 4, 3], [0, 2, 4, 3, 4, 2]]);
      for (s = 0; s < 12; s += 2) ev.push([s, 4, s === 0 ? 0.8 : 0.6, order[s / 2]]);
      return ev;
    }
    // Strum: down on each beat, ups on the "and" of 2 and 3.
    [[0, 'D', 1], [4, 'D', 0.8], [6, 'U', 0.6], [8, 'D', 0.8], [10, 'U', 0.55]].forEach(function (x) {
      if (rng.chance(x[2])) ev.push([x[0], 2, x[1] === 'D' ? 0.85 : 0.6, x[1]]);
    });
    for (var i = 0; i < ev.length; i++) ev[i][1] = (i + 1 < ev.length ? ev[i + 1][0] : 12) - ev[i][0];
    return ev;
  }

  // Melody rhythms in 3/4. Cadences land on the downbeat; the full close
  // holds it (a dotted half) or leaves beat 3 for a pickup into what follows.
  var MELODY_RHYTHMS_3 = {
    motif: [
      [[0, 4], [4, 4], [8, 4]],
      [[0, 6], [6, 2], [8, 4]],
      [[0, 8], [8, 4]],
      [[0, 4], [4, 2], [6, 2], [8, 4]],
      [[0, 2], [2, 2], [4, 4], [8, 4]],
      [[0, 6], [6, 2], [8, 2], [10, 2]],
      [[0, 3], [3, 1], [4, 4], [8, 4]],
      [[0, 2], [2, 2], [4, 2], [6, 2], [8, 4]],
      [[0, 4], [4, 6], [10, 2]]
    ],
    answer: [
      [[0, 8], [8, 4]],
      [[0, 12]],
      [[0, 6], [6, 2], [8, 4]],
      [[0, 4], [4, 8]],
      [[0, 4], [4, 4], [8, 4]]
    ],
    halfCadence: [[[0, 12]], [[0, 8]], [[0, 4], [4, 8]], [[0, 6], [6, 2], [8, 4]]],
    fullCadence: [[[0, 12]], [[0, 8]]],
    slowMotif: [[[0, 8], [8, 4]], [[0, 12]], [[0, 4], [4, 8]]],
    slowAnswer: [[[0, 12]], [[0, 8], [8, 4]]],
    slowCadence: [[[0, 12]]]
  };

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
   * @param {string} [options.style]         'pop' | 'jpop' | 'dance' | 'lofi' | 'chiptune' | 'ambient' | 'auto'
   * @param {object} [options.parts]         Override the style's instruments and playing (see PART_OPTIONS).
   * @param {number} [options.bpm]           Tempo. Chosen from the style if omitted.
   * @param {string} [options.key]           'C' ... 'B' (sharps or flats). Random if omitted.
   * @param {string} [options.mode]          'major' | 'minor' | 'dorian' | 'mixolydian' | 'lydian'
   * @param {number} [options.bars]          Length in bars (rounded to a multiple of 4, 8–256). Default 32.
   *                                          A song that changes key gets one more chorus in the new key (8 bars).
   * @param {number} [options.duration]      Target length in seconds, including the reverb tail (used when bars is omitted).
   * @param {boolean} [options.loop]         true => seamless loop (no intro/outro, reverb tail wrapped).
   * @param {string} [options.meter]         '4/4' (default) or '3/4'.
   * @param {boolean|number} [options.extend] Allow a longer song (true: up to 30 seconds, at least 8 bars;
   *                                          a number: up to that many seconds) so it ends on a whole chorus
   *                                          (if that is too far, up to 8 bars shorter instead).
   * @returns {object} song
   */
  function compose(options) {
    var o = options || {};
    var seed = (o.seed === undefined || o.seed === null || o.seed === '') ? randomSeed() : String(o.seed);
    var R = function (name) { return makeRng(seed + '/' + name); };

    var meter = o.meter === undefined || o.meter === null || o.meter === '' ? '4/4' : String(o.meter);
    if (meter === '3' || meter === '3/4') meter = '3/4';
    else if (meter === '4' || meter === '4/4') meter = '4/4';
    else throw new Error('music-composition.js: unknown meter "' + o.meter + '" (use 4/4 or 3/4)');
    var BEATS = meter === '3/4' ? 3 : 4;
    var SPB = BEATS * 4; // sixteenths per bar

    // Style: one of the styles, a mix of them, or a custom style.
    var styleName, st, mix;
    if (!o.style || o.style === 'auto') {
      styleName = R('style').pick(STYLE_NAMES);
    } else if (isCustomStyle(o.style)) {
      st = customStyle(o.style, R('mix'), BEATS === 3);
      styleName = 'custom';
      mix = st.mix;
    } else {
      mix = parseMix(o.style);
      if (mix.list.length === 1) styleName = mix.list[0][0];
      else { st = blendStyles(mix.list, R('mix'), BEATS === 3); styleName = mix.name; }
    }
    if (!st) { st = STYLES[styleName]; mix = { list: [[styleName, 1]] }; }
    var chosen = resolveParts(styleParts(st, BEATS === 3), o.parts);
    // Each part as a list of what it plays (in order: verse, chorus, bridge,
    // pre-chorus); parts.sometimes may leave a part out of this song.
    var pr = R('parts'), lists = {};
    PART_KEYS.forEach(function (k) {
      var L = [].concat(chosen[k]);
      for (var i = L.length - 1; i > 0; i--) { var j = Math.floor(pr.next() * (i + 1)), x = L[i]; L[i] = L[j]; L[j] = x; }
      // Drums build up: the lightest kit in the verse, the heaviest in the chorus.
      if (k === 'drums' && L.length > 1) {
        var W = ['none', 'brush', 'bossa', 'perc', 'jazz', 'lofi', 'chip', 'acoustic', 'electronic'];
        L.sort(function (a, b) { return W.indexOf(a) - W.indexOf(b); });
        L = [L[0], L[L.length - 1]].concat(L.slice(1, -1));
      }
      // A part that is left out of some sections should still be in the chorus.
      if (L.length > 1 && L[1] === 'none') { L[1] = L[0]; L[0] = 'none'; }
      lists[k] = L;
    });
    (chosen.sometimes || []).forEach(function (k) { if (pr.chance(0.5)) lists[k] = ['none']; });
    // parts.together: every instrument of the list plays all the way through (layered on the first).
    // parts.arrange: layered too, but brought in and out by section (see below).
    var together = {}, arranged = {};
    ['together', 'arrange'].forEach(function (how) {
      (chosen[how] || []).forEach(function (k) {
        var L = lists[k].filter(function (v) { return v !== 'none'; });
        if (L.length > 1 && !together[k] && !arranged[k]) { (how === 'together' ? together : arranged)[k] = L; lists[k] = [L[0]]; }
      });
    });
    var ROLE = { A: 0, B: 1, C: 2, P: 3, intro: 0, outro: 1, drop: 1 };
    function sectionParts(type) {
      var o2 = {};
      PART_KEYS.forEach(function (k) {
        var L = lists[k], i = ROLE[type] || 0;
        if (i >= L.length) i = type === 'C' && L.length > 1 ? L.length - 1 : 0;
        o2[k] = L[i];
      });
      return o2;
    }
    var parts = sectionParts('B');

    var bpm = o.bpm ? clamp(Math.round(+o.bpm), 40, 240) : Math.round(R('bpm').range(st.bpm[0], st.bpm[1]));
    var modeName;
    if (!o.mode || o.mode === 'auto') modeName = st.modeW ? wpick(R('mode'), st.modeW) : R('mode').pick(st.modes);
    else if (MODES[o.mode]) modeName = o.mode;
    else throw new Error('music-composition.js: unknown mode "' + o.mode + '" (use ' + Object.keys(MODES).join(', ') + ')');
    var scale = MODES[modeName];
    var keyPc = (o.key === undefined || o.key === null || o.key === '' || o.key === 'auto') ? R('key').int(0, 11) : parseKey(o.key);
    var loop = !!o.loop;
    var names = spelling(keyPc, modeName);

    var stepDur = 60 / bpm / 4;
    var barDur = stepDur * SPB;
    var bars;
    if (o.bars) bars = Math.round(+o.bars / 4) * 4;
    else if (o.duration) bars = Math.round((+o.duration - (loop ? 0 : st.fx.tail)) / barDur / 4) * 4;
    else bars = 32;
    bars = clamp(bars || 32, 8, 256);

    // Sounds
    // The sounds of the section being written (useSounds switches them).
    var kit, bassPatch, bassOct, chordPatch, padPatch, leadPatch, arpPatch, guitarPatch, swing, snareKind;
    var soundCache = {};
    function soundsOf(type) {
      var S = soundCache[type];
      if (!S) {
        var q = sectionParts(type);
        S = soundCache[type] = {
          parts: q, kit: SOUND.drums[q.drums] || null, bassPatch: SOUND.bass[q.bass] || null, bassOct: q.bass === 'chip' ? 12 : 0,
          chordPatch: SOUND.chords[q.chords] || null, padPatch: SOUND.pad[q.pad] || null, leadPatch: SOUND.lead[q.lead],
          arpPatch: SOUND.arp[q.arp] || null, guitarPatch: q.guitar === 'fingerpick' || q.guitar === 'bossa' ? 'nylon' : 'guitar', swing: q.swing,
          snareKind: q.drums === 'electronic' || q.groove === 'fourfloor' ? 'clap' : 'snare'
        };
      }
      return S;
    }
    // The sounds of the section a bar belongs to (for notes that lead into it).
    function intoSounds(bar) {
      return barInfo[bar] ? soundsOf(barInfo[bar].patKey) : null;
    }
    function useSounds(type) {
      var S = soundsOf(type);
      parts = S.parts; kit = S.kit; bassPatch = S.bassPatch; bassOct = S.bassOct; chordPatch = S.chordPatch; padPatch = S.padPatch;
      leadPatch = S.leadPatch; arpPatch = S.arpPatch; guitarPatch = S.guitarPatch; swing = S.swing; snareKind = S.snareKind;
    }
    useSounds('B');

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
    // Verse (A), pre-chorus (P), chorus (B), bridge (C); a quiet "drop" chorus
    // (D) may come before the last one, and the last chorus may move up a step.
    var fr = R('form');
    var usePre = fr.chance(st.form.pre), useBridge = fr.chance(st.form.bridge), useDrop = fr.chance(st.form.drop);
    var LEN = { A: 8, P: 4, B: 8, C: 8, D: 8 };
    var first = ['A'].concat(usePre ? ['P'] : [], ['B', 'A'], usePre ? ['P'] : [], ['B'],
      useBridge ? ['C'] : [], useDrop ? ['D'] : [], useBridge || useDrop ? ['B'] : []);
    var again = ['A'].concat(usePre ? ['P'] : [], ['B']);
    function buildForm(total) {
      var out = [];
      var remaining = total;
      var io = !loop && total >= 16;
      if (io) { remaining -= 8; out.push({ type: 'intro', bars: 4 }); }
      for (var fi = 0; remaining > 0; fi++) {
        var ftype = fi < first.length ? first[fi] : again[(fi - first.length) % again.length];
        if (ftype === 'D' && remaining < 16) continue;
        // A pre-chorus or bridge needs a chorus after it; whatever is left becomes (part of) a chorus.
        if ((ftype === 'P' && remaining < 12) || (ftype === 'C' && remaining < 16) || LEN[ftype] > remaining) ftype = 'B';
        var flen = Math.min(LEN[ftype], remaining);
        out.push({ type: ftype === 'D' ? 'B' : ftype, bars: flen, drop: ftype === 'D' });
        remaining -= flen;
      }
      if (io) out.push({ type: 'outro', bars: 4 });
      return out;
    }
    // A form ends well when every section is whole and the last one before
    // the ending is a full chorus (not a half chorus, a verse or the quiet one).
    function endsWell(form) {
      var body = form.filter(function (x) { return x.type !== 'intro' && x.type !== 'outro'; });
      var last = body[body.length - 1];
      if (body.length === 1 && last.bars === LEN[last.type]) return true; // a short piece: one whole section
      return !!last && last.type === 'B' && !last.drop && body.every(function (x) { return x.bars === LEN[x.drop ? 'D' : x.type]; });
    }
    var sections = buildForm(bars);
    // extend: lengthen the song (4 bars at a time, up to the limit) until it ends well.
    if (o.extend && !endsWell(sections)) {
      var maxExtra = Math.max(typeof o.extend === 'number' ? 0 : 8, Math.floor((typeof o.extend === 'number' ? Math.max(0, o.extend) : 30) / barDur / 4) * 4);
      var fixed = false;
      for (var extra = 4; extra <= maxExtra && bars + extra <= 256; extra += 4) {
        var cand = buildForm(bars + extra);
        if (endsWell(cand)) { sections = cand; bars += extra; fixed = true; break; }
      }
      // Too far to the next whole chorus: end a little earlier instead (up to 8 bars).
      for (var less = 4; !fixed && less <= 8 && bars - less >= 8; less += 4) {
        var cand2 = buildForm(bars - less);
        if (endsWell(cand2)) { sections = cand2; bars -= less; fixed = true; }
      }
    }
    var chorusIdx = [];
    sections.forEach(function (s, i) { if (s.type === 'B' && !s.drop) chorusIdx.push(i); });
    var modAt = -1;
    if (!loop && chorusIdx.length >= 2 && fr.chance(st.form.modulate)) {
      modAt = chorusIdx[chorusIdx.length - 1];
      while (modAt > 0 && sections[modAt - 1].type === 'B' && !sections[modAt - 1].drop) modAt--;
      if (modAt <= chorusIdx[0]) modAt = -1;
    }
    var modShift = fr.chance(0.7) ? 2 : 1;
    // A key change is not left for the last few bars: the new key gets at least
    // two choruses (the last chorus once more, as in a J-POP ending) before the outro.
    if (modAt >= 0) {
      var bodyEnd = sections.length - (sections[sections.length - 1].type === 'outro' ? 1 : 0);
      var finalB = sections[bodyEnd - 1];
      if (finalB.type === 'B' && finalB.bars < LEN.B && bars + LEN.B - finalB.bars <= 256) { bars += LEN.B - finalB.bars; finalB.bars = LEN.B; }
      var inNewKey = 0;
      for (var mk = modAt; mk < bodyEnd; mk++) inNewKey += sections[mk].bars;
      if (inNewKey < 16 && bars + LEN.B <= 256) {
        sections.splice(bodyEnd, 0, { type: 'B', bars: LEN.B, drop: false });
        bars += LEN.B;
        chorusIdx.push(bodyEnd);
      }
    }
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
      // (Drawn per degree, so it doesn't depend on where the degree first turns up:
      // a longer version of the song keeps every chord of the shorter one.)
      if (sevenths[deg] === undefined) sevenths[deg] = R('seventh-' + deg).chance(st.sevenths);
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
    function isDominant(c) { return c.kind === 'sec' || (c.deg === 4 && (c.scale[6] - c.scale[4] + 12) % 12 === 4); }

    // Roman-numeral token -> chord, e.g. 'IVmaj7', 'bVII', 'iv7', 'III7' (V7/vi), 'V/3'.
    var ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
    // Where a chord outside the key borrows its scale from: in major keys the
    // parallel minor first (iv, bVI, bVII); in minor keys harmonic minor for V
    // and dorian for IV.
    var CANDIDATE_SCALES = bright
      ? [scale, MODES.minor, MODES.mixolydian, MODES.major, MODES.dorian, HARMONIC_MINOR, MELODIC_MINOR, MODES.lydian]
      : [scale, HARMONIC_MINOR, MODES.dorian, MODES.minor, MELODIC_MINOR, MODES.major, MODES.mixolydian, MODES.lydian];
    function triad(s, deg) {
      var t = (s[(deg + 2) % 7] - s[deg] + 12) % 12, f = (s[(deg + 4) % 7] - s[deg] + 12) % 12;
      return t === 4 && f === 7 ? 'maj' : t === 3 && f === 7 ? 'min' : t === 3 && f === 6 ? 'dim' : 'other';
    }
    function chordFromToken(tok) {
      var m = /^(b?)([IViv]+)(maj7|m7|7|ø7|sus4|sus2|add9)?(?:\/([35]))?$/.exec(tok);
      if (!m) throw new Error('bad chord token ' + tok);
      var deg = ROMAN.indexOf(m[2].toUpperCase());
      var wantMinor = m[2] === m[2].toLowerCase();
      var ext = m[3] || '';
      // bII7: the tritone substitute for V7 (a dominant a half step above the tonic).
      if (m[1] && deg === 1 && ext === '7') return makeChord(1, TRITONE_SUB, { tones: [0, 2, 4, 6], kind: 'sec' });
      var pc = (MODES.major[deg] - (m[1] ? 1 : 0) + 12) % 12;
      var s = null, c;
      for (var i = 0; i < CANDIDATE_SCALES.length && !s; i++) {
        var cs = CANDIDATE_SCALES[i], q = triad(cs, deg);
        // ø7: half-diminished (a diminished triad with a minor 7th, e.g. the ii of a minor key).
        if (cs[deg] === pc && (ext === 'ø7' ? q === 'dim' : wantMinor ? q === 'min' : q === 'maj')) s = cs;
      }
      if (!s) s = scale;
      var tones = ext === 'sus4' ? [0, 3, 4] : ext === 'sus2' ? [0, 1, 4] : ext === 'add9' ? [0, 2, 4, 8] : /7/.test(ext) ? [0, 2, 4, 6] : [0, 2, 4];
      if (ext === '7' && !wantMinor && !m[1] && (s[(deg + 6) % 7] - s[deg] + 12) % 12 !== 10) {
        // X7 where the diatonic chord isn't a dominant 7th: a secondary dominant.
        c = secondaryDominant(scale, (deg + 3) % 7, true);
      } else {
        c = makeChord(deg, s, { tones: tones, kind: s === scale ? 'dia' : 'bor' });
        if (!/7/.test(ext) && tones.length === 3 && s === scale && hr.chance(st.sevenths * 0.5)) c.tones = [0, 2, 4, 6];
      }
      if (m[4]) c.bass = m[4] === '3' ? 2 : 4;
      return c;
    }
    function parseIdiom(p) {
      return p.split('|').map(function (bar) {
        return bar.trim().split(',').map(function (t) { return chordFromToken(t.trim()); });
      });
    }
    var idiomTag = st.idioms;
    var tagMax = 0;
    if (st.tagW) for (var tg in st.tagW) tagMax = Math.max(tagMax, st.tagW[tg]);
    // How well an idiom suits the style (in a mix, the best-suited of its styles, by weight).
    // An idiom marked `only` (the jazz progressions) is never borrowed by other styles.
    function idiomFit(id) {
      var tags = id.tags.split(' ');
      if (!st.tagW) return tags.indexOf(idiomTag) >= 0 ? 1 : id.only ? 0 : 0.15;
      if (id.only && !tags.some(function (t) { return st.tagW[t]; })) return 0;
      var best = 0.15;
      tags.forEach(function (t) { if (st.tagW[t]) best = Math.max(best, st.tagW[t] / tagMax); });
      return best;
    }
    var idiomList = IDIOMS[modeName] || IDIOMS[bright ? 'major' : 'minor'];
    var usedIdioms = [];
    function pickIdiom(role, len) {
      var w = idiomList.map(function (id) {
        var x = id.roles.indexOf(role) >= 0 ? 1 : 0.04;
        x *= idiomFit(id);
        if (usedIdioms.indexOf(id) >= 0) x *= 0.1;
        var n = id.p.split('|').length;
        if (n > len) x *= 0.2;
        return x;
      });
      var sum = w.reduce(function (a, b) { return a + b; }, 0), r = hr.next() * sum;
      for (var i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) break; }
      var id = idiomList[Math.min(i, idiomList.length - 1)];
      usedIdioms.push(id);
      return parseIdiom(id.p);
    }
    var pool = (PROGRESSIONS[modeName] || []).concat(bright ? PROGRESSIONS.bright : PROGRESSIONS.dark);
    if (modeName === 'lydian') pool = PROGRESSIONS.lydian.concat(PROGRESSIONS.bright.filter(function (p) { return p.indexOf(3) < 0; }));
    pool = pool.filter(function (p) { return !p.some(isDim); });
    var markov = MARKOV[modeName];
    // A progression for a section type: usually an idiom that suits the style and
    // the section; sometimes a walk through functional harmony. Returns bars of chords.
    function progression(type, len) {
      if (!hr.chance(st.functional)) return pickIdiom(type, len);
      var starts = {
        A: { 0: 1 },
        B: bright ? { 3: 2, 5: 1.5, 0: 2 } : { 5: 2, 3: 1.5, 0: 1.5 },
        P: bright ? { 3: 3, 1: 2, 5: 1.5 } : { 3: 3, 5: 2, 6: 1 },
        C: bright ? { 5: 3, 3: 2, 1: 1 } : { 3: 2, 6: 2, 2: 1.5 }
      }[type];
      var ends = { A: { 4: 2, 3: 1.5 }, B: { 4: 2, 3: 1.5, 5: 1 }, P: { 4: 6 }, C: { 4: 5, 3: 1 } }[type];
      var degs = [+wpick(hr, filterDeg(starts))];
      for (var i = 1; i < 4; i++) {
        var w = {}, from = markov[degs[i - 1]] || markov[0];
        for (var k in from) if (+k !== degs[i - 1]) w[k] = from[k];
        if (i === 3) for (var e in ends) if (+e !== degs[2]) w[e] = (w[e] || 0.5) * ends[e];
        degs.push(+wpick(hr, filterDeg(w)));
      }
      return degs.map(function (d, j) { return [d === 4 && j === 3 && !bright ? dominant(hr.chance(0.5)) : dia(d)]; });
    }
    function filterDeg(w) {
      var out = {}, any = false;
      for (var k in w) if (!isDim(+k)) { out[k] = w[k]; any = true; }
      return any ? out : { 0: 1 };
    }

    // Per section type: the progression laid out over the section, then embellished.
    function basePlan(prog, L) {
      var pl = [];
      for (var j = 0; j < L; j++) {
        var cs = prog[Math.floor(j / cb) % prog.length];
        var segs = cb > 1 || cs.length === 1 ? [{ s: 0, c: cs[0] }] : [{ s: 0, c: cs[0] }, { s: 8, c: cs[1] }];
        pl.push({ segs: segs, cont: cb > 1 && j % cb !== 0 });
      }
      return pl;
    }
    function embellish(pl) {
      if (cb > 1) return pl;
      var splits = 0;
      for (var j = 0; j < pl.length; j++) {
        var b = pl[j], c = b.segs[0].c, next = j + 1 < pl.length ? pl[j + 1].segs[0].c : null;
        if (b.segs.length > 1) continue;
        // Suspension: Vsus4 resolving to V inside the bar.
        if (c.deg === 4 && !c.bass && c.tones.indexOf(3) < 0 && hr.chance(0.15 + 0.25 * spice)) {
          var res = bright ? c : dominant(c.tones.indexOf(6) >= 0); // resolve to a real V in minor keys
          b.segs = [{ s: 0, c: withProps(res, { tones: c.tones.indexOf(6) >= 0 ? [0, 3, 4, 6] : [0, 3, 4] }) }, { s: 8, c: res }];
        // Modal interchange: IV turning minor (iv) on its way home.
        } else if (bright && c.deg === 3 && c.kind === 'dia' && BORROW_FROM[modeName][3] && next && next.deg === 0 && hr.chance(0.45 * spice)) {
          b.segs = [{ s: 0, c: c }, { s: 8, c: borrowed(3) }];
        // Secondary dominant: tonicize the next chord for half a bar (only onto a
        // diatonic minor or major chord, never onto the tonic, one per phrase).
        } else if (next && next.deg !== c.deg && next.deg !== 0 && !isDim(next.deg) && next.kind === 'dia' && !isDominant(c) && splits < pl.length / 4 && hr.chance(0.3 * spice)) {
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
        if (m.bass || m.tones.length > 3 || m.kind !== 'dia' || hr.next() > 0.3 + 0.4 * spice) continue;
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
    progs.A = progression('A', 8);
    progs.B = progression('B', 8);
    progs.P = progression('P', 4);
    progs.C = progression('C', 8);
    // Vary an idiom without changing what it does: swap a chord for one with
    // the same function (tonic I/vi, subdominant IV/ii), or turn iii into III7
    // (a dominant pulling to vi). Never the first chord, never a dominant.
    var SUBS = bright ? { 0: [5], 5: [0, 3], 3: [1], 1: [3] } : { 0: [2], 2: [0], 3: [1], 5: [3] };
    function vary(prog) {
      return prog.map(function (bar, j) {
        return bar.map(function (c, k) {
          if ((j === 0 && k === 0) || c.kind !== 'dia' || c.bass || isDominant(c) || !hr.chance(spice * 0.22)) return c;
          if (bright && c.deg === 2 && prog[j + 1] && prog[j + 1][0].deg === 5) return secondaryDominant(scale, 5, true);
          var alt = SUBS[c.deg];
          if (!alt) return c;
          var d = hr.pick(alt);
          return isDim(d) ? c : withProps(dia(d), { tones: c.tones.length === 4 ? [0, 2, 4, 6] : [0, 2, 4] });
        });
      });
    }
    ['A', 'B', 'C'].forEach(function (k) { progs[k] = vary(progs[k]); });
    var planCache = {};
    function planFor(type, L) {
      var key = type + L;
      if (!planCache[key]) planCache[key] = embellish(basePlan(progs[type], L));
      return planCache[key].map(function (b) { return { segs: b.segs.map(function (sg) { return { s: sg.s, c: sg.c }; }), cont: b.cont }; });
    }
    function introPlan() { return basePlan(progs[hr.chance(0.5) ? 'B' : 'A'], 4); }
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
    // Lead each section into the next: a pre-chorus always ends on the dominant;
    // otherwise a dominant before the tonic, a secondary dominant before anything
    // else, the new key's V7 before a key change. Each section draws from its
    // own random stream, so its lead-in doesn't depend on how long the song is.
    sections.forEach(function (sec, si) {
      var shared = hr;
      hr = R('leadin-' + si);
      leadIn(sec, si);
      hr = shared;
    });
    function leadIn(sec, si) {
      var next = sections[si + 1] || (loop ? sections[0] : null);
      var b = sec.plan[sec.plan.length - 1];
      if (!next || sec.type === 'outro' || b.cont) return;
      var sh = function (c) { return withProps(c, { shift: sec.shift }); };
      var last = b.segs[b.segs.length - 1].c, x = next.plan[0].segs[0].c;
      if (next.shift !== sec.shift) {
        b.segs = [{ s: 0, c: b.segs[0].c }, { s: 8, c: withProps(dominant(true), { shift: next.shift }) }];
        return;
      }
      if (sec.type === 'P' && !isDominant(last)) {
        var v = dominant(hr.chance(0.5));
        b.segs = hr.chance(0.5) ? [{ s: 0, c: sh(withProps(v, { tones: [0, 3, 4] })) }, { s: 8, c: sh(v) }] : [{ s: 0, c: sh(v) }];
        return;
      }
      if (b.segs.length > 1 || isDominant(last)) return;
      if (x.deg === 0) {
        if (!bright && last.deg === 6) return;
        if (last.deg === 0) {
          b.segs = bright && hr.chance(0.5)
            ? [{ s: 0, c: sh(dia(!isDim(3) && hr.chance(0.5) ? 3 : 1)) }, { s: 8, c: sh(dominant(true)) }]
            : [{ s: 0, c: sh(dominant(hr.chance(0.5))) }];
        } else if (hr.chance(0.35 + 0.5 * spice)) {
          b.segs = [{ s: 0, c: last }, { s: 8, c: sh(dominant(hr.chance(0.6))) }];
        }
      } else if (x.deg !== last.deg && !isDim(x.deg) && hr.chance(0.15 + 0.4 * spice)) {
        b.segs = [{ s: 0, c: last }, { s: 8, c: sh(secondaryDominant(scale, x.deg, true)) }];
      }
    }

    // Jazz harmony: every chord a seventh chord, with tensions from its own scale
    // (a 9th that is a whole step above the root, or b9 on a dominant; a natural
    // 13th on a dominant). The 11th and a b9 on anything but a dominant are avoided.
    if (st.tensions) {
      var tr2 = R('tensions');
      var ivl = function (c, t) { return ((chordPitch(c, c.deg + t) - chordPitch(c, c.deg)) % 12 + 12) % 12; };
      sections.forEach(function (sec) {
        sec.plan.forEach(function (b) {
          b.segs.forEach(function (sg) {
            var c = sg.c;
            if (c.tones.indexOf(3) >= 0 || c.tones.indexOf(1) >= 0) return; // sus chords stay as they are
            var tones = c.tones.slice();
            if (st.sevenths >= 1 && tones.length === 3 && tones.join() === '0,2,4') tones.push(6);
            if (tones.indexOf(6) < 0) { if (tones !== c.tones) sg.c = withProps(c, { tones: tones }); return; }
            var dom = ivl(c, 2) === 4 && ivl(c, 6) === 10, nine = ivl(c, 8);
            if (tones.indexOf(8) < 0 && (nine === 2 || (dom && nine === 1)) && tr2.chance(st.tensions)) tones.push(8);
            if (dom && ivl(c, 12) === 9 && tr2.chance(st.tensions * 0.6)) tones.push(12);
            if (tones.length !== c.tones.length) sg.c = withProps(c, { tones: tones });
          });
        });
      });
    }

    // Arrangement --------------------------------------------------------------
    var PARTS = {
      intro: { drums: 0, pad: true, chords: true, arp: true, guitar: true },
      A: { drums: 1, bass: true, chords: true, lead: true, guitar: true },
      P: { drums: 1, build: true, bass: true, chords: true, pad: true, lead: true, guitar: true },
      B: { drums: 2, bass: true, chords: true, pad: true, arp: true, lead: true, guitar: true },
      C: { drums: 1, bass: 'long', chords: true, pad: true, lead: true },
      drop: { chords: 'still', pad: true, lead: true },
      outro: { pad: true, chords: true, bass: 'long', end: true }
    };
    function partsOf(sec) { return sec.drop ? PARTS.drop : PARTS[sec.type]; }
    var ENERGY = { intro: 0.78, A: 0.84, P: 0.86, B: 1, C: 0.8, outro: 0.8 };
    var fl = R('fills');
    var FILLS = { fourfloor: { roll: 6, stop: 4 }, shuffle: { synco: 5, none: 5 }, swing: { none: 6, stop: 2 }, bossa: { none: 6, stop: 2 }, chip: { roll: 5, synco: 4, stop: 1 }, halftime: { synco: 4, roll: 3, none: 3 } };
    var barInfo = [];
    sections.forEach(function (sec, si) {
      var next = sections[si + 1];
      useSounds(sec.drop ? 'drop' : sec.type);
      for (var j = 0; j < sec.bars; j++) {
        var info = {
          sec: sec, secIndex: si, j: j, segs: sec.plan[j].segs, cont: sec.plan[j].cont, parts: partsOf(sec),
          patKey: sec.drop ? 'drop' : sec.type,
          energy: (sec.drop ? 0.72 : ENERGY[sec.type]) + (sec.type === 'P' ? 0.14 * j / Math.max(1, sec.bars - 1) : 0) + (sec.shift ? 0.05 : 0)
        };
        // A drum fill (or a sudden stop) leads into the next section.
        if (j === sec.bars - 1 && next && kit && sec.type !== 'P' && sec.type !== 'intro' && !sec.drop && sec.bars >= 4) {
          var f = wpick(fl, FILLS[parts.groove] || { roll: 4, synco: 4, stop: 2 });
          if (f === 'stop' && next.type !== 'B') f = 'roll';
          if (f !== 'none') info.fill = f;
          if (f === 'stop') info.stopAt = SPB - 4;
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
      if (swing) sw = s4 === 2 ? swing * 2 : (s4 === 1 || s4 === 3) ? swing : 0;
      var t = (bar * SPB + step + sw) * stepDur;
      if (hum) t += (hum.next() - 0.5) * 0.016 * st.humanize;
      return Math.max(0, t);
    }
    function V(v) { return hum ? clamp(v + (hum.next() - 0.5) * 0.16 * st.humanize, 0.05, 1) : v; }
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
    function nextChordAfter(bar) {
      var nb = bar + spanOf(bar);
      return barInfo[nb] ? barInfo[nb].segs[0] : null;
    }

    // Voice leading: each chord is voiced (within an octave, around chordCenter)
    // to move as little as possible from the previous one.
    var prevVoicing = null;
    function voicing(seg) {
      if (seg.v) return seg.v;
      var vt = seg.c.tones;
      // Rootless voicings (jazz): the bass has the root, so the hands play the
      // 3rd, 7th and tensions (and the 5th only when there is room).
      if (st.rootless && vt.length >= 4) {
        vt = vt.filter(function (t) { return t !== 0; });
        if (vt.length >= 4) vt = vt.filter(function (t) { return t !== 4; });
      }
      var pcs = vt.map(function (t) { return ((keyPc + chordPitch(seg.c, seg.c.deg + t)) % 12 + 12) % 12; });
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
    // A guitar voicing: the bass note low, then chord tones stacked like strings.
    function guitarVoicing(c) {
      var root = 40 + ((keyPc + chordPitch(c, c.deg + c.bass)) % 12 + 12) % 12;
      if (root > 47) root -= 12;
      var pcs = c.tones.slice(0, 4).map(function (t) { return ((keyPc + chordPitch(c, c.deg + t)) % 12 + 12) % 12; });
      var out = [root], m = root;
      for (var i = 0; out.length < 6 && i < 40; i++) {
        m++;
        if (pcs.indexOf(m % 12) >= 0 && m - out[out.length - 1] >= 3) out.push(m);
      }
      return out;
    }
    function bassNote(c, tone) {
      var off = tone === '5' ? 4 : tone === '3' ? 2 : tone === 's' ? 1 : c.bass;
      var m = 36 + keyPc + chordPitch(c, c.deg + off);
      while (m > 42) m -= 12;
      while (m < 31) m += 12;
      if (tone === 'o') m += 12;
      return m + bassOct;
    }
    // A note one step from `to` on the side we come from: chromatic or diatonic.
    function approachNote(from, to, cNext) {
      if (Math.abs(to - from) <= 2) return from;
      var up = to > from;
      if (gr.chance(spice * 0.5)) return to + (up ? -1 : 1);
      var m = 36 + keyPc + chordPitch(cNext, cNext.deg + cNext.bass + (up ? -1 : 1)) + bassOct;
      while (m - to > 6) m -= 12;
      while (to - m > 6) m += 12;
      return m;
    }
    // How long a push into bar nb rings on: as long as the note it replaces on
    // that bar's downbeat (up to the first chord change), so the part does not
    // drop out after anticipating the chord.
    function pushLength(nb, kind) {
      var nx = barInfo[nb];
      if (!nx) return 4;
      var first = nx.segs.length > 1 ? nx.segs[1].s : SPB * spanOf(nb);
      var pattern;
      if (kind === 'bass') pattern = nx.parts.bass === 'long' || soundsOf(nx.patKey).parts.bassLine === 'long' ? [[0, first]] : pat[nx.patKey].bass;
      else pattern = nx.parts.chords === 'still' || nx.sec.type === 'outro' ? [[0, SPB]] : pat[nx.patKey].comp;
      var e0 = null;
      for (var i = 0; i < pattern.length; i++) if (pattern[i][0] === 0) e0 = pattern[i];
      // Without an event on the downbeat, the part comes in at its first event.
      var len = e0 ? e0[1] : pattern.length ? pattern[0][0] : first;
      return Math.max(2, Math.min(len, first));
    }
    // Pattern events inside [s0, end), always starting with one at s0.
    function segEvents(pattern, s0, end, head) {
      var evs = pattern.filter(function (e) { return e[0] >= s0 && e[0] < end; }).map(function (e) { return e.slice(); });
      if (!pattern.noHead && (!evs.length || evs[0][0] !== s0)) evs.unshift([s0, (evs.length ? evs[0][0] : end) - s0].concat(head));
      evs.forEach(function (e) { e[1] = Math.min(e[1], end - e[0]); });
      return evs;
    }

    // Patterns per section type, generated for this song, so repeats sound
    // like the same section.
    var pat = {};
    ['intro', 'A', 'P', 'B', 'C', 'outro', 'drop'].forEach(function (type) {
      useSounds(type);
      var level = { intro: 0, A: 1, P: 1, B: 2, C: 1, outro: 0, drop: 0 }[type];
      var fam = type === 'C' && parts.groove !== 'fourfloor' && parts.groove !== 'halftime' && gr.chance(0.6) ? 'halftime' : parts.groove;
      var three = BEATS === 3;
      var groove = kit ? (three ? makeGroove3 : makeGroove)(gr, fam, level, st.expr.ghost) : null;
      pat[type] = {
        drums: groove,
        drumsVar: groove ? (three ? grooveVariation3 : grooveVariation)(gr, groove) : null,
        // Oom-pah-pah: when the chords take beats 2 and 3, the bass keeps to the downbeat.
        bass: (three ? makeBassLine3 : makeBassLine)(gr, three && parts.comping === 'rhythm' && (parts.bassLine === 'drive' || parts.bassLine === 'offbeat') ? 'root' : parts.bassLine, groove, level, st.melody.sync),
        comp: three && level === 0 && parts.comping === 'rhythm' ? [[0, 12, 0.8]] : (three ? makeComp3 : makeComp)(gr, parts.comping, level, st.melody.sync),
        guitar: parts.guitar !== 'none' ? (three ? makeGuitar3 : makeGuitar)(gr, parts.guitar, level) : null,
        arpShape: gr.pick(['up', 'updown', 'down', 'skip'])
      };
    });

    var E = 1;
    function drum(bar, step, kind, vel, pan) {
      notes.push({ t: T(bar, step), d: stepDur, midi: { kick: 36, snare: 38, clap: 39, hat: 42, pedal: 44, open: 46, crash: 49 }[kind], vel: V(Math.min(1, vel * E)), inst: 'drums', drum: kind, kit: kit, pan: pan || 0 });
    }
    var bassPushed = false, compPushed = false;

    for (var bar = 0; bar < bars; bar++) {
      var info = barInfo[bar];
      useSounds(info.patKey);
      var prt = info.parts;
      var type = info.sec.type;
      var P = pat[info.patKey];
      var lastOfSong = bar === bars - 1;
      var stopAt = info.stopAt || SPB;
      E = info.energy;
      var span = spanOf(bar);
      var segs = info.segs;
      var segEnd = function (k) { return k + 1 < segs.length ? segs[k + 1].s : SPB * span; };
      var nextSeg = nextChordAfter(bar);
      if (!info.cont) segs.forEach(function (sg) { voicing(sg); });

      if (!info.cont) {
        segs.forEach(function (sg) {
          chords.push({
            bar: bar, time: T(bar, sg.s), name: chordName(sg.c, tonicName(sg.c.shift), keyPc), degree: sg.c.deg,
            // Pitch classes (0 = C), root first.
            tones: sg.c.tones.map(function (t) { return ((keyPc + chordPitch(sg.c, sg.c.deg + t)) % 12 + 12) % 12; })
          });
        });
      }

      // Drums --------------------------------------------------------------
      if (kit && prt.drums !== undefined && P.drums) {
        var G = info.j % 4 === 3 && !info.fill && info.j < info.sec.bars - 1 ? P.drumsVar : P.drums;
        if (G.alt && info.j % 2 === 1) G = G.alt; // a two-bar pattern (the bossa clave)
        var buildBar = prt.build && parts.groove !== 'shuffle' && parts.groove !== 'bossa' ?info.j - (info.sec.bars - 2) : -1;
        for (var s = 0; s < stopAt; s++) {
          if (info.fill === 'roll' && s >= SPB - 4) {
            drum(bar, s, snareKind, 0.45 + (s - SPB + 4) * 0.18, 0);
            if (s === SPB - 4 && G.kick[s]) drum(bar, s, 'kick', 1);
            continue;
          }
          if (info.fill === 'synco' && s >= SPB - 8) {
            var so = s - (SPB - 8);
            var sy = { 0: 'kick', 2: 'snare', 3: 'snare', 5: 'snare', 6: 'kick', 7: 'snare' }[so];
            if (sy) drum(bar, s, sy === 'snare' ? snareKind : 'kick', sy === 'kick' ? 0.9 : 0.55 + 0.08 * (so - 2), 0.05);
            if (s % 2 === 0) drum(bar, s, 'hat', 0.4, -0.25);
            continue;
          }
          // Pre-chorus build: the snare speeds up over the last two bars.
          if (buildBar >= 0) {
            var every = buildBar === 1 ? (s < SPB / 2 ? 2 : 1) : 4;
            if (s % every === 0) drum(bar, s, snareKind, 0.3 + 0.6 * (buildBar * SPB + s) / (2 * SPB), 0.05);
            if (s % 4 === 0 && (buildBar === 0 || s < SPB / 2)) drum(bar, s, 'kick', 0.9);
            continue;
          }
          if (G.kick[s]) drum(bar, s, 'kick', G.kick[s]);
          if (G.snare[s]) drum(bar, s, G.snare[s] < 0.3 ? 'snare' : snareKind, G.snare[s], 0.05);
          if (G.open[s]) drum(bar, s, 'open', G.open[s], -0.25);
          else if (G.hat[s]) drum(bar, s, 'hat', G.hat[s] * (prt.drums === 1 ? 0.85 : 1), -0.25);
          if (G.pedal && G.pedal[s]) drum(bar, s, 'pedal', G.pedal[s], 0.3);
        }
      }
      var prevSec = info.secIndex > 0 ? sections[info.secIndex - 1] : null;
      if (kit && info.j === 0 && prevSec && !info.sec.drop && (type === 'B' || type === 'outro' || type === 'C' || prevSec.type === 'intro' || info.sec.shift !== prevSec.shift)) {
        drum(bar, 0, 'crash', 0.8, 0.3);
      }

      // Bass --------------------------------------------------------------
      var pushedIn = bassPushed;
      bassPushed = false;
      if (prt.bass && bassPatch && !info.cont) {
        var bp = prt.bass === 'long' || parts.bassLine === 'long'
          ? (type === 'outro' || span > 1 || parts.bassLine === 'long' ? [[0, SPB * span, 'r', 0.8]] : [[0, 8, 'r', 0.8], [8, SPB - 8, '5', 0.6]])
          : P.bass;
        segs.forEach(function (sg, k) {
          var end = segEnd(k);
          var evs = segEvents(bp, sg.s, end, ['r', 0.9]);
          var nextC = k + 1 < segs.length ? segs[k + 1].c : (nextSeg && barInfo[bar + span].parts.bass ? nextSeg.c : null);
          evs.forEach(function (e, ei) {
            if (e[0] >= stopAt) return;
            if (pushedIn && e[0] === 0) return; // tied over from the anticipation
            var len = Math.min(e[1], stopAt - e[0]);
            if (lastOfSong) len = Math.max(len, SPB);
            var tone = e[2], m, bPatch = bassPatch;
            var lastNote = ei === evs.length - 1 && k === segs.length - 1;
            if (tone === 'p' && lastNote && nextC && !sameChord(nextC, sg.c) && e[0] >= SPB - 4 && stopAt === SPB) {
              m = bassNote(nextC, 'r');
              len += pushLength(bar + span, 'bass');
              bassPushed = true;
              // The push belongs to the next bar: played by the next section's bass.
              var nbS = intoSounds(bar + span);
              if (nbS && nbS.bassPatch) { bPatch = nbS.bassPatch; m += nbS.bassOct - bassOct; }
            } else if ((tone === 'a' || tone === 'p') && ei === evs.length - 1 && ei > 0 && nextC && !sameChord(nextC, sg.c)) {
              m = approachNote(bassNote(sg.c, 'r'), bassNote(nextC, 'r'), nextC);
            } else {
              m = bassNote(sg.c, tone === 'a' || tone === 'p' ? '5' : tone);
            }
            notes.push({ t: T(bar, e[0]), d: len * stepDur * 0.92, midi: m, vel: V(Math.min(1, e[3] * E)), inst: 'bass', patch: bPatch });
          });
        });
      }

      // Final bar of an ending: one sustained chord
      if (prt.end && lastOfSong) {
        var endPatch = padPatch || chordPatch || 'pad';
        voicing(segs[0]).forEach(function (m, i) {
          notes.push({ t: T(bar, 0) + i * (PATCHES[endPatch].roll ? Math.max(0.02, PATCHES[endPatch].roll) : 0), d: barDur, midi: m, vel: 0.8, inst: 'chords', patch: endPatch });
        });
        continue;
      }

      // Chords ------------------------------------------------------------
      var compIn = compPushed;
      compPushed = false;
      if (prt.chords && chordPatch && !info.cont) {
        var still = prt.chords === 'still' || type === 'outro';
        var cp = still ? [[0, SPB, 0.85]] : P.comp;
        var arpRate = parts.comping === 'arpeggio' && chordPatch === 'chipArp' && type !== 'C' && type !== 'intro' && type !== 'outro';
        var chordSpec = PATCHES[chordPatch];
        segs.forEach(function (sg, k) {
          var end = Math.min(segEnd(k), stopAt), vc = voicing(sg);
          if (sg.s >= stopAt) return;
          var evs = arpRate ? [] : segEvents(cp, sg.s, end, [0.85]);
          if (arpRate) for (var cs = sg.s, ci = 0; cs < end; cs++, ci++) evs.push([cs, 1, cs % 4 === 0 ? 0.85 : 0.65, ci % Math.min(3, vc.length)]);
          evs.forEach(function (e, ei) {
            if (compIn && e[0] === 0) return;
            var chord = vc, len = e[1], cPatch = chordPatch, spec = chordSpec;
            if (e[3] === 'p' && ei === evs.length - 1 && k === segs.length - 1 && nextSeg && !sameChord(nextSeg.c, sg.c) && stopAt === SPB) {
              chord = voicing(nextSeg);
              len += pushLength(bar + span, 'chords');
              compPushed = true;
              // The push belongs to the next bar: played by the next section's chord instrument.
              var ncS = intoSounds(bar + span);
              if (ncS && ncS.chordPatch) { cPatch = ncS.chordPatch; spec = PATCHES[cPatch]; }
            }
            var t0 = T(bar, e[0]), vel = V(Math.min(1, e[2] * E));
            // Release-cut: the chord stops short, however long the pattern holds it.
            var dur = function (x) { return spec.gate ? Math.min(x, spec.gate * stepDur) : x; };
            if (typeof e[3] === 'number') {
              var m = chord[e[3] % chord.length] + (e[3] >= chord.length ? 12 : 0);
              notes.push({ t: t0, d: dur(len * stepDur * 0.9), midi: m, vel: vel, inst: 'chords', patch: cPatch });
              return;
            }
            var roll = spec.roll || 0;
            chord.forEach(function (m, i) {
              notes.push({ t: t0 + i * roll, d: dur(len * stepDur * 0.92), midi: m, vel: vel * (cPatch === 'epiano' ? 0.85 : 1), inst: 'chords', patch: cPatch });
            });
            // Left hand (piano, harp): the bass note an octave below on the chord change.
            if (spec.lh && !st.rootless && (e[0] === sg.s || chord !== vc)) {
              var lh = 48 + ((keyPc + chordPitch(sg.c, sg.c.deg + sg.c.bass)) % 12 + 12) % 12;
              if (chord !== vc) lh = 48 + ((keyPc + chordPitch(nextSeg.c, nextSeg.c.deg + nextSeg.c.bass)) % 12 + 12) % 12;
              if (lh > 55) lh -= 12;
              notes.push({ t: t0, d: Math.max(len, 8) * stepDur, midi: lh, vel: vel * 0.8, inst: 'chords', patch: cPatch });
            }
          });
        });
      }

      // Guitar -------------------------------------------------------------
      if (prt.guitar && P.guitar && !info.cont) {
        segs.forEach(function (sg, k) {
          var end = Math.min(segEnd(k), stopAt), gv = guitarVoicing(sg.c);
          if (sg.s >= stopAt) return;
          segEvents(P.guitar, sg.s, end, [0.8, 'D']).forEach(function (e) {
            var t0 = T(bar, e[0]), vel = V(Math.min(1, e[2] * E)), how = e[3];
            if (typeof how === 'number') {
              notes.push({ t: t0, d: e[1] * stepDur, midi: gv[how % gv.length], vel: vel, inst: 'guitar', patch: guitarPatch });
            } else if (how === 'P') {
              // Fingers pinch the top strings together.
              gv.slice(-3).forEach(function (m, i) { notes.push({ t: t0 + i * 0.003, d: e[1] * stepDur, midi: m, vel: vel * 0.8, inst: 'guitar', patch: guitarPatch }); });
            } else if (how === 'C') {
              // Bossa: four fingers pluck the chord at once, lightly, a little short.
              gv.slice(-4).forEach(function (m, i) { notes.push({ t: t0 + i * 0.002, d: e[1] * stepDur * 0.85, midi: m, vel: vel * 0.75, inst: 'guitar', patch: guitarPatch }); });
            } else if (how === 'M') {
              gv.slice(1, 4).forEach(function (m, i) { notes.push({ t: t0 + i * 0.004, d: stepDur * 0.6, midi: m + 12, vel: vel, inst: 'guitar', patch: 'guitarMute' }); });
            } else {
              var strings = how === 'U' ? gv.slice(2).reverse() : gv;
              strings.forEach(function (m, i) {
                notes.push({ t: t0 + i * (how === 'U' ? 0.008 : 0.011), d: e[1] * stepDur * 0.95, midi: m, vel: vel * (how === 'U' ? 0.75 : 1), inst: 'guitar', patch: 'guitar' });
              });
            }
          });
        });
      }

      // Pad ------------------------------------------------------------------
      if (prt.pad && padPatch && !info.cont) {
        segs.forEach(function (sg, k) {
          voicing(sg).forEach(function (m) {
            notes.push({ t: T(bar, sg.s), d: (segEnd(k) - sg.s) * stepDur, midi: m, vel: 0.8 * E, inst: 'chords', patch: padPatch });
          });
        });
      }

      // Arpeggio -------------------------------------------------------------
      if (prt.arp && arpPatch) {
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
        if (parts.arp === 'bells' || parts.arp === 'musicbox') {
          for (var as = 0; as < SPB; as += 2) {
            if (gr.chance(0.4)) notes.push({ t: T(bar, as), d: stepDur * 4, midi: gr.pick(arpFor(as).at), vel: (0.5 + gr.next() * 0.4) * E, inst: 'arp', patch: arpPatch });
          }
        } else {
          var astep = parts.arp === 'sixteenths' || parts.arp === 'digital' ? 1 : 2;
          for (var ar = 0, ai = 0; ar < stopAt; ar += astep, ai++) {
            var sq = arpFor(ar).seq;
            notes.push({ t: T(bar, ar), d: stepDur * astep * 0.8, midi: sq[ai % sq.length], vel: (ar % 4 === 0 ? 0.9 : 0.6) * E, inst: 'arp', patch: arpPatch });
          }
        }
      }
    }

    // Melody --------------------------------------------------------------
    // Sections are built from 4-bar phrases: motif, answer, the motif again
    // (moved onto the new chord, or developed: inverted or with a new ending),
    // cadence. Strong beats sit on chord tones, with the occasional
    // appoggiatura; lines move mostly by step; a repeated section repeats its
    // melody. Each section has one planned high point (late in the chorus,
    // higher still in the last one), and a chorus enters above where the
    // previous section left off.
    var c0 = st.melody.center[0], c1 = st.melody.center[1];
    var lo = c0 - 3, hi = c1 + 6;
    var BASE = { A: c0, B: c1, P: c0 + 1, C: Math.round((c0 + c1) / 2) };
    var REG = { A: [0, 1, 1, 0, 0, 2, 1, 0], B: [0, 1, 2, 1, 0, 2, 3, 1], C: [1, 2, 1, 0, 2, 3, 2, 0], P: [0, 1, 1, 2] };
    var PEAK = { A: { bar: 5, above: 3 }, P: { bar: 2, above: 2 }, B: { bar: 6, above: 5 }, C: { bar: 5, above: 4 } };
    var themes = {};
    // The melody's timing and velocity are humanized from a stream of their own
    // (not after all the accompaniment), so a longer version keeps them.
    if (hum) hum = R('humanize-melody');
    var pending = [];   // pickup notes waiting for the pitch they lead into
    var dropped = [];
    var leadNotes = [];
    var lastLead = null; // scale degree of the last melody note so far
    function pitch(bar, step, d) { return leadBase + chordPitch(chordAt(bar, step), d); }
    sections.forEach(function (sec, si) {
      var prt = partsOf(sec);
      useSounds(sec.drop ? 'drop' : sec.type);
      if (!prt.lead) return;
      var key = sec.type;
      if (!themes[key]) themes[key] = makeTheme(R('motif-' + key), st.melody, key, BEATS, bpm);
      var th = themes[key];
      var mr = R('melody-' + key);
      var base = BASE[key];
      var plan = sec.bars >= 8 ? REG[key] : key === 'P' ? REG.P : [0, 1, 1, 0];
      var nextSec = sections[si + 1];
      var harmonize = st.expr.harmony && key === 'B' && !sec.drop && (si === lastChorus || sec.shift);
      var prev = null;
      var entry = null;
      // Enter the chorus above the previous line: a 3rd to a 5th higher.
      // (The first chorus sets the height; later ones keep it so the hook repeats.)
      if (key === 'B' && lastLead !== null && !sec.drop) {
        var lift = mr.int(2, 4);
        if (th.entry === undefined) th.entry = Math.min(hi - 3, Math.max(base, lastLead + lift));
        entry = Math.min(hi - 3, Math.max(th.entry, lastLead + 1));
      }
      var peakInfo = PEAK[key];
      var peakBar = sec.bars >= 8 ? peakInfo.bar : Math.min(2, sec.bars - 1);
      var peak = Math.min(hi, Math.max(base + peakInfo.above + (si === lastChorus && key === 'B' ? 1 : 0), entry !== null ? entry + 2 : -99));
      var barsData = [];
      for (var j = 0; j < sec.bars; j++) {
        var barIdx = sec.startBar + j;
        var target = base + plan[j % plan.length];
        if (j === 0 && entry !== null) target = entry;
        var role = j % 2 === 0 ? 'motif' : j % 4 === 1 ? 'answer' : 'cadence';
        var half = Math.floor(j / 4) % 2;
        var develop = j === 6 && key !== 'B';
        var rh, degs = [];
        var cAt = function (n) { return chordAt(barIdx, n[0]); };
        if (role === 'motif') {
          rh = develop && th.devel === 'vary' ? th.motifVar : th.motif;
          var sign = develop && th.devel === 'invert' ? -1 : 1;
          var d = nearestChordTone(target, cAt(rh[0]), j === 0 && entry !== null ? 1 : 0, lo, hi);
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
          // The answer heads for its target by steps; once there it stays (a
          // repeated note) or, now and then, moves on the way it was going.
          var lastDir = 0;
          for (i = 0; i < rh.length; i++) {
            var step = clamp(Math.round((target - d) / (rh.length - i)), -2, 2);
            if (step === 0 && lastDir && mr.chance(0.3)) step = lastDir;
            var nd2 = d + step;
            if (nd2 > hi || nd2 < lo) nd2 = d - step;
            var was = d;
            d = isStrong(rh[i]) || i === rh.length - 1 ? nearestChordTone(nd2, cAt(rh[i]), step, lo, hi) : nd2;
            if (d !== was) lastDir = d > was ? 1 : -1;
            degs.push(d);
          }
        } else {
          rh = th.cadences[half];
          var endChord = cAt(rh[rh.length - 1]);
          // A full close on the tonic at the end of a section (not from the
          // pre-chorus, which stays open towards the chorus), a half close elsewhere.
          var full = j === sec.bars - 1 && key !== 'P';
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
            // Metrically strong approach notes are chord tones too (no accented passing tones).
            if (i < rh.length - 1 && isStrong(rh[i])) dd = nearestChordTone(dd, cAt(rh[i]), -dir, lo, hi);
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
        barsData.push({ barIdx: barIdx, rh: rh, degs: degs, role: role });
        prev = degs[degs.length - 1];
      }

      // The high point: one note, on a strong beat of the peak bar, reached from
      // below; nothing else in the section goes as high.
      var pb = barsData[peakBar];
      if (pb && !sec.drop) {
        var pi = -1, best = -1;
        pb.rh.forEach(function (n, i) {
          var score = (isStrong(n) ? 10 : 0) + n[1] + (i === 0 ? 0 : 1);
          if (score > best) { best = score; pi = i; }
        });
        var pc = chordAt(pb.barIdx, pb.rh[pi][0]);
        var top = isChordDeg(pc, peak) ? peak : isChordDeg(pc, peak - 1) ? peak - 1 : isChordDeg(pc, peak + 1) && peak + 1 <= hi + 1 ? peak + 1 : peak;
        pb.degs[pi] = top;
        pb.peak = pi;
        // Approach from below (a leap up of up to a 6th is fine), and come down
        // afterwards - on chord tones wherever the beat is strong.
        var below = function (i, d) {
          if (!isStrong(pb.rh[i])) return d;
          var ch = chordAt(pb.barIdx, pb.rh[i][0]);
          while (d > top - 7 && !isChordDeg(ch, d)) d--;
          return d;
        };
        if (pi > 0 && pb.degs[pi - 1] >= top) pb.degs[pi - 1] = below(pi - 1, top - 2);
        for (var q = pi + 1; q < pb.degs.length; q++) if (pb.degs[q] >= top) pb.degs[q] = below(q, top - (q - pi));
        // Choruses keep their peak unique; pre-choruses stay under theirs so the
        // chorus has room to enter above them. Verses may wander.
        if (key === 'B' || key === 'P') barsData.forEach(function (b) {
          b.degs.forEach(function (x, i) {
            if (b === pb && i === pi) return;
            if (x >= top) {
              var y = top - 1 - (x - top);
              var ch = chordAt(b.barIdx, b.rh[i][0]);
              b.degs[i] = isStrong(b.rh[i]) ? nearestChordTone(y, ch, -1, lo, top - 1) : y;
              if (b.degs[i] >= top) {
                // Nothing fitted below the ceiling: take the nearest chord tone under it.
                var under = top - 1;
                if (isStrong(b.rh[i])) while (under > top - 7 && !isChordDeg(ch, under)) under--;
                b.degs[i] = under;
              }
            }
          });
        });
      }

      // Write the notes (and pickups between phrases).
      barsData.forEach(function (b, j) {
        var rh = b.rh, degs = b.degs, barIdx = b.barIdx;
        if (pending.length) {
          b.pickedUp = true;
          var into = degs[0], fromAbove = mr.chance(0.35);
          // Into a chorus the pickup runs up to it.
          var mustKeep = j === 0 && entry !== null;
          if (mustKeep) fromAbove = false;
          // The run steps into the target. Its first note follows the note
          // before without a breath, so (as a passing note) it is reached by
          // step, or else it is a chord tone; never by a tritone or 7th leap.
          var before = leadNotes.length ? leadNotes[leadNotes.length - 1].n : null;
          if (before && pending[0].t - (before.t + before.d) > stepDur * 3) before = null;
          var runFor = function (above) { return pending.map(function (p, pi) { return into + (above ? 1 : -1) * (pending.length - pi); }); };
          var runOk = function (run) {
            var p0 = pending[0], m0 = leadBase + chordPitch(p0.chord, run[0]);
            if (!before) return true;
            var lp = Math.abs(m0 - before.midi);
            if (lp === 6 || lp === 10 || lp === 11 || lp > 12) return false;
            return Math.abs(run[0] - p0.after) <= 1 || isChordDeg(p0.chord, run[0]);
          };
          var run = runFor(fromAbove);
          if (!runOk(run)) run = runFor(!fromAbove);
          if (!runOk(run)) { run = runFor(fromAbove); run[0] = nearestChordTone(run[0], pending[0].chord, fromAbove ? 1 : -1, lo - 2, hi + 1); }
          if (!runOk(run)) run = mustKeep ? runFor(false) : null;
          pending.forEach(function (p, pi) {
            // A pickup belongs to what it leads into: the next section's instrument plays it.
            p.patch = leadPatch;
            p.into = si;
            if (!run) { dropped.push(p); return; }
            p.midi = leadBase + chordPitch(p.chord, run[pi]);
            if (Math.abs(run[0] - p.after) > 4 && !mustKeep) dropped.push(p);
          });
          pending = [];
        }
        for (var i = 0; i < rh.length; i++) {
          var n = rh[i];
          var vel = (n[0] % 4 === 0 ? 0.88 : 0.72) + (n[0] === 0 ? 0.08 : 0);
          var len = n[1] * stepDur * Math.min(0.97, st.melody.legato + 0.12);
          var note = { t: T(barIdx, n[0]), d: len, midi: pitch(barIdx, n[0], degs[i]), vel: V(Math.min(1, vel * barInfo[barIdx].energy)), inst: 'lead', patch: leadPatch };
          notes.push(note);
          var entry = {
            n: note, phrase: sec.startBar + Math.floor(j / 4) * 4, last: b.role === 'cadence' && i === rh.length - 1,
            deg: degs[i], bar: barIdx, step: n[0], strong: isStrong(n), top: key === 'B' || key === 'P' ? pitch(barIdx, n[0], peak) : 999,
            fixed: b.peak === i || (b.role === 'cadence' && i === rh.length - 1) || (i === 0 && b.pickedUp)
          };
          leadNotes.push(entry);
          if (harmonize) {
            entry.h = { t: note.t, d: len, midi: pitch(barIdx, n[0], harmonyDeg(barIdx, n, degs[i])), vel: note.vel * 0.55, inst: 'lead', patch: leadPatch, pan: -0.35, harmony: true };
            notes.push(entry.h);
          }
        }
        lastLead = degs[degs.length - 1];
        // Pickup into the next phrase when this bar ends early (always into a chorus).
        var endStep = rh[rh.length - 1][0] + rh[rh.length - 1][1];
        var intoChorus = j === sec.bars - 1 && nextSec && nextSec.type === 'B' && !nextSec.drop;
        var leadsOn = b.role !== 'motif' && !st.melody.slow && (j < sec.bars - 1 || (nextSec && partsOf(nextSec).lead));
        // (In 3/4 the pickup falls on beat 3, the classic anacrusis.)
        if (leadsOn && endStep <= SPB - 2 && (mr.chance(0.55) || (intoChorus && endStep <= SPB - 4))) {
          var steps = endStep <= SPB - 4 && (intoChorus || mr.chance(0.5)) ? (intoChorus && endStep <= SPB - 6 && mr.chance(0.5) ? [SPB - 6, SPB - 4, SPB - 2] : [SPB - 4, SPB - 2]) : [SPB - 2];
          steps.forEach(function (s) {
            var p = { t: T(barIdx, s), d: 2 * stepDur * 0.9, midi: 0, vel: V(0.62 + (intoChorus ? 0.1 : 0)), inst: 'lead', patch: leadPatch, after: lastLead, chord: chordAt(barIdx, s) };
            notes.push(p);
            pending.push(p);
          });
        }
      });
    });
    // Also drop a pickup with nothing after it (end of a loop).
    dropped = dropped.concat(pending);
    if (dropped.length) notes = notes.filter(function (n) { return dropped.indexOf(n) < 0; });
    notes.forEach(function (n) { delete n.after; delete n.chord; });

    // Melodic rules, as in voice-leading practice:
    // - a note outside the chord resolves by step to the next note, and is
    //   reached by step (a passing or neighbour note) unless it is accented
    //   (an appoggiatura, which may be leapt to);
    // - no leap of a tritone, a seventh or more than an octave;
    // - a line does not end a phrase on a note outside the chord.
    // A note that breaks one is moved to a chord tone close to the note before.
    var gapOf = function (a, b) { return b.n.t - (a.n.t + a.n.d); };
    function melodicFault(l, k) {
      var a = leadNotes[k - 1], z = leadNotes[k + 1];
      if (a && gapOf(a, l) > stepDur * 3) a = null;
      if (z && gapOf(l, z) > stepDur * 3) z = null;
      if (a) {
        var lp = Math.abs(l.n.midi - a.n.midi);
        if (lp === 6 || lp === 10 || lp === 11 || lp > 12) return true;
      }
      if (isChordDeg(chordAt(l.bar, l.step), l.deg)) return false;
      if (!z || Math.abs(z.deg - l.deg) !== 1) return true;       // unresolved
      return !(l.strong || (a && Math.abs(l.deg - a.deg) <= 1));   // leapt to, unaccented
    }
    var badLeap = function (x, y) { var lp = Math.abs(x - y); return lp === 6 || lp === 10 || lp === 11 || lp > 12; };
    // Move note k to a chord tone near where it was, smooth with its neighbours.
    function repitch(k) {
      var l = leadNotes[k], c = chordAt(l.bar, l.step);
      var a = leadNotes[k - 1], z = leadNotes[k + 1];
      if (a && gapOf(a, l) > stepDur * 3) a = null;
      if (z && gapOf(l, z) > stepDur * 3) z = null;
      var best = null, bestCost = 1e9;
      for (var dd = l.deg - 3; dd <= l.deg + 3; dd++) {
        if (!isChordDeg(c, dd) || dd < lo || dd > hi) continue;
        var m = pitch(l.bar, l.step, dd);
        if (m >= l.top) continue;
        if ((a && badLeap(m, a.n.midi)) || (z && badLeap(m, z.n.midi))) continue;
        var cost = Math.abs(dd - l.deg) + (a ? 0.6 * Math.abs(dd - a.deg) : 0);
        if (cost < bestCost) { bestCost = cost; best = dd; }
      }
      if (best === null) return false;
      l.deg = best;
      l.n.midi = pitch(l.bar, l.step, best);
      if (l.h) l.h.midi = pitch(l.bar, l.step, harmonyDeg(l.bar, [l.step, 4], best));
      return true;
    }
    for (var mpass = 0; mpass < 2; mpass++) {
      leadNotes.forEach(function (l, k) {
        if (!melodicFault(l, k)) return;
        // A note that must stay (the climax, a cadence goal, the target of a
        // pickup) keeps its pitch; the note before it moves instead.
        if (!l.fixed) repitch(k);
        else if (k > 0 && !leadNotes[k - 1].fixed) repitch(k - 1);
      });
    }

    // Outer voices: no parallel (or, after a leap, direct) perfect fifths or
    // octaves between melody and bass from one downbeat to the next. The
    // melody moves to a neighbouring chord tone; the climax, cadence goals and
    // notes reached by a pickup stay, and the note before them moves instead.
    var bassNotes = notes.filter(function (x) { return x.inst === 'bass'; });
    var downBass = [], downLead = [];
    bassNotes.forEach(function (x) {
      for (var b = Math.floor(x.t / barDur - 0.01); b * barDur < x.t + x.d; b++) {
        if (b >= 0 && x.t <= b * barDur + 0.02 && x.t + x.d > b * barDur + 0.02) downBass[b] = x;
      }
    });
    leadNotes.forEach(function (l, k) { l.k = k; if (l.step === 0) downLead[l.bar] = l; });
    var mod12 = function (x) { return ((x % 12) + 12) % 12; };
    function badMotion(pm, pb, m, b) {
      var iv = mod12(m - b);
      if (iv !== 0 && iv !== 7) return false;
      var dm = m - pm, db = b - pb;
      if (!dm || !db || (dm > 0) !== (db > 0)) return false;
      return mod12(pm - pb) === iv || Math.abs(dm) > 2; // parallel, or direct with a leap in the melody
    }
    function neighbours(l) {
      var a = leadNotes[l.k - 1], z = leadNotes[l.k + 1];
      return [a ? a.n.midi : null, z ? z.n.midi : null];
    }
    function moveNote(l, avoid) {
      var c = chordAt(l.bar, l.step), nb = neighbours(l);
      var tries = [-1, 1, -2, 2, -3, 3];
      for (var i = 0; i < tries.length; i++) {
        var d = l.deg + tries[i];
        if (!isChordDeg(c, d) || d < lo || d > hi) continue;
        var m = pitch(l.bar, l.step, d);
        if (m >= l.top) continue;
        if ((nb[0] !== null && Math.abs(m - nb[0]) > 9) || (nb[1] !== null && Math.abs(m - nb[1]) > 9)) continue;
        if ((nb[0] !== null && badLeap(m, nb[0])) || (nb[1] !== null && badLeap(m, nb[1]))) continue;
        if (avoid(m)) continue;
        l.deg = d;
        l.n.midi = m;
        if (l.h) l.h.midi = pitch(l.bar, l.step, harmonyDeg(l.bar, [l.step, 4], d));
        return true;
      }
      return false;
    }
    var prevBar = -1;
    for (var vb = 0; vb < bars; vb++) {
      var L2 = downLead[vb], B2 = downBass[vb];
      if (!L2 || !B2) { prevBar = -1; continue; }
      if (prevBar >= 0 && prevBar === vb - 1) {
        var L1 = downLead[prevBar], B1 = downBass[prevBar];
        if (badMotion(L1.n.midi, B1.midi, L2.n.midi, B2.midi)) {
          var L0 = downLead[prevBar - 1], B0 = downBass[prevBar - 1];
          var ok = !L2.fixed && moveNote(L2, function (m) { return badMotion(L1.n.midi, B1.midi, m, B2.midi); });
          if (!ok && !L1.fixed) moveNote(L1, function (m) {
            return badMotion(m, B1.midi, L2.n.midi, B2.midi) || (L0 && B0 ? badMotion(L0.n.midi, B0.midi, m, B1.midi) : false);
          });
        }
      }
      prevBar = vb;
    }

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
        n.bendTime = n.patch === 'leadSquare' ? 0.04 : 0.08;
      }
      prevLead = n;
    });

    // Metric weight: in 4/4 beats 1 and 3 (and anything held a beat); in 3/4
    // only the downbeat is strong (and anything held two beats or more).
    // The harmony line: a third below, or on strong beats the nearest chord tone 3-6 steps below.
    function harmonyDeg(bar, n, d) {
      var hc = chordAt(bar, n[0]), hd = d - 2;
      if (isStrong(n)) for (var hk = 2; hk <= 5; hk++) if (isChordDeg(hc, d - hk)) { hd = d - hk; break; }
      return hd;
    }
    function isStrong(n) {
      if (BEATS === 3) return n[0] === 0 || n[1] >= 6;
      return n[0] % 8 === 0 || n[1] >= 4 || (n[0] % 4 === 0 && n[1] >= 3);
    }
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

    // The last chorus layers the chorus instrument with another of the chosen
    // ones (lead, chords, pad, arpeggio), for a bigger climax.
    useSounds('B');
    if (lastChorus >= 0) {
      var lc = sections[lastChorus], lc0 = lc.start, lc1 = lc.start + lc.bars * barDur;
      var layer = {};
      [['lead', 'lead', SOUND.lead], ['chords', 'chords', SOUND.chords], ['pad', 'chords', SOUND.pad], ['arp', 'arp', SOUND.arp]].forEach(function (x) {
        var main = parts[x[0]], other = lists[x[0]].filter(function (v) { return v !== main && v !== 'none'; })[0];
        if (main !== 'none' && other && x[2][main] && x[2][other]) layer[x[2][main]] = x[2][other];
      });
    }
    // Layers: the last chorus's extra instrument, and parts.together all the way through.
    var LAYER_SOUND = { lead: SOUND.lead, bass: SOUND.bass, chords: SOUND.chords, pad: SOUND.pad, arp: SOUND.arp };
    var always = {};
    Object.keys(together).forEach(function (k) {
      var S2 = LAYER_SOUND[k], main = S2[together[k][0]];
      always[main] = together[k].slice(1).map(function (v) { return S2[v]; });
    });
    var extra = [];
    if (lastChorus >= 0 || Object.keys(always).length) {
      notes.forEach(function (n) {
        if (n.harmony) return;
        var tos = (always[n.patch] || []).slice();
        // (a part being arranged gets its own layers below)
        var inLast = n.into !== undefined ? n.into === lastChorus : n.t >= lc0 - 1e-6 && n.t < lc1 - 1e-6;
        if (lastChorus >= 0 && layer[n.patch] && !arrangedPatch(n.patch) && inLast && tos.indexOf(layer[n.patch]) < 0) tos.push(layer[n.patch]);
        tos.forEach(function (to) { add(n, to); });
      });
    }
    if (Object.keys(arranged).length) arrange();
    notes = notes.concat(extra);
    notes.forEach(function (n) { delete n.into; });
    function arrangedPatch(p) {
      return Object.keys(arranged).some(function (k) { return LAYER_SOUND[k][arranged[k][0]] === p; });
    }

    // parts.arrange: the extra instruments come in as the song builds. The
    // first verse and the quiet chorus are bare; the second verse and the
    // pre-chorus add one; choruses have them all. On the melody the extra
    // instruments play a counter-line (long chord tones, 3rds and 7ths first,
    // moving by step below the tune), a harmony line a third below, or double
    // the tune; in the bridge the second instrument takes the tune over.
    function arrange() {
      var firstVerse = -1;
      sections.forEach(function (x, i) { if (firstVerse < 0 && x.type === 'A') firstVerse = i; });
      var roleOf = function (si) {
        var x = sections[si];
        if (x.drop) return 'bare';
        if (si === lastChorus) return 'peak';
        if (x.type === 'A') return si === firstVerse ? 'bare' : 'build';
        return { intro: 'intro', P: 'build', B: 'full', C: 'bridge', outro: 'outro' }[x.type];
      };
      var LEAD_JOBS = {
        intro: ['counter'], bare: [], build: ['counter'], full: ['harmony', 'unison', 'unison'],
        peak: ['harmony', 'counter', 'unison'], bridge: ['tune', 'counter'], outro: ['counter']
      };
      var EXTRAS_ON = { intro: 0, bare: 0, build: 1, full: 9, peak: 9, bridge: 1, outro: 9 };
      var inSection = function (n, x) {
        if (n.into !== undefined) return sections[n.into] === x; // a pickup counts with the section it leads into
        return n.t >= x.start - 1e-6 && n.t < x.start + x.bars * barDur - 1e-6;
      };
      Object.keys(arranged).forEach(function (k) {
        var P2 = arranged[k].map(function (v) { return LAYER_SOUND[k][v]; }), main = P2[0];
        var own = notes.filter(function (n) { return n.patch === main && !n.layer; });
        sections.forEach(function (x, si) {
          var role = roleOf(si), mine = own.filter(function (n) { return inSection(n, x); });
          if (k !== 'lead') {
            for (var i = 1; i < P2.length && i <= EXTRAS_ON[role]; i++) mine.forEach(function (n) { add(n, P2[i]); });
            return;
          }
          var tune = mine.filter(function (n) { return !n.harmony; }), harm = mine.filter(function (n) { return n.harmony; });
          (LEAD_JOBS[role] || []).forEach(function (job, j) {
            var p = P2[j + 1];
            if (!p) return;
            if (job === 'tune') tune.forEach(function (n) { n.patch = p; });
            else if (job === 'unison') tune.forEach(function (n) { add(n, p); });
            else if (job === 'counter') counterLine(x, p);
            else if (harm.length) harm.forEach(function (n) { add(n, p); }); // the section already has a harmony line
            else {
              tune.forEach(function (n) {
                var h = harmonyBelow(n);
                if (h === null) return;
                var c = {};
                for (var key in n) c[key] = n[key];
                c.midi = h; c.patch = p; c.vel = n.vel * 0.6; c.harmony = true;
                extra.push(c);
              });
            }
          });
        });
      });
    }
    // A third below in the scale of the chord underneath; a long note takes the
    // nearest chord tone below instead (so held notes are consonant).
    function harmonyBelow(n) {
      var bar = Math.floor(n.t / barDur + 1e-6);
      if (!barInfo[bar]) return null;
      var step = clamp(Math.round((n.t - bar * barDur) / stepDur), 0, SPB - 1), c = chordAt(bar, step);
      var pcs = [];
      for (var d = 0; d < 7; d++) pcs.push(((keyPc + chordPitch(c, d)) % 12 + 12) % 12);
      var d0 = pcs.indexOf(((n.midi % 12) + 12) % 12);
      if (d0 < 0) return null;
      var hd = d0 - 2;
      if (n.d >= stepDur * 3.5) for (var k = 2; k <= 5; k++) if (isChordDeg(c, d0 - k)) { hd = d0 - k; break; }
      var pc = pcs[((hd % 7) + 7) % 7], m = n.midi - 1;
      while (((m % 12) + 12) % 12 !== pc) m--;
      return m;
    }
    // A counter-line for a section: one long note per chord, a guide tone (3rd
    // or 7th, else the 5th) as close as possible to the note before, kept in a
    // band just under the tune.
    function counterLine(x, p) {
      var prevM = leadBase + 2;
      for (var b = x.startBar; b < x.startBar + x.bars; b++) {
        var info = barInfo[b];
        if (!info || info.cont) continue;
        var span = spanOf(b);
        info.segs.forEach(function (sg, k) {
          var end = k + 1 < info.segs.length ? info.segs[k + 1].s : SPB * span;
          var c = sg.c, offs = c.tones.filter(function (t) { return t % 7 !== 0; });
          if (!offs.length) offs = [0];
          var best = null, bestCost = 1e9;
          offs.forEach(function (t) {
            var pc = ((keyPc + chordPitch(c, c.deg + t)) % 12 + 12) % 12;
            var rank = t % 7 === 2 || t % 7 === 6 ? 0 : 1.5;
            for (var m = leadBase - 5; m <= leadBase + 7; m++) {
              if (((m % 12) + 12) % 12 !== pc) continue;
              var cost = Math.abs(m - prevM) + rank;
              if (cost < bestCost) { bestCost = cost; best = m; }
            }
          });
          if (best === null) return;
          prevM = best;
          extra.push({ t: (b * SPB + sg.s) * stepDur, d: (end - sg.s) * stepDur * 0.95, midi: best, vel: 0.5 * info.energy, inst: 'lead', patch: p, counter: true });
        });
      }
    }
    function add(n, to) {
      var c = {};
      for (var key in n) c[key] = n[key];
      c.patch = to;
      c.vel = n.vel * 0.7;
      if (PATCHES[to].gate) c.d = Math.min(c.d, PATCHES[to].gate * stepDur);
      c.layer = true;
      extra.push(c);
    }
    notes.sort(function (a, b) { return a.t - b.t; });

    var body = bars * barDur;
    var tail = loop ? 0 : st.fx.tail;
    var tr = R('title');
    // What each part played: one value, or the list used across the sections.
    var outParts = {};
    PART_KEYS.forEach(function (k) {
      var L = together[k] || arranged[k] || lists[k];
      outParts[k] = L.length === 1 ? L[0] : L.slice();
    });
    if (Object.keys(together).length) outParts.together = Object.keys(together);
    if (Object.keys(arranged).length) outParts.arrange = Object.keys(arranged);
    return {
      version: VERSION,
      title: tr.pick(TITLE_A) + ' ' + tr.pick(TITLE_B),
      seed: seed,
      style: styleName,
      styleLabel: st.label,
      // Weight of each style in the song (1 for a single style).
      mix: mix.list.reduce(function (m, x) { m[x[0]] = Math.round(x[1] * 1000) / 1000; return m; }, {}),
      parts: outParts,
      meter: meter,
      beatsPerBar: BEATS,
      bpm: bpm,
      key: names[keyPc],
      mode: modeName,
      bars: bars,
      loop: loop,
      stepDuration: stepDur,
      barDuration: barDur,
      duration: body + tail,
      loopEnd: body,
      sections: sections.map(function (s) { return { type: s.type, startBar: s.startBar, bars: s.bars, start: s.start, key: tonicName(s.shift), shift: s.shift, drop: !!s.drop }; }),
      chords: chords,
      notes: notes,
      // Mix settings for render() (reverb, delay, sidechain, tape).
      fx: copy(st.fx)
    };
  }

  // The fixed material of a section: rhythms for each phrase role, the
  // motif's melodic shape (in scale steps) and how it is developed. Rhythms
  // are generated from beat cells, or taken from a stock of proven ones.
  function makeTheme(rng, m, type, beats, bpm) {
    var MR = MELODY_RHYTHMS;
    var three = beats === 3;
    function pick(list, target, preferSync) {
      // Swing melodies (m.eighths) keep to the eighth-note grid, which is what gets swung.
      if (m.eighths) {
        var ev = list.filter(function (r) { return r.every(function (x) { return x[0] % 2 === 0 && x[1] % 2 === 0; }); });
        if (ev.length) list = ev;
      }
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
    var sync = m.sync + (type === 'B' ? 0.15 : 0);
    var gen = function () { return !m.slow && rng.chance(m.gen); };
    var rOpt = { eighths: m.eighths, bpm: bpm || 110 };
    var motifs = m.slow ? MR.slowMotif : MR.motif, answersL = m.slow ? MR.slowAnswer : MR.answer, cadL = m.slow ? MR.slowCadence : MR.cadence;
    if (three) {
      // Three beats hold three quarters of the notes; half and full closes
      // have their own rhythms (a full close lands on and holds the downbeat).
      var M3 = MELODY_RHYTHMS_3;
      n = Math.max(1.5, n * 0.75);
      motifs = m.slow ? M3.slowMotif : M3.motif;
      answersL = m.slow ? M3.slowAnswer : M3.answer;
      cadL = m.slow ? M3.slowCadence : M3.halfCadence;
    }
    // J-POP (m.halves, in 4/4) builds its bars from half-bar figures.
    var genR = m.halves && !three
      ? function (t, sy, ans) { return genHalves(rng, t, sy, ans); }
      : function (t, sy, ans) { return genRhythm(rng, t, sy, ans, beats, rOpt); };
    var motif = gen() ? genR(n, sync, false) : pick(motifs, n, type === 'B');
    var other = gen() ? genR(n, sync, false) : pick(motifs, n, false);
    // Same start, new ending: the classic way to vary a repeated motif. A note
    // held over the middle of the bar stops where the new ending comes in.
    var ending = other.filter(function (x) { return x[0] >= 8; });
    var cut = ending.length ? ending[0][0] : beats * 4;
    var motifVar = motif.filter(function (x) { return x[0] < 8; }).map(function (x) { return [x[0], Math.min(x[1], cut - x[0])]; }).concat(ending);
    if (motifVar.length < 2) motifVar = motif;
    var an = three ? n - 1.5 : n - 2;
    var answers = [gen() ? genR(an, sync * 0.7, true) : pick(answersL, an), gen() ? genR(an, sync * 0.7, true) : pick(answersL, an)];
    // Call and response: an answer often starts with the motif's rhythm and
    // settles on a long note, so the two halves of a phrase sound related.
    if (!three) {
      for (var ai = 0; ai < 2; ai++) {
        if (!rng.chance(0.5)) continue;
        var head = motif.filter(function (x) { return x[0] < 8; }).map(function (x) { return [x[0], Math.min(x[1], 8 - x[0])]; });
        if (head.length >= 2) answers[ai] = head.concat(rng.chance(0.5) ? [[8, 8]] : [[8, 4], [12, 4]]);
      }
    }
    var cadences = [pick(cadL, n - 3), pick(three ? (m.slow ? MELODY_RHYTHMS_3.slowCadence : MELODY_RHYTHMS_3.fullCadence) : cadL, n - 3)];
    // A chorus hook should not sink right after its (high) entry.
    var shape = type === 'P' ? 'rise' : type === 'B' ? rng.pick(['arch', 'arch', 'valley', 'rise']) : rng.pick(['rise', 'fall', 'arch', 'arch', 'valley']);
    // A motif needs a shape: a leap or a span of a 4th, at most a 6th, over its
    // notes, not a zig-zag around one pitch. The line keeps its direction (a
    // turn is a single neighbour note); a short note (an eighth or less) leads
    // on by a repeated note or a step, as sung lines do; leaps come from longer
    // notes and are followed by a step back.
    var contour;
    for (var attempt = 0; attempt < 12; attempt++) {
      contour = [];
      var flipped = false;
      for (var i = 1; i < 13; i++) {
        var firstHalf = i < motif.length / 2;
        var dir = shape === 'rise' ? 1 : shape === 'fall' ? -1 : shape === 'arch' ? (firstHalf ? 1 : -1) : (firstHalf ? -1 : 1);
        var prevLen = motif[(i - 1) % motif.length][1];
        var r = rng.next();
        var size = prevLen <= 2 ? (r < 0.35 ? 0 : r < 0.93 ? 1 : 2) : (r < 0.18 ? 0 : r < 0.64 ? 1 : r < 0.9 ? 2 : 3);
        var before = contour[i - 2];
        if (before !== undefined && Math.abs(before) >= 2) { size = 1; dir = before > 0 ? -1 : 1; } // leap, then step back
        else if (!flipped && rng.chance(0.1)) { dir = -dir; flipped = true; }
        else flipped = false;
        contour.push(size * dir);
      }
      var pos = 0, top = 0, bottom = 0, leap = false;
      for (i = 0; i < motif.length - 1; i++) {
        pos += contour[i]; top = Math.max(top, pos); bottom = Math.min(bottom, pos);
        if (Math.abs(contour[i]) >= 2) leap = true;
      }
      if ((leap || top - bottom >= 3) && top - bottom >= 2 && top - bottom <= 5) break;
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
    if (P.wave === 'ks') return renderPluck(ctx, n, P);
    var sr = ctx.sr;
    var start = Math.round(n.t * sr);
    if (start >= ctx.len) return;
    var dur = n.d;
    var total = Math.min(Math.ceil((dur + P.r) * sr), ctx.len - start);
    var f0 = mtof(n.midi + (P.transpose || 0));
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
    // Additive: per-partial phase, frequency ratio (with inharmonicity), level and decay.
    var add = P.wave === 'add', K = add ? P.partials.length : 0;
    var aph = new Float64Array(K), amul = new Float64Array(K), alev = new Float64Array(K), adec = new Float64Array(K);
    var decayScale = Math.pow(261.6 / f0, 0.3); // higher notes die away sooner
    for (var pk = 0; pk < K; pk++) {
      var h = P.partials[pk][0];
      amul[pk] = h * (1 + (P.inh || 0) * h * h);
      alev[pk] = f0 * amul[pk] < sr * 0.45 ? P.partials[pk][1] : 0;
      adec[pk] = P.partials[pk][2] ? Math.exp(-1 / (P.partials[pk][2] * decayScale * sr)) : 1;
      aph[pk] = ctx.rand01();
    }
    var breath = P.breath || 0, blp = 0;
    // Extras (only the patches that ask for them).
    var ifloor = P.ifloor || 0;
    var pwm = P.pwm, ring = P.ring, rph = 0, crush = P.crush, trem = P.trem, tremG = 1;
    var hold = 0, heldL = 0, heldR = 0, qStep = crush ? 2 / Math.pow(2, crush.bits) : 0;
    var holdN = crush ? Math.max(1, Math.round(crush.hold * sr / 44100)) : 0;
    var FB = P.formants, fbank = null;
    if (FB) {
      fbank = FB.map(function (f) { var c = [0, 0, 0, 0]; svfCoefs(f[0], f[1], sr, c); return { c: c, g: f[2], L: new Svf(), R: new Svf() }; });
    }

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
        if (pwm) pw = 0.5 + pwm.depth * Math.sin(TAU * pwm.rate * t + 1.3);
        if (trem) tremG = 1 - trem.depth * (0.5 + 0.5 * Math.sin(TAU * trem.rate * t));
      }
      fenv *= fMul;

      var sL = 0, sR = 0, s;
      var f = f0 * vibf;
      if (add) {
        var dta = f / sr;
        s = 0;
        for (pk = 0; pk < K; pk++) {
          var ap = aph[pk] + dta * amul[pk]; ap -= Math.floor(ap); aph[pk] = ap;
          s += alev[pk] * Math.sin(TAU * ap);
          alev[pk] *= adec[pk];
        }
        if (breath) { blp += 0.2 * (ctx.rand01() * 2 - 1 - blp); s += blp * breath * 4; }
        sL = s; sR = s;
      } else if (fm) {
        var dt0 = f / sr;
        ph[0] += dt0; if (ph[0] >= 1) ph[0] -= 1;
        phm += dt0 * P.ratio; if (phm >= 1) phm -= 1;
        s = ifloor ? Math.sin(TAU * ph[0] + P.index * (ifloor + (1 - ifloor) * ienv) * Math.sin(TAU * phm))
          : Math.sin(TAU * ph[0] + P.index * ienv * Math.sin(TAU * phm));
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
      if (ring) {
        rph += f * ring.ratio / sr; if (rph >= 1) rph -= 1;
        var rm = (1 - ring.mix) + ring.mix * Math.sin(TAU * rph);
        sL *= rm; sR *= rm;
      }
      if (fbank) {
        var xL = sL, xR = sR;
        sL = 0; sR = 0;
        for (var fb = 0; fb < fbank.length; fb++) {
          var B = fbank[fb];
          sL += B.L.run(xL, B.c, 1) * B.g * B.c[3]; sR += B.R.run(xR, B.c, 1) * B.g * B.c[3];
        }
      }
      if (useFilter) { sL = fL.run(sL, coef, 0); sR = fR.run(sR, coef, 0); }
      if (crush) {
        if (hold-- <= 0) { hold = holdN - 1; heldL = Math.round(sL / qStep) * qStep; heldR = Math.round(sR / qStep) * qStep; }
        sL = heldL; sR = heldR;
      }
      var g = env * amp * tremG;
      var j = start + i;
      var oL = sL * g * panL, oR = sR * g * panR;
      L[j] += oL; Rr[j] += oR;
      var mono = (oL + oR) * 0.5;
      if (revS) rev[j] += mono * revS;
      if (dlyS) dly[j] += mono * dlyS;
    }
  }

  // Plucked string (Karplus-Strong): a burst of filtered noise circulating in a
  // delay line one period long, softened a little on every pass.
  function renderPluck(ctx, n, P) {
    var sr = ctx.sr;
    var start = Math.round(n.t * sr);
    if (start >= ctx.len) return;
    var total = Math.min(Math.ceil((n.d + P.r) * sr), ctx.len - start);
    var f0 = mtof(n.midi);
    var period = sr / f0;
    var D = period - 0.5; // the two-point average adds half a sample of delay
    var size = Math.ceil(D) + 4;
    var buf = new Float32Array(size), prevTap = 0;
    // Read D samples behind the write position (a fractional delay, linearly interpolated).
    var whole = Math.floor(D), fr = 1 - (D - whole);
    var wi = 0, ra = (size - whole - 1) % size, rb = (size - whole) % size;
    var fb = Math.pow(0.001, 1 / (P.ring * f0)); // -60 dB after `ring` seconds
    var bright = clamp(P.bright * (0.6 + 0.5 * n.vel), 0.05, 1);
    var burst = Math.round(period), lp = 0, gainX = 1.6 - bright * 0.6;
    var pan = clamp((P.pan || 0) + (n.pan || 0), -1, 1);
    var panL = Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2;
    var panR = Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
    var amp = P.gain * (0.35 + 0.65 * n.vel);
    var L = ctx.music.L, Rr = ctx.music.R, rev = ctx.rev, dly = ctx.dly;
    var revS = P.rev || 0, dlyS = P.dly || 0;
    var rMul = Math.exp(-1 / (Math.max(P.r, 0.001) / 5 * sr)), env = 1, durS = n.d * sr;
    var dcX = 0, dcY = 0;
    // body (Hz): a low-pass for the instrument's body. A low string loses its
    // brightness only once per (long) period, so without it a bass rings
    // twangy like a steel string; a double bass's body keeps the low partials.
    var bodyA = P.body ? 1 - Math.exp(-TAU * P.body / sr) : 0, b1 = 0, b2 = 0;
    for (var i = 0; i < total; i++) {
      var x = 0;
      if (i < burst) { lp += bright * ((ctx.rand01() * 2 - 1) - lp); x = lp * gainX; }
      var a = buf[ra], b = buf[rb];
      var tap = a + (b - a) * fr;
      var y = x + fb * 0.5 * (tap + prevTap);
      prevTap = tap;
      buf[wi] = y;
      if (++wi === size) wi = 0;
      if (++ra === size) ra = 0;
      if (++rb === size) rb = 0;
      if (i >= durS) env *= rMul;
      var o = y - dcX + 0.995 * dcY; dcX = y; dcY = o;
      if (bodyA) { b1 += bodyA * (o - b1); b2 += bodyA * (b1 - b2); o = b2; }
      var g = o * env * amp, j = start + i;
      L[j] += g * panL; Rr[j] += g * panR;
      if (revS) rev[j] += g * revS;
      if (dlyS) dly[j] += g * dlyS;
    }
  }

  function renderDrum(ctx, n) {
    var sr = ctx.sr;
    var start = Math.round(n.t * sr);
    if (start >= ctx.len) return;
    var kit = n.kit, kind = n.drum, vel = n.vel;
    if (kit === 'brush' || kit === 'perc' || kit === 'jazz' || kit === 'bossa') return renderHandDrum(ctx, n);
    // The hi-hat pedal: a soft, short closed hat.
    if (kind === 'pedal') { kind = 'hat'; vel *= 0.55; }
    var boom = kit === 'elec';
    if (boom) kit = 'std';
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
        ph += ((soft ? 48 : boom ? 41 : 44) + (soft ? 90 : boom ? 150 : 120) * Math.exp(-t / (soft ? 0.045 : 0.032))) / sr;
        s = Math.sin(TAU * ph) * Math.exp(-t / (soft ? 0.13 : boom ? 0.3 : 0.18));
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

  // Brushes (soft kick, swished snare, ride cymbal) and hand percussion
  // (conga, rim click, shaker, tambourine).
  var RIDE = [205.3, 304.4, 369.6, 522.7, 540, 800];
  // Jazz: a feathered kick, a stick snare, ride cymbal and hi-hat pedal.
  var HAND_LENS = {
    brush: { kick: 0.5, snare: 0.5, clap: 0.5, hat: 0.9, open: 1.8, crash: 3, pedal: 0.1 },
    jazz: { kick: 0.5, snare: 0.35, clap: 0.35, hat: 0.9, open: 1.8, crash: 3, pedal: 0.1 },
    perc: { kick: 0.6, snare: 0.15, clap: 0.15, hat: 0.15, open: 0.5, crash: 1.5, pedal: 0.15 },
    bossa: { kick: 0.5, snare: 0.15, clap: 0.15, hat: 0.15, open: 0.5, crash: 3, pedal: 0.15 }
  };
  // Bossa: a soft bass drum, rim click, shaker, and a ride cymbal for the crash.
  function renderHandDrum(ctx, n) {
    var sr = ctx.sr, start = Math.round(n.t * sr), kind = n.drum, vel = n.vel, brush = n.kit === 'brush', jazz = n.kit === 'jazz', bossa = n.kit === 'bossa';
    if (start >= ctx.len) return;
    var pan = n.pan || 0;
    var pl = Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2, pr = Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
    var lenSec = HAND_LENS[n.kit][kind] || 0.3;
    var total = Math.min(Math.ceil(lenSec * sr), ctx.len - start);
    var L = ctx.drums.L, R = ctx.drums.R, rev = ctx.rev, rnd = ctx.randSigned;
    var f1 = new Svf(), f2 = new Svf(), c = [0, 0, 0, 0], c2 = [0, 0, 0, 0], ph = 0, revSend = 0.1;
    var metal = ((brush || jazz) && (kind === 'hat' || kind === 'open' || kind === 'crash')) || (bossa && kind === 'crash');
    var mph = metal ? RIDE.map(function () { return ctx.rand01(); }) : null;
    if (kind === 'pedal') {
      // The hi-hat pedal: a short "chick" (a soft shaker in the percussion kit).
      svfCoefs(brush || jazz ? 7000 : 6500, 1.2, sr, c);
      for (var pi = 0; pi < total; pi++) {
        var pt = pi / sr, pe = (1 - Math.exp(-pt / 0.002)) * Math.exp(-pt / (brush || jazz ? 0.022 : 0.04));
        var ps = f1.run(rnd(), c, 1) * pe * (brush || jazz ? 0.26 : 0.2) * vel;
        L[start + pi] += ps * pl; R[start + pi] += ps * pr;
      }
      return;
    }
    if (jazz) {
      if (kind === 'snare' || kind === 'clap') svfCoefs(4000, 0.7, sr, c);
      else svfCoefs(7500, 0.9, sr, c);
    } else if (brush) {
      if (kind === 'snare' || kind === 'clap') svfCoefs(2600, 0.6, sr, c);
      else svfCoefs(7500, 0.9, sr, c);
    } else {
      if (kind === 'snare' || kind === 'clap') { svfCoefs(3200, 2, sr, c); }
      else if (kind === 'hat') svfCoefs(6500, 1.4, sr, c);
      else svfCoefs(8500, 0.8, sr, c);
    }
    svfCoefs(3000, 0.7, sr, c2);
    for (var i = 0; i < total; i++) {
      var t = i / sr, s = 0, e;
      if (kind === 'kick') {
        if (brush || jazz || bossa) {
          ph += (52 + 55 * Math.exp(-t / 0.035)) / sr;
          s = Math.sin(TAU * ph) * Math.exp(-t / 0.16) * 0.8;
          if (jazz && t < 0.003) s += rnd() * 0.15 * (1 - t / 0.003); // the beater
        } else {
          // Conga: a pitched skin with a slap.
          ph += (190 + 45 * Math.exp(-t / 0.015)) / sr;
          s = Math.sin(TAU * ph) * Math.exp(-t / 0.17) * 0.55 + f2.run(rnd(), c2, 1) * Math.exp(-t / 0.006) * 0.35;
        }
      } else if (kind === 'snare' || kind === 'clap') {
        if (jazz) {
          // Stick on the snare: a short tone and the wires.
          ph += (190 + 50 * Math.exp(-t / 0.01)) / sr;
          s = (Math.sin(TAU * ph) * Math.exp(-t / 0.05) * 0.45 + f1.run(rnd(), c, 2) * Math.exp(-t / 0.09) * 0.8) * 0.65;
          revSend = 0.2;
        } else if (brush) {
          // A swish: noise that swells in and dies away slowly.
          e = (1 - Math.exp(-t / 0.012)) * Math.exp(-t / 0.13);
          s = f1.run(rnd(), c, 1) * e * 0.9;
          revSend = 0.2;
        } else {
          // Rim click.
          s = Math.sin(TAU * 1750 * t) * Math.exp(-t / 0.018) * 0.45 + f1.run(rnd(), c, 1) * Math.exp(-t / 0.008) * 0.5;
          revSend = 0.2;
        }
      } else if (metal) {
        // Ride cymbal: six square waves at clashing frequencies, high-passed.
        var m = 0;
        for (var k = 0; k < 6; k++) { mph[k] += RIDE[k] * 2.1 / sr; if (mph[k] >= 1) mph[k] -= 1; m += mph[k] < 0.5 ? 1 : -1; }
        var dec = kind === 'hat' ? 0.3 : kind === 'open' ? 0.7 : 1.6;
        s = f1.run(m / 6 + rnd() * 0.15, c, 2) * Math.exp(-t / dec) * (kind === 'crash' ? 0.4 : 0.3) * (1 - Math.exp(-t / 0.0015));
        revSend = 0.15;
      } else if (kind === 'hat') {
        // Shaker.
        e = (1 - Math.exp(-t / 0.01)) * Math.exp(-t / 0.045);
        s = f1.run(rnd(), c, 1) * e * 0.3;
      } else {
        // Tambourine (open) or a longer shimmer (crash).
        var d2 = kind === 'open' ? 0.14 : 0.5;
        s = f1.run(rnd(), c, 2) * Math.exp(-t / d2) * (0.6 + 0.4 * Math.sin(TAU * 23 * t)) * 0.28;
        revSend = 0.2;
      }
      s *= vel;
      var j = start + i;
      L[j] += s * pl; R[j] += s * pr;
      rev[j] += s * revSend;
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
    var fx = song.fx || (STYLES[song.style] || STYLES.pop).fx;
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
    // Choices for compose({ parts }): { drums: [...], groove: [...], ... }, and each style's defaults.
    parts: JSON.parse(JSON.stringify(PART_OPTIONS)),
    styleParts: STYLE_NAMES.reduce(function (o, k) { o[k] = JSON.parse(JSON.stringify(STYLES[k].parts)); return o; }, {}),
    // Each style's settings in the terms of a custom style (a starting point for one).
    styleSettings: STYLE_NAMES.reduce(function (o, k) { o[k] = styleSettings(STYLES[k]); return o; }, {}),
    modes: Object.keys(MODES),
    keys: NOTE_NAMES.slice()
  };
}));
