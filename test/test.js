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

// Strict voice-leading and harmony checks, in both meters.
for (const meter of ['4/4', '3/4']) {
  test(meter + ': strong-beat melody notes are chord tones, outer voices avoid parallel 5ths/8ves', () => {
    let strong = 0, off = 0, downbeats = 0, parallels = 0;
    for (const style of ['pop', 'jpop', 'dance', 'lofi']) {
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

test('invalid options throw readable errors', () => {
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
