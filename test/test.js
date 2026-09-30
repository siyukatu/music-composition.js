'use strict';
// Smoke tests for music-composition.js. Run with `npm test`.
const assert = require('assert');
const MusicComposition = require('..');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log('ok   ' + name);
  } catch (err) {
    failures++;
    console.log('FAIL ' + name + '\n     ' + (err && err.message));
  }
}

function readWav(buf) {
  const v = new DataView(buf);
  const str = (o, n) => String.fromCharCode.apply(null, new Uint8Array(buf, o, n));
  return {
    riff: str(0, 4), wave: str(8, 4), fmt: str(12, 4), data: str(36, 4),
    format: v.getUint16(20, true), channels: v.getUint16(22, true),
    sampleRate: v.getUint32(24, true), bits: v.getUint16(34, true),
    dataBytes: v.getUint32(40, true), samples: new Int16Array(buf, 44)
  };
}

test('generate returns a 16-bit stereo PCM WAV', () => {
  const w = readWav(MusicComposition.generate({ seed: 'wav', bars: 8 }));
  assert.strictEqual(w.riff, 'RIFF');
  assert.strictEqual(w.wave, 'WAVE');
  assert.strictEqual(w.fmt, 'fmt ');
  assert.strictEqual(w.data, 'data');
  assert.strictEqual(w.format, 1);
  assert.strictEqual(w.channels, 2);
  assert.strictEqual(w.bits, 16);
  assert.strictEqual(w.sampleRate, 44100);
  assert.strictEqual(w.dataBytes, w.samples.length * 2);
});

test('same seed and options give identical output', () => {
  const a = new Uint8Array(MusicComposition.generate({ seed: 'same', bars: 8, style: 'pop' }));
  const b = new Uint8Array(MusicComposition.generate({ seed: 'same', bars: 8, style: 'pop' }));
  assert.strictEqual(Buffer.compare(Buffer.from(a), Buffer.from(b)), 0);
});

test('different seeds give different songs', () => {
  const a = MusicComposition.compose({ seed: 'one', style: 'pop' });
  const b = MusicComposition.compose({ seed: 'two', style: 'pop' });
  assert.notDeepStrictEqual(a.notes, b.notes);
});

for (const style of MusicComposition.styles) {
  for (const loop of [false, true]) {
    test(`${style}${loop ? ' (loop)' : ''} renders non-silent audio without NaN`, () => {
      const song = MusicComposition.compose({ seed: 'styles', style, loop, bars: 16 });
      assert.strictEqual(song.style, style);
      const w = readWav(MusicComposition.render(song, { sampleRate: 22050 }));
      let peak = 0;
      for (let i = 0; i < w.samples.length; i++) peak = Math.max(peak, Math.abs(w.samples[i]));
      assert.ok(peak > 3000, 'peak too low: ' + peak);
      const expected = Math.round(song.duration * 22050);
      assert.ok(Math.abs(w.samples.length / 2 - expected) <= 2, 'length ' + w.samples.length / 2 + ' vs ' + expected);
    });
  }
}

test('a loop does not go from a verse back to the same verse', () => {
  for (const style of ['pop', 'jpop', 'lofi', 'jazz', 'bossa', 'chiptune'])
    for (let bars = 16; bars <= 64; bars += 8)
      for (const seed of ['a', 'b', 'c']) {
        const s = MusicComposition.compose({ seed, style, loop: true, bars }).sections;
        assert.notStrictEqual(s[s.length - 1].type, s[0].type, `${style} ${bars} bars ${seed}: ${s.map(x => x.type).join(' ')}`);
      }
});

test('loop songs end exactly on the last bar', () => {
  const song = MusicComposition.compose({ seed: 'loop', loop: true, bars: 8 });
  assert.strictEqual(song.duration, song.loopEnd);
  assert.ok(Math.abs(song.loopEnd - song.bars * song.barDuration) < 1e-9);
  assert.ok(!song.sections.some(s => s.type === 'intro' || s.type === 'outro'));
});

test('options are respected', () => {
  const song = MusicComposition.compose({ seed: 'opts', style: 'lofi', key: 'Bb', mode: 'minor', bpm: 80, bars: 17 });
  assert.strictEqual(song.key, 'Bb');
  assert.strictEqual(song.mode, 'minor');
  assert.strictEqual(song.bpm, 80);
  assert.strictEqual(song.bars, 16);
});

test('duration sets the length in seconds, whatever the tempo', () => {
  for (const bpm of [70, 140]) {
    const song = MusicComposition.compose({ seed: 'dur', style: 'pop', bpm, duration: 60 });
    assert.strictEqual(song.bars % 4, 0);
    // Within half a 4-bar block of the target.
    assert.ok(Math.abs(song.duration - 60) <= song.barDuration * 2, bpm + ' BPM: ' + song.duration + 's');
  }
  const loop = MusicComposition.compose({ seed: 'dur', bpm: 120, duration: 32, loop: true });
  assert.strictEqual(loop.bars, 16);
});

