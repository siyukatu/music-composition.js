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

test('invalid options throw readable errors', () => {
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
