// Type definitions for music-composition.js
// https://github.com/siyukatu/music-composition.js

declare namespace MusicComposition {
  type Style = 'pop' | 'dance' | 'lofi' | 'chiptune' | 'ambient';
  type Mode = 'major' | 'minor' | 'dorian' | 'mixolydian' | 'lydian';
  /** A = verse, P = pre-chorus, B = chorus, C = bridge. */
  type SectionType = 'intro' | 'A' | 'P' | 'B' | 'C' | 'outro';
  type Instrument = 'lead' | 'bass' | 'chords' | 'arp' | 'drums';
  type Drum = 'kick' | 'snare' | 'clap' | 'hat' | 'open' | 'crash';

  interface ComposeOptions {
    /** Same seed + options => same song. Random if omitted. */
    seed?: string | number;
    /** Default 'auto' (picked from the seed). */
    style?: Style | 'auto';
    /** 40–240. Chosen from the style if omitted. */
    bpm?: number;
    /** 'C' … 'B', sharps or flats ('F#', 'Bb'), or a pitch class 0–11. Picked from the seed if omitted. */
    key?: string | number;
    /** Chosen from the style if omitted. */
    mode?: Mode | 'auto';
    /** Length in bars, rounded to a multiple of 4 (8–256). Default 32. */
    bars?: number;
    /** Target length in seconds (including the reverb tail), used when `bars` is omitted. Rounded to whole 4-bar blocks. */
    duration?: number;
    /** true => seamless loop: no intro/outro, reverb tail folded onto the start. */
    loop?: boolean;
  }

  interface RenderOptions {
    /** 8000–96000. Default 44100. */
    sampleRate?: number;
  }

  interface GenerateOptions extends ComposeOptions, RenderOptions {}

  interface Section {
    type: SectionType;
    startBar: number;
    bars: number;
    /** Start time in seconds. */
    start: number;
    /** Key of this section (after a key change, the new key). */
    key: string;
    /** Semitones above the song's key (a final chorus may move up). */
    shift: number;
  }

  interface Chord {
    bar: number;
    /** Start time in seconds. */
    time: number;
    /** e.g. 'Am7', 'F', 'Bbmaj7', 'E7', 'Gsus4', 'C/E' */
    name: string;
    /** 0-based scale degree. */
    degree: number;
  }

  interface Note {
    /** Start time in seconds. */
    t: number;
    /** Length in seconds. */
    d: number;
    midi: number;
    /** 0–1 */
    vel: number;
    inst: Instrument;
    /** Synth patch name (pitched instruments). */
    patch?: string;
    /** Drum kind (inst === 'drums'). */
    drum?: Drum;
    kit?: string;
    pan?: number;
    /** Pitch scoop: the note starts this many semitones off (negative = below) and glides in. */
    bend?: number;
    /** Length of the scoop in seconds. */
    bendTime?: number;
    /** A harmony line under the lead (final chorus). */
    harmony?: boolean;
  }

  interface Song {
    version: string;
    /** Generated from the seed, e.g. 'Crystal Drift'. */
    title: string;
    seed: string;
    style: Style;
    bpm: number;
    key: string;
    mode: Mode;
    bars: number;
    loop: boolean;
    stepDuration: number;
    barDuration: number;
    /** Length of the rendered audio in seconds (equals loopEnd when looping). */
    duration: number;
    /** End of the last bar in seconds. */
    loopEnd: number;
    sections: Section[];
    chords: Chord[];
    notes: Note[];
  }
}

interface MusicCompositionStatic {
  readonly version: string;
  /** Compose and render in one call (synchronous). Returns WAV file bytes. */
  generate(options?: MusicComposition.GenerateOptions): ArrayBuffer;
  /** Compose and render without blocking the page (Web Worker when available). */
  generateAsync(options?: MusicComposition.GenerateOptions): Promise<ArrayBuffer>;
  /** Compose a song (the score only). */
  compose(options?: MusicComposition.ComposeOptions): MusicComposition.Song;
  /** Render a composed song to a 16-bit stereo PCM WAV. */
  render(song: MusicComposition.Song, options?: MusicComposition.RenderOptions): ArrayBuffer;
  /** Render without blocking the page (Web Worker when available). */
  renderAsync(song: MusicComposition.Song, options?: MusicComposition.RenderOptions): Promise<ArrayBuffer>;
  /** Encode float channels (-1..1) as a 16-bit PCM WAV. Omit `right` for mono. */
  encodeWAV(left: Float32Array, right: Float32Array | null | undefined, sampleRate: number): ArrayBuffer;
  toBlob(wav: ArrayBuffer): Blob;
  /** Object URL for an <audio> element. Revoke it with URL.revokeObjectURL when done. */
  toURL(wav: ArrayBuffer): string;
  readonly styles: MusicComposition.Style[];
  readonly modes: MusicComposition.Mode[];
  readonly keys: string[];
}

declare const MusicComposition: MusicCompositionStatic;
export = MusicComposition;
export as namespace MusicComposition;