test('melodies move mostly by step and stay in range', () => {
  let pairs = 0, wide = 0;
  for (const style of MusicComposition.styles) {
    for (let i = 0; i < 12; i++) {
      const song = MusicComposition.compose({ seed: 'mel' + i, style });
      const lead = song.notes.filter(n => n.inst === 'lead' && !n.harmony);
      assert.ok(lead.length > 0, 'no melody');
      lead.forEach(n => assert.ok(n.midi >= 40 && n.midi <= 100 && n.d > 0, 'bad note ' + JSON.stringify(n)));
      for (let k = 1; k < lead.length; k++) {
        if (lead[k].t - lead[k - 1].t > song.barDuration) continue;
        pairs++;
        if (Math.abs(lead[k].midi - lead[k - 1].midi) > 12) wide++;
      }
    }
  }
  assert.ok(wide / pairs < 0.005, wide + ' leaps wider than an octave in ' + pairs);
});

test('every part choice renders non-silent audio without NaN', () => {
  for (const part of Object.keys(MusicComposition.parts)) {
    for (const value of MusicComposition.parts[part]) {
      const song = MusicComposition.compose({ seed: 'parts', style: 'pop', bars: 8, loop: true, parts: { [part]: value } });
      assert.strictEqual(song.parts[part], value);
      const w = readWav(MusicComposition.render(song, { sampleRate: 16000 }));
      let peak = 0, bad = false;
      for (let i = 0; i < w.samples.length; i++) { const x = w.samples[i]; if (x !== x) bad = true; peak = Math.max(peak, Math.abs(x)); }
      assert.ok(!bad && peak > 3000, part + '=' + value + ': peak ' + peak);
    }
  }
});

test('parts override the style and are reported on the song', () => {
  const song = MusicComposition.compose({ seed: 'p', style: 'lofi', parts: { chords: 'piano', guitar: 'strum', swing: 0 } });
  assert.strictEqual(song.parts.chords, 'piano');
  assert.strictEqual(song.parts.guitar, 'strum');
  assert.strictEqual(song.parts.bass, MusicComposition.styleParts.lofi.bass);
  assert.ok(song.notes.some(n => n.inst === 'guitar'));
  assert.ok(song.notes.some(n => n.patch === 'piano'));
});

test('choruses enter above the line before them and peak once, late', () => {
  let rises = 0, single = 0, late = 0, n = 0;
  for (const style of ['pop', 'jpop', 'dance', 'lofi']) {
    for (let i = 0; i < 15; i++) {
      const song = MusicComposition.compose({ seed: 'climax' + i, style, bars: 64 });
      const chorus = song.sections.find(s => s.type === 'B' && !s.drop);
      const lead = song.notes.filter(x => x.inst === 'lead' && !x.harmony);
      const before = lead.filter(x => x.t < chorus.start - song.barDuration * 0.3).pop();
      const first = lead.find(x => x.t >= chorus.start - 0.01);
      const inChorus = lead.filter(x => x.t >= chorus.start && x.t < chorus.start + chorus.bars * song.barDuration);
      const top = Math.max(...inChorus.map(x => x.midi));
      const peak = inChorus.find(x => x.midi === top);
      n++;
      if (first.midi - before.midi >= 3) rises++;
      if (inChorus.filter(x => x.midi === top).length === 1) single++;
      if ((peak.t - chorus.start) / (chorus.bars * song.barDuration) >= 0.6) late++;
    }
  }
  assert.ok(rises / n >= 0.75, 'chorus rises in ' + rises + '/' + n);
  assert.ok(single / n >= 0.9, 'single peak in ' + single + '/' + n);
  assert.ok(late / n >= 0.9, 'late peak in ' + late + '/' + n);
});

test('pre-choruses end on a dominant chord', () => {
  for (let i = 0; i < 20; i++) {
    const song = MusicComposition.compose({ seed: 'pre' + i, style: 'jpop', bars: 64 });
    for (const s of song.sections.filter(x => x.type === 'P')) {
      const lastBar = s.startBar + s.bars - 1;
      const last = song.chords.filter(c => c.bar === lastBar).pop();
      assert.strictEqual(last.degree, 4, 'seed pre' + i + ': ' + last.name);
    }
  }
});

test('after a key change, the song stays in the new key for at least two choruses', () => {
  let modulated = 0;
  for (let i = 0; i < 30; i++) {
    for (const bars of [32, 48]) {
      const song = MusicComposition.compose({ seed: 'mod' + i, style: 'jpop', bars });
      const k = song.sections.findIndex(s => s.shift);
      if (k < 0) continue;
      modulated++;
      const body = song.sections.slice(k).filter(s => s.type !== 'outro');
      assert.ok(body.reduce((a, s) => a + s.bars, 0) >= 16, song.sections.map(s => s.type + (s.shift ? "'" : '')).join(' '));
      assert.ok(body.filter(s => s.type === 'B').length >= 2 || body[0].type !== 'B', 'two choruses in the new key');
      assert.ok(song.sections.slice(k).every(s => s.shift === song.sections[k].shift), 'no key change back');
    }
  }
  assert.ok(modulated >= 5, 'some J-POP songs change key: ' + modulated);
});

test('3/4: 12-step bars, downbeat kick, chords change on beat 1 or 3, melody phrases start on beats', () => {
  for (const style of MusicComposition.styles) {
    const song = MusicComposition.compose({ seed: 'waltz', style, meter: '3/4', bars: 32 });
    assert.strictEqual(song.meter, '3/4');
    assert.strictEqual(song.beatsPerBar, 3);
    assert.ok(Math.abs(song.barDuration - song.stepDuration * 12) < 1e-9);
    const step = t => Math.round((t % song.barDuration) / song.stepDuration) % 12;
    for (const c of song.chords) assert.ok([0, 8].includes(step(c.time)), style + ': chord ' + c.name + ' at step ' + step(c.time));
    for (const n of song.notes.filter(x => x.drum === 'kick')) {
      const bar = Math.floor(n.t / song.barDuration + 0.02); // humanized timing may land a hair early
      assert.ok(song.notes.some(k => k.drum === 'kick' && Math.abs(k.t - bar * song.barDuration) < 0.03), style + ': bar ' + bar + ' has no downbeat kick');
    }
    const w = readWav(MusicComposition.render(song, { sampleRate: 16000 }));
    assert.ok(Math.abs(w.samples.length / 2 - Math.round(song.duration * 16000)) <= 2);
  }
  assert.throws(() => MusicComposition.compose({ meter: '5/4' }), /unknown meter/);
});

