/*
 * MIDI export for the music-composition.js site: turns a composed song
 * (MusicComposition.compose) into a Standard MIDI File (format 1).
 *
 *   MCMidi.fromSong(song) -> Uint8Array (the .mid file)
 *
 * One track per instrument sound (General MIDI programs), drums on channel 10,
 * tempo, time and key signatures, section markers and chord names. Timing is
 * written as played (swing and humanized notes included), at 480 ticks per
 * quarter note.
 */
(function (root) {
  'use strict';

  var PPQ = 480;

  // Synth patch -> General MIDI program (0-based).
  var PROGRAM = {
    leadSaw: 81, leadPluck: 84, leadSoft: 80, leadSquare: 80, leadPWM: 80, leadFM: 81, leadRobot: 84,
    flute: 73, whistle: 78, sax: 65, brass: 61, violin: 40, voice: 54, bell: 14, pianoLead: 0,
    vibesLead: 11, harpLead: 46, marimbaLead: 12, musicboxLead: 10, accordionLead: 21,
    piano: 0, cutPiano: 0, epiano: 4, keys: 90, organ: 16, chipArp: 80, harp: 46, marimba: 12,
    vibes: 11, accordion: 21, pizzicato: 45, musicbox: 10,
    pad: 89, padWide: 90, strings: 48, padAmbient: 88, choir: 52,
    arp: 81, bellSoft: 14, harpArp: 46, marimbaArp: 12, musicboxArp: 10, digitalArp: 98,
    bassSaw: 38, bassFinger: 33, bassSine: 39, bassChip: 38, bassUpright: 32, bassFM: 39, tuba: 58,
    guitar: 25, guitarMute: 28, nylon: 24
  };
  // Patches that sound an octave above the written note (the music box).
  var TRANSPOSE = { musicbox: 12, musicboxLead: 12, musicboxArp: 12 };
  // Drum -> General MIDI percussion key, by kit.
  var DRUM_KEYS = {
    std: { kick: 36, snare: 38, clap: 39, hat: 42, pedal: 44, open: 46, crash: 49 },
    brush: { kick: 36, snare: 40, clap: 40, hat: 51, pedal: 44, open: 59, crash: 49 },
    jazz: { kick: 36, snare: 38, clap: 37, hat: 51, pedal: 44, open: 59, crash: 49 },
    perc: { kick: 64, snare: 37, clap: 37, hat: 70, pedal: 69, open: 54, crash: 54 },
    // Bossa: bass drum, side stick, maracas / cabasa, ride.
    bossa: { kick: 35, snare: 37, clap: 37, hat: 70, pedal: 69, open: 54, crash: 51 }
  };
  var INST_NAME = { lead: 'Melody', bass: 'Bass', chords: 'Chords', guitar: 'Guitar', arp: 'Arpeggio' };
  var PADS = { pad: 1, padWide: 1, strings: 1, padAmbient: 1, choir: 1 };
  var INST_ORDER = { lead: 0, chords: 1, guitar: 2, arp: 3, bass: 4 };
  // Key signature: sharps (+) or flats (-) of the relative major, by its pitch class.
  var SHARPS = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 };
  var NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var TO_MAJOR = { major: 0, minor: 3, dorian: 10, mixolydian: 5, lydian: 7 };

  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return Array.prototype.slice.call(new TextEncoder().encode(s));
    return unescape(encodeURIComponent(s)).split('').map(function (c) { return c.charCodeAt(0); });
  }
  function varLen(n) {
    var out = [n & 0x7f];
    while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
    return out;
  }
  function push(out, bytes) { for (var i = 0; i < bytes.length; i++) out.push(bytes[i]); }
  function meta(type, bytes) { return [0xff, type].concat(varLen(bytes.length), bytes); }
  function chunk(id, bytes) {
    var n = bytes.length, out = utf8(id);
    push(out, [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
    push(out, bytes);
    return out;
  }
  // Events [tick, order, bytes] -> an MTrk chunk (delta times, end of track).
  function track(events) {
    events.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var out = [], last = 0;
    events.forEach(function (e) {
      push(out, varLen(Math.max(0, e[0] - last)));
      push(out, e[2]);
      last = Math.max(last, e[0]);
    });
    push(out, [0, 0xff, 0x2f, 0]);
    return chunk('MTrk', out);
  }
  function keySignature(song) {
    var name = song.key, pc = NOTE_PC[name.charAt(0)];
    if (name.charAt(1) === '#') pc++;
    if (name.charAt(1) === 'b') pc--;
    var major = ((pc + (TO_MAJOR[song.mode] || 0)) % 12 + 12) % 12;
    var sf = SHARPS[major];
    // F#/Gb major: follow the song's own spelling.
    if (major === 6 && name.indexOf('b') > 0) sf = -6;
    return meta(0x59, [sf & 255, song.mode === 'minor' ? 1 : 0]);
  }

  function fromSong(song) {
    var tick = function (sec) { return Math.round(sec * song.bpm / 60 * PPQ); };
    var end = song.loop ? song.loopEnd : song.duration;

    // Conductor track: title, tempo, time and key signatures, section markers.
    var conductor = [
      [0, 0, meta(0x03, utf8(song.title))],
      [0, 0, meta(0x01, utf8('music-composition.js ' + (song.version || '') + ' · seed ' + song.seed + ' · ' + (song.styleLabel || song.style)))],
      [0, 0, meta(0x51, (function (us) { return [(us >> 16) & 255, (us >> 8) & 255, us & 255]; })(Math.round(60000000 / song.bpm)))],
      [0, 0, meta(0x58, [song.beatsPerBar || 4, 2, 24, 8])],
      [0, 0, keySignature(song)]
    ];
    var SECTION = { intro: 'Intro', A: 'A (verse)', P: 'Pre-chorus', B: 'Chorus', C: 'Bridge', outro: 'Outro' };
    song.sections.forEach(function (s) {
      var label = (s.drop ? 'Chorus (quiet)' : SECTION[s.type] || s.type) + (s.shift ? ' · key ' + s.key : '');
      conductor.push([tick(s.start), 1, meta(0x06, utf8(label))]);
    });
    var tracks = [track(conductor)];

    // Chord names, as text events, on their own track.
    var chordEvents = [[0, 0, meta(0x03, utf8('Chords (names)'))]];
    song.chords.forEach(function (c) { chordEvents.push([tick(c.time), 1, meta(0x01, utf8(c.name))]); });
    tracks.push(track(chordEvents));

    // Pitched notes grouped by instrument and sound.
    var groups = {}, order = [];
    song.notes.forEach(function (n) {
      if (n.inst === 'drums' || n.t >= end) return;
      var key = n.inst + '/' + n.patch;
      if (!groups[key]) { groups[key] = { inst: n.inst, patch: n.patch, notes: [] }; order.push(key); }
      groups[key].notes.push(n);
    });
    order.sort(function (a, b) { return (INST_ORDER[groups[a].inst] || 9) - (INST_ORDER[groups[b].inst] || 9); });
    var channel = 0;
    order.forEach(function (key) {
      var g = groups[key], ch = channel;
      channel = (channel + 1) % 16;
      if (channel === 9) channel = 10;
      if (ch === 9) ch = 10;
      var ev = [
        [0, 0, meta(0x03, utf8((PADS[g.patch] ? 'Pad' : INST_NAME[g.inst] || g.inst) + ' (' + g.patch + ')'))],
        [0, 0, [0xc0 | ch, PROGRAM[g.patch] || 0]],
        // Pitch-bend range: 2 semitones (for the scoops).
        [0, 0, [0xb0 | ch, 101, 0]], [0, 0, [0xb0 | ch, 100, 0]], [0, 0, [0xb0 | ch, 6, 2]], [0, 0, [0xb0 | ch, 38, 0]]
      ];
      var tr = TRANSPOSE[g.patch] || 0;
      // The same key cannot sound twice on one channel: an earlier note ends where the next begins.
      var list = g.notes.map(function (n) {
        var t0 = tick(n.t), t1 = Math.max(t0 + 1, tick(Math.min(n.t + n.d, end + 4)));
        return { t0: t0, t1: t1, key: Math.max(0, Math.min(127, n.midi + tr)), vel: Math.max(1, Math.min(127, Math.round(n.vel * 127))), n: n };
      }).sort(function (a, b) { return a.t0 - b.t0; });
      var lastOf = {};
      list.forEach(function (x) {
        var p = lastOf[x.key];
        if (p && p.t1 > x.t0) p.t1 = Math.max(p.t0 + 1, x.t0);
        lastOf[x.key] = x;
      });
      list.forEach(function (x) {
        ev.push([x.t0, 2, [0x90 | ch, x.key, x.vel]]);
        ev.push([x.t1, 0, [0x80 | ch, x.key, 64]]);
        // A scoop: start below the note and glide up to it.
        if (x.n.bend) {
          var bt = tick(x.n.t + (x.n.bendTime || 0.08)) - x.t0;
          for (var s = 0; s <= 4; s++) {
            var v = Math.round(8192 + (x.n.bend / 2) * 8191 * (1 - s / 4));
            v = Math.max(0, Math.min(16383, v));
            ev.push([x.t0 + Math.round(bt * s / 4), 1, [0xe0 | ch, v & 127, (v >> 7) & 127]]);
          }
        }
      });
      tracks.push(track(ev));
    });

    // Drums on channel 10.
    var drums = song.notes.filter(function (n) { return n.inst === 'drums' && n.t < end; });
    if (drums.length) {
      var dev = [[0, 0, meta(0x03, utf8('Drums (' + (drums[0].kit || 'std') + ')'))]];
      drums.forEach(function (n) {
        var keys = DRUM_KEYS[n.kit] || DRUM_KEYS.std, key = keys[n.drum] || n.midi;
        var t0 = tick(n.t);
        dev.push([t0, 2, [0x99, key, Math.max(1, Math.min(127, Math.round(n.vel * 127)))]]);
        dev.push([t0 + PPQ / 8, 0, [0x89, key, 64]]);
      });
      tracks.push(track(dev));
    }

    var header = chunk('MThd', [0, 1, (tracks.length >> 8) & 255, tracks.length & 255, (PPQ >> 8) & 255, PPQ & 255]);
    var all = header;
    tracks.forEach(function (t) { push(all, t); });
    return new Uint8Array(all);
  }

  var api = { fromSong: fromSong };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MCMidi = api;
})(typeof self !== 'undefined' ? self : this);