test('4/4 remains the default and is unchanged by the meter option', () => {
  const a = MusicComposition.compose({ seed: 'm', style: 'pop' });
  const b = MusicComposition.compose({ seed: 'm', style: 'pop', meter: '4/4' });
  assert.strictEqual(a.meter, '4/4');
  assert.deepStrictEqual(a.notes, b.notes);
});

test('3/4 brings in instruments that suit it, unless the parts say otherwise', () => {
  const w = MusicComposition.compose({ seed: 'w', style: 'lofi', meter: '3/4', bars: 16 });
  assert.strictEqual(w.parts.drums, 'brush');
  assert.strictEqual(w.parts.bass, 'upright');
  assert.strictEqual(MusicComposition.compose({ seed: 'w', style: 'lofi', bars: 16 }).parts.drums, 'lofi');
  assert.strictEqual(MusicComposition.compose({ seed: 'w', style: 'lofi', meter: '3/4', bars: 16, parts: { drums: 'lofi' } }).parts.drums, 'lofi');
});

test('styles mix: any spelling of the same mix gives the same song', () => {
  const a = MusicComposition.compose({ seed: 'mix', style: 'jpop+lofi', bars: 16 });
  assert.strictEqual(a.style, 'jpop+lofi');
  assert.deepStrictEqual(a.mix, { jpop: 0.5, lofi: 0.5 });
  assert.strictEqual(a.styleLabel, 'J-POP × Lo-fi');
  for (const spec of ['jpop,lofi', 'jpop lofi', ['jpop', 'lofi'], { jpop: 1, lofi: 1 }, 'JPOP+lofi:1']) {
    assert.deepStrictEqual(MusicComposition.compose({ seed: 'mix', style: spec, bars: 16 }).notes, a.notes, JSON.stringify(spec));
  }
  const groups = [['drums', 'groove', 'swing'], ['bass', 'bassLine'], ['chords', 'comping'], ['guitar'], ['pad'], ['lead'], ['arp']];
  const from = { jpop: 0, lofi: 0 };
  for (let i = 0; i < 30; i++) {
    const s = MusicComposition.compose({ seed: 'mix' + i, style: 'jpop:3+lofi', bars: 8 });
    assert.strictEqual(s.style, 'jpop:3+lofi:1');
    assert.ok(s.bpm >= 113 && s.bpm <= 151, 'bpm ' + s.bpm);
    for (const g of groups) {
      const src = ['jpop', 'lofi'].filter(st => g.every(k => s.parts[k] === MusicComposition.styleParts[st][k]));
      assert.ok(src.length, g.join('+') + ' comes from one of the styles');
      from[src[0]]++;
    }
  }
  assert.ok(from.jpop > from.lofi * 1.8 && from.lofi > 0, JSON.stringify(from));
  assert.throws(() => MusicComposition.compose({ style: 'jpop+polka' }), /unknown style/);
});

test('custom styles change the base style and render on their own', () => {
  const def = {
    name: 'Night Walk', base: 'lofi+ambient', bpm: [90, 96], modes: ['minor'], parts: { lead: 'violin', drums: 'brush' },
    form: { pre: 1, bridge: 0, drop: 0 }, spice: 0.2, reverb: 0.2, lofi: false
  };
  for (let i = 0; i < 6; i++) {
    const s = MusicComposition.compose({ seed: 'c' + i, style: def, bars: 48 });
    assert.strictEqual(s.style, 'custom');
    assert.strictEqual(s.styleLabel, 'Night Walk');
    assert.ok(s.bpm >= 90 && s.bpm <= 96);
    assert.strictEqual(s.mode, 'minor');
    assert.strictEqual(s.parts.lead, 'violin');
    assert.ok(s.sections.some(x => x.type === 'P') && !s.sections.some(x => x.type === 'C'));
    assert.ok(Math.abs(s.fx.wet - 0.28) < 1e-9 && s.fx.lofi === false);
  }
  const over = MusicComposition.compose({ seed: 'c', style: def, bars: 8, parts: { lead: 'harp' } });
  assert.strictEqual(over.parts.lead, 'harp');
  assert.deepStrictEqual(MusicComposition.compose({ seed: 'c', style: def, bars: 8 }).notes, MusicComposition.compose({ seed: 'c', style: JSON.parse(JSON.stringify(def)), bars: 8 }).notes);
  const w = readWav(MusicComposition.render(JSON.parse(JSON.stringify(over)), { sampleRate: 16000 }));
  assert.ok(w.samples.some(x => Math.abs(x) > 3000));
  assert.throws(() => MusicComposition.compose({ style: { base: 'pop', tempo: 100 } }), /unknown style setting/);
  assert.throws(() => MusicComposition.compose({ style: { base: 'pop', spice: 3 } }), /spice/);
  assert.throws(() => MusicComposition.compose({ style: { modes: ['phrygian'] } }), /unknown mode/);
});

test('a list of parts is used across the song: verse, chorus, bridge; the last chorus layers them', () => {
  let layered = 0, pickups = 0;
  for (let i = 0; i < 12; i++) {
    const o = { seed: 'ch' + i, style: 'jpop', bars: 64, parts: { lead: ['violin', 'flute'], chords: ['piano', 'harp', 'none'] } };
    const s = MusicComposition.compose(o);
    assert.deepStrictEqual(MusicComposition.compose(o).notes, s.notes);
    assert.deepStrictEqual(s.parts.lead.slice().sort(), ['flute', 'violin']);
    // (Pickups at the end of a section lead into the next one: leave the last bar out here.)
    const lead = s.notes.filter(n => n.inst === 'lead' && !n.layer);
    const leadIn = type => new Set(lead.filter(n => s.sections.some(x => x.type === type && n.t >= x.start && n.t < x.start + (x.bars - 1) * s.barDuration)).map(n => n.patch));
    const a = leadIn('A'), b = leadIn('B');
    assert.strictEqual(a.size, 1);
    assert.strictEqual(b.size, 1);
    assert.notDeepStrictEqual([...a], [...b], 'verse and chorus use different leads');
    // A pickup that runs from a section into the next one is played by the next one's instrument.
    s.sections.forEach((x, k) => {
      const nx = s.sections[k + 1];
      if (!nx || x.type === 'intro') return;
      const end = x.start + x.bars * s.barDuration;
      const into = lead.filter(n => n.t >= end - s.barDuration / 2 && n.t < end - 1e-6 && Math.abs(n.d - 2 * s.stepDuration * 0.9) < 1e-6);
      const nextPatch = lead.find(n => n.t >= end - 1e-6);
      if (!into.length || !nextPatch) return;
      into.forEach(n => { pickups++; assert.strictEqual(n.patch, nextPatch.patch, x.type + ' -> ' + nx.type); });
    });
    // 'none' among others: some sections go without chords, the chorus keeps them.
    assert.notStrictEqual(s.parts.chords[1], 'none');
    if (s.notes.some(n => n.layer)) layered++;
  }
  assert.ok(layered >= 10, layered + ' songs layered the last chorus');
  assert.ok(pickups >= 10, pickups + ' pickups checked');
  assert.throws(() => MusicComposition.compose({ parts: { lead: ['violin', 'kazoo'] } }), /unknown lead/);
});

test('parts.together layers the listed instruments all the way through', () => {
  const s = MusicComposition.compose({ seed: 'tg', style: 'jpop', bars: 32, parts: { lead: ['flute', 'violin'], bass: ['finger', 'sine'], together: ['lead', 'bass'] } });
  assert.deepStrictEqual(s.parts.together, ['lead', 'bass']);
  for (const sec of s.sections.filter(x => x.type === 'A' || x.type === 'B')) {
    const ns = s.notes.filter(n => n.inst === 'lead' && !n.harmony && n.t >= sec.start && n.t < sec.start + sec.bars * s.barDuration);
    const main = ns.filter(n => !n.layer), dup = ns.filter(n => n.layer);
    assert.ok(main.length > 4 && dup.length === main.length, sec.type + ': every lead note doubled');
    assert.notStrictEqual(main[0].patch, dup[0].patch);
  }
  assert.ok(s.notes.some(n => n.inst === 'bass' && n.layer));
  assert.throws(() => MusicComposition.compose({ parts: { together: ['drums'] } }), /cannot be layered/);
});

test('parts.arrange brings layers in as the song builds; extra leads play counter-lines and harmony', () => {
  let counters = 0, harmonies = 0, checked = 0, clash = 0, tones = 0;
  for (let i = 0; i < 8; i++) {
    const s = MusicComposition.compose({ seed: 'arr' + i, style: 'jpop', bars: 72, parts: { lead: ['flute', 'violin'], chords: ['piano', 'harp'], arrange: ['lead', 'chords'] } });
    assert.deepStrictEqual(s.parts.arrange, ['lead', 'chords']);
    const inSec = (n, x) => n.t >= x.start - 1e-6 && n.t < x.start + x.bars * s.barDuration - 1e-6;
    const firstVerse = s.sections.find(x => x.type === 'A');
    const extraIn = x => s.notes.filter(n => inSec(n, x) && (n.layer || n.counter || (n.harmony && n.inst === 'lead' && n.patch === 'violin')));
    assert.strictEqual(extraIn(firstVerse).length, 0, 'the first verse is bare');
    const chorus = s.sections.find(x => x.type === 'B' && !x.drop);
    assert.ok(extraIn(chorus).length > 10, 'the chorus is layered');
    // Decorations are consonant: counter-line notes are chord tones, and held harmony notes too.
    const chordAt = t => { let c = s.chords[0]; for (const x of s.chords) if (x.time <= t + 0.03) c = x; return c.tones; };
    for (const n of s.notes) {
      if (n.counter) { counters++; tones++; if (!chordAt(n.t + 0.01).includes(n.midi % 12)) clash++; }
      if (n.harmony && n.patch === 'violin') { harmonies++; if (n.d >= s.stepDuration * 3.5) { tones++; if (!chordAt(n.t + 0.01).includes(n.midi % 12)) clash++; } }
    }
    checked++;
  }
  assert.ok(counters > 50 && harmonies > 50, counters + ' counter-line notes, ' + harmonies + ' harmony notes');
  assert.ok(clash / tones < 0.02, clash + ' of ' + tones + ' long decoration notes off the chord');
});

test('extend lengthens a song so it ends on a whole chorus', () => {
  const LEN = { A: 8, P: 4, B: 8, C: 8 };
  const ok = s => {
    const body = s.sections.filter(x => x.type !== 'intro' && x.type !== 'outro'), last = body[body.length - 1];
    if (body.length === 1 && last.bars === LEN[last.type]) return true;
    return last.type === 'B' && !last.drop && body.every(x => x.bars === LEN[x.type]);
  };
  let bad = 0, badBefore = 0, n = 0;
  for (const style of ['pop', 'jpop', 'lofi', 'ambient']) {
    for (let i = 0; i < 20; i++) {
      const o = { seed: 'ex' + i, style, duration: 30 + i * 5 };
      const a = MusicComposition.compose(o), e = MusicComposition.compose(Object.assign({ extend: true }, o));
      n++;
      if (!ok(a)) badBefore++;
      if (!ok(e)) bad++;
      if (e.bars > a.bars) assert.ok(e.duration - a.duration <= 30.5 + e.barDuration * 8, 'extended by ' + (e.duration - a.duration));
    }
  }
  assert.ok(badBefore > n / 3, badBefore + ' bad endings without extend');
  assert.ok(bad <= n * 0.05, bad + ' of ' + n + ' still end mid-section');
  // A song that already ends well is not changed.
  let checked = 0;
  for (let bars = 24; bars <= 48; bars += 4) {
    const same = MusicComposition.compose({ seed: 'ex', style: 'pop', bars });
    if (!ok(same)) continue;
    checked++;
    assert.deepStrictEqual(MusicComposition.compose({ seed: 'ex', style: 'pop', bars, extend: true }).notes, same.notes);
  }
  assert.ok(checked > 0);
});

test('parts.sometimes leaves parts out of some songs', () => {
  let without = 0;
  for (let i = 0; i < 40; i++) {
    const s = MusicComposition.compose({ seed: 'so' + i, style: 'jpop', bars: 8, parts: { sometimes: ['guitar'] } });
    if (s.parts.guitar === 'none') { without++; assert.ok(!s.notes.some(n => n.inst === 'guitar')); }
  }
  assert.ok(without > 8 && without < 32, without + ' of 40 without guitar');
  assert.throws(() => MusicComposition.compose({ parts: { sometimes: ['lead'] } }), /cannot be left out/);
});

test('jazz: seventh chords with tensions, ii-V motion, rootless piano, walking bass, swing', () => {
  let chords = 0, sevenths = 0, twoFives = 0, pianoNotes = 0, rootInHands = 0, walk = 0, bassNotes = 0, rides = 0;
  for (let i = 0; i < 10; i++) {
    const s = MusicComposition.compose({ seed: 'jazz' + i, style: 'jazz', bars: 48, parts: { swing: 0 } });
    assert.strictEqual(s.parts.groove, 'swing');
    s.chords.forEach((c, k) => {
      chords++;
      if (c.tones.length >= 4 || /sus/.test(c.name)) sevenths++;
      const nx = s.chords[k + 1];
      // ii-V: a minor seventh (or half-diminished) chord followed by a dominant a fourth up.
      if (nx && /m7|m9|m7b5|m9b5/.test(c.name) && /^[A-G][b#]?(7|9|13)/.test(nx.name) && (nx.tones[0] - c.tones[0] + 12) % 12 === 5) twoFives++;
    });
    const chordAt = t => { let c = s.chords[0]; for (const x of s.chords) if (x.time <= t + 0.03) c = x; return c; };
    s.notes.forEach(n => {
      if (n.patch === 'piano') { pianoNotes++; if (n.midi % 12 === chordAt(n.t).tones[0]) rootInHands++; }
      if (n.inst === 'bass') { bassNotes++; if (Math.abs(n.d - s.stepDuration * 4 * 0.92) < 0.02) walk++; }
      if (n.drum === 'hat') rides++;
    });
    assert.ok(s.notes.some(n => n.drum === 'pedal'), 'hi-hat pedal on 2 and 4');
  }
  assert.ok(sevenths / chords > 0.97, sevenths + ' of ' + chords + ' chords are seventh chords or more');
  assert.ok(twoFives > 40, twoFives + ' ii-V moves');
  assert.ok(rootInHands / pianoNotes < 0.15, rootInHands + ' of ' + pianoNotes + ' piano notes double the root');
  assert.ok(walk / bassNotes > 0.6, walk + ' of ' + bassNotes + ' bass notes walk in quarters');
  assert.ok(rides > 1000);
});

test('bossa nova: the bossa clave over two bars, bass on 1 and the "and" of 2, nylon batida, seventh chords', () => {
  let chords = 0, sevenths = 0, rims = 0, onClave = 0, bassNotes = 0, bossaBass = 0, plucks = 0;
  // The 3-2 bossa clave in 16ths over two bars: 0, 6, 12 | 4, 10.
  const CLAVE = [[0, 6, 12, 13, 14], [4, 10, 13, 14]];
  for (let i = 0; i < 8; i++) {
    const s = MusicComposition.compose({ seed: 'bossa' + i, style: 'bossa', bars: 32 });
    assert.strictEqual(s.parts.groove, 'bossa');
    assert.strictEqual(s.parts.swing, 0);
    s.chords.forEach(c => { chords++; if (c.tones.length >= 4) sevenths++; });
    assert.ok(s.chords.every(c => !/bb|##/.test(c.name)), 'no double accidentals: ' + s.chords.map(c => c.name).join(' '));
    const sd = s.stepDuration;
    s.sections.filter(x => x.type !== 'intro' && x.type !== 'outro').forEach(sec => {
      s.notes.forEach(n => {
        const step = Math.round((n.t - sec.start) / sd);
        if (step < 0 || step >= sec.bars * 16) return;
        const j = Math.floor(step / 16), p = step % 16;
        if (n.drum === 'snare') { rims++; if (CLAVE[j % 2].includes(p)) onClave++; }
        if (n.inst === 'bass') { bassNotes++; if ([0, 6, 8, 14].includes(p)) bossaBass++; }
        if (n.patch === 'nylon') plucks++;
      });
    });
  }
  assert.ok(sevenths / chords > 0.95, sevenths + ' of ' + chords + ' chords are seventh chords');
  assert.ok(rims > 200 && onClave / rims > 0.95, onClave + ' of ' + rims + ' rim clicks on the clave');
  assert.ok(bossaBass / bassNotes > 0.9, bossaBass + ' of ' + bassNotes + ' bass notes on 1, the "and" of 2, 3, the "and" of 4');
  assert.ok(plucks > 1000, plucks + ' nylon guitar notes');
});

test('release-cut piano stops short; stabs sit on the offbeats', () => {
  const s = MusicComposition.compose({ seed: 'cut', style: 'dance', bars: 16, parts: { chords: 'cutpiano', comping: 'stab' } });
  const ch = s.notes.filter(n => n.patch === 'cutPiano');
  assert.ok(ch.length > 20);
  assert.ok(ch.every(n => n.d <= s.stepDuration * 1.6 + 1e-9));
  const off = ch.filter(n => Math.round(n.t / s.stepDuration) % 4 === 2).length;
  assert.ok(off / ch.length > 0.6, off + ' of ' + ch.length + ' on the offbeat');
});

// Strict voice-leading and harmony checks, in both meters.
for (const meter of ['4/4', '3/4']) {
  test(meter + ': strong-beat melody notes are chord tones, outer voices avoid parallel 5ths/8ves', () => {
    let strong = 0, off = 0, downbeats = 0, parallels = 0;
    for (const style of ['pop', 'jpop', 'dance', 'lofi', 'jazz', 'bossa', 'jpop+lofi', 'pop:2+chiptune']) {
      for (let i = 0; i < 12; i++) {
        const song = MusicComposition.compose({ seed: 'rules' + i, style, meter, bars: 48 });
        const spb = song.beatsPerBar * 4, sd = song.stepDuration, bd = song.barDuration;
        const lead = song.notes.filter(n => n.inst === 'lead' && !n.harmony);
        const chordAt = t => { let c = song.chords[0]; for (const x of song.chords) if (x.time <= t + 0.03) c = x; return c.tones; };
        const pos = n => Math.floor((n.t / sd) % spb + 0.25) % spb;
        lead.forEach((n, k) => {
          const p = pos(n), len = n.d / sd;
          const isStrong = spb === 12 ? p === 0 || len >= 5.5 : p % 8 === 0 || len >= 3.8 || (p % 4 === 0 && len >= 2.8);
          if (!isStrong) return;
          strong++;
          if (chordAt(n.t).includes(n.midi % 12)) return;
          const nx = lead[k + 1]; // an appoggiatura resolving down by step is allowed
          if (nx && n.midi - nx.midi >= 1 && n.midi - nx.midi <= 2 && chordAt(nx.t).includes(nx.midi % 12)) return;
          off++;
        });
        const bass = song.notes.filter(n => n.inst === 'bass');
        let prev = null;
        for (let b = 0; b < song.bars; b++) {
          const t = b * bd + 0.02;
          const m = lead.find(n => n.t <= t && n.t + n.d > t), bs = bass.find(n => n.t <= t && n.t + n.d > t);
          if (!m || !bs) { prev = null; continue; }
          downbeats++;
          const iv = ((m.midi - bs.midi) % 12 + 12) % 12;
          if (prev && (iv === 0 || iv === 7) && prev.iv === iv && m.midi !== prev.m && bs.midi !== prev.b &&
              Math.sign(m.midi - prev.m) === Math.sign(bs.midi - prev.b)) parallels++;
          prev = { iv, m: m.midi, b: bs.midi };
        }
      }
    }
    assert.ok(off / strong < 0.01, off + ' strong-beat non-chord tones in ' + strong);
    assert.ok(parallels / downbeats < 0.04, parallels + ' parallel 5ths/8ves in ' + downbeats + ' downbeats');
  });
}

// The melodic line itself, as voice-leading practice has it.
for (const meter of ['4/4', '3/4']) {
  test(meter + ': melodies resolve non-chord tones by step, avoid tritone and 7th leaps, and repeat notes', () => {
    let pairs = 0, repeats = 0, badLeaps = 0, notes = 0, unresolved = 0;
    for (const style of ['pop', 'jpop', 'dance', 'lofi', 'jazz', 'bossa', 'jpop+lofi']) {
      for (let i = 0; i < 8; i++) {
        const s = MusicComposition.compose({ seed: 'line' + i, style, meter, bars: 48 });
        const sd = s.stepDuration;
        const lead = s.notes.filter(n => n.inst === 'lead' && !n.harmony && !n.layer && !n.counter).sort((a, b) => a.t - b.t);
        const chordAt = t => { let c = s.chords[0]; for (const x of s.chords) if (x.time <= t + 0.03) c = x; return c.tones; };
        lead.forEach((n, k) => {
          notes++;
          const a = k > 0 && n.t - (lead[k - 1].t + lead[k - 1].d) <= sd * 3 ? lead[k - 1] : null;
          const z = k + 1 < lead.length && lead[k + 1].t - (n.t + n.d) <= sd * 3 ? lead[k + 1] : null;
          if (a) {
            pairs++;
            const lp = Math.abs(n.midi - a.midi);
            if (lp === 0) repeats++;
            if (lp === 6 || lp === 10 || lp === 11 || lp > 12) badLeaps++;
          }
          if (!chordAt(n.t).includes(n.midi % 12) && (!z || z.midi === n.midi || Math.abs(z.midi - n.midi) > 2)) unresolved++;
        });
      }
    }
    assert.ok(unresolved / notes < 0.015, unresolved + ' unresolved non-chord tones in ' + notes);
    assert.ok(badLeaps / pairs < 0.004, badLeaps + ' tritone/7th leaps in ' + pairs);
    assert.ok(repeats / pairs > 0.18, (100 * repeats / pairs).toFixed(0) + '% repeated notes');
  });
}

// Moods and contrasting sections ------------------------------------------------
const MOODS = ['bright', 'dark', 'sad', 'calm', 'energetic', 'dreamy', 'tense'];
// The same rules as above, counted for one song.
function ruleCounts(s, c) {
  const sd = s.stepDuration, spb = s.beatsPerBar * 4;
  const lead = s.notes.filter(n => n.inst === 'lead' && !n.harmony && !n.layer && !n.counter).sort((a, b) => a.t - b.t);
  const chordAt = t => { let x = s.chords[0]; for (const y of s.chords) if (y.time <= t + 0.03) x = y; return x.tones; };
  lead.forEach((n, k) => {
    c.notes++;
    const p = Math.floor((n.t / sd) % spb + 0.25) % spb, len = n.d / sd;
    const a = k > 0 && n.t - (lead[k - 1].t + lead[k - 1].d) <= sd * 3 ? lead[k - 1] : null;
    const z = k + 1 < lead.length && lead[k + 1].t - (n.t + n.d) <= sd * 3 ? lead[k + 1] : null;
    if (a) { c.pairs++; const lp = Math.abs(n.midi - a.midi); if (lp === 6 || lp === 10 || lp === 11 || lp > 12) c.badLeaps++; }
    const inChord = chordAt(n.t).includes(n.midi % 12);
    if (!inChord && (!z || z.midi === n.midi || Math.abs(z.midi - n.midi) > 2)) c.unresolved++;
    if (p % 8 === 0 || len >= 3.8 || (p % 4 === 0 && len >= 2.8)) {
      c.strong++;
      const nx = lead[k + 1];
      if (!inChord && !(nx && n.midi - nx.midi >= 1 && n.midi - nx.midi <= 2 && chordAt(nx.t).includes(nx.midi % 12))) c.off++;
    }
  });
}

test('mood "auto" (or none) leaves every song as it was', () => {
  for (const style of ['pop', 'jazz', 'jpop+lofi'])
    for (const seed of ['a', 'b']) {
      const x = MusicComposition.compose({ seed, style }), y = MusicComposition.compose({ seed, style, mood: 'auto', contrast: false });
      assert.strictEqual(JSON.stringify(x.notes), JSON.stringify(y.notes));
      assert.strictEqual(x.mood, null);
    }
});

test('moods set the mode and the tempo: dark and tense in minor, dark slower than bright, energetic faster than calm', () => {
  const avg = (mood, style) => {
    let sum = 0;
    for (let i = 0; i < 16; i++) {
      const s = MusicComposition.compose({ seed: 'tempo' + i, style, mood, bars: 8 });
      assert.strictEqual(s.mood, mood);
      if (mood === 'dark' || mood === 'tense') assert.strictEqual(s.mode, 'minor');
      if (mood === 'bright') assert.ok(['major', 'mixolydian', 'lydian'].includes(s.mode), s.mode);
      sum += s.bpm;
    }
    return sum / 16;
  };
  for (const style of ['pop', 'jpop', 'lofi', 'jazz']) {
    assert.ok(avg('dark', style) < avg('bright', style) - 5, style + ': dark vs bright');
    assert.ok(avg('calm', style) < avg('energetic', style) - 5, style + ': calm vs energetic');
    assert.ok(avg('tense', style) > avg('sad', style) + 5, style + ': tense vs sad');
  }
  // An explicit mode wins over the mood's.
  assert.strictEqual(MusicComposition.compose({ seed: 'x', style: 'pop', mood: 'dark', mode: 'major' }).mode, 'major');
});

test('dark and tense songs keep their minor ending, and reach for the Neapolitan bII', () => {
  let neapolitan = 0;
  for (let i = 0; i < 24; i++) {
    const s = MusicComposition.compose({ seed: 'dark' + i, style: 'pop', mood: i % 2 ? 'dark' : 'tense', bars: 48 });
    const last = s.chords[s.chords.length - 1];
    assert.ok(last.tones.includes((last.tones[0] + 3) % 12), 'ends on ' + last.name);
    const tonic = last.tones[0];
    if (s.chords.some(c => c.tones[0] === (tonic + 1) % 12 && c.tones.includes((tonic + 5) % 12))) neapolitan++;
  }
  assert.ok(neapolitan >= 6, neapolitan + ' of 24 with a bII');
});

test('every mood (and a contrasting section) keeps the melody rules', () => {
  const c = { notes: 0, pairs: 0, badLeaps: 0, unresolved: 0, strong: 0, off: 0 };
  for (const extra of MOODS.map(mood => ({ mood })).concat([{ contrast: true }, { contrast: true, mood: 'dark' }, { contrast: true, mood: 'bright' }]))
    for (const style of ['pop', 'jpop', 'lofi', 'jazz', 'dance'])
      for (let i = 0; i < 4; i++) ruleCounts(MusicComposition.compose(Object.assign({ seed: 'mood' + i, style, bars: 48 }, extra)), c);
  assert.ok(c.off / c.strong < 0.01, c.off + ' strong-beat non-chord tones in ' + c.strong);
  assert.ok(c.unresolved / c.notes < 0.015, c.unresolved + ' unresolved non-chord tones in ' + c.notes);
  assert.ok(c.badLeaps / c.pairs < 0.004, c.badLeaps + ' tritone/7th leaps in ' + c.pairs);
});

test('contrast: pre-choruses (or the later verses) and bridges move to the parallel key of the other colour', () => {
  let seen = 0;
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  for (const style of ['pop', 'jpop', 'lofi', 'dance', 'jazz', 'bossa'])
    for (let i = 0; i < 6; i++) {
      const s = MusicComposition.compose({ seed: 'contrast' + i, style, contrast: true, bars: [32, 48, 64][i % 3] });
      const bright = ['major', 'mixolydian', 'lydian'].includes(s.mode);
      const pre = s.sections.some(x => x.type === 'P');
      let verses = 0;
      s.sections.forEach(x => {
        if (x.type === 'A') verses++;
        const want = x.type === 'P' || x.type === 'C' || (x.type === 'A' && !pre && verses > 1);
        assert.strictEqual(x.contrast, want, style + ' ' + i + ': ' + s.sections.map(y => y.type + (y.contrast ? '*' : '')).join(' '));
        assert.strictEqual(x.mode, want ? (bright ? 'minor' : 'major') : s.mode);
        if (!want) return;
        // Its tonic chords have the other colour's third.
        const tonicPc = (PC[x.key[0]] + (x.key[1] === '#' ? 1 : x.key[1] === 'b' ? -1 : 0) + 12) % 12;
        // (Not the last bar: its lead-in points to the next section.)
        const inside = s.chords.filter(ch => ch.time >= x.start - 0.01 && ch.time < x.start + (x.bars - 1) * s.barDuration - 0.01);
        inside.filter(ch => ch.tones[0] === tonicPc).forEach(ch => {
          assert.ok(ch.tones.includes((tonicPc + (bright ? 3 : 4)) % 12), style + ': ' + ch.name + ' in ' + x.key + ' ' + x.mode);
          seen++;
        });
      });
      assert.ok(s.sections.some(x => x.contrast), style + ' ' + i + ' has a contrasting section');
    }
  assert.ok(seen > 20, seen + ' tonic chords checked');
});

test('contrast: a longer version of the song keeps its beginning', () => {
  for (const style of ['pop', 'jpop', 'lofi'])
    for (const seed of ['p', 'q', 'r']) {
      const a = MusicComposition.compose({ seed, style, contrast: true, bars: 32 });
      const b = MusicComposition.compose({ seed, style, contrast: true, bars: 48 });
      // Up to the start of the second-to-last body section of the shorter one
      // (the one before it leads into it, and that may differ).
      const cut = a.sections.filter(x => x.type !== 'outro').slice(-2)[0].start - 0.01;
      const sig = s => JSON.stringify(s.chords.filter(c => c.time < cut).map(c => c.name));
      assert.strictEqual(sig(a), sig(b), style + ' ' + seed);
    }
});

test('invalid options throw readable errors', () => {
  assert.throws(() => MusicComposition.compose({ mood: 'grumpy' }), /unknown mood/);
  assert.throws(() => MusicComposition.compose({ parts: { drums: 'tabla' } }), /unknown drums/);
  assert.throws(() => MusicComposition.compose({ parts: { kazoo: 'loud' } }), /unknown part/);
  assert.throws(() => MusicComposition.compose({ parts: { swing: 2 } }), /swing/);
  assert.throws(() => MusicComposition.compose({ style: 'polka' }), /unknown style/);
  assert.throws(() => MusicComposition.compose({ mode: 'phrygian' }), /unknown mode/);
  assert.throws(() => MusicComposition.compose({ key: 'H' }), /unknown key/);
  assert.throws(() => MusicComposition.generate({ seed: 'x', bars: 8, sampleRate: 1000 }), /sampleRate/);
});

function asyncTest(name, fn) {
  return fn().then(() => console.log('ok   ' + name), (err) => {
    failures++;
    console.log('FAIL ' + name + '\n     ' + (err && err.message));
  });
}

asyncTest('generateAsync resolves to a WAV', async () => {
  const buf = await MusicComposition.generateAsync({ seed: 'async', bars: 8 });
  assert.strictEqual(readWav(buf).riff, 'RIFF');
}).then(() => {
  if (failures) {
    console.log('\n' + failures + ' test(s) failed');
    process.exit(1);
  }
  console.log('\nall tests passed');
});
