// Type definitions for music-composition.js
// https://github.com/siyukatu/music-composition.js

declare namespace MusicComposition {
  type Style = 'pop' | 'jpop' | 'dance' | 'lofi' | 'chiptune' | 'ambient' | 'jazz' | 'bossa';
  type Mode = 'major' | 'minor' | 'dorian' | 'mixolydian' | 'lydian';
  /** How a song feels, on top of its style: its mode, tempo, harmony, melody, drums and space. */
  type Mood = 'bright' | 'dark' | 'sad' | 'calm' | 'energetic' | 'dreamy' | 'tense';
  /** A = verse, P = pre-chorus, B = chorus, C = bridge. */
  type SectionType = 'intro' | 'A' | 'P' | 'B' | 'C' | 'outro';
  type Instrument = 'lead' | 'bass' | 'chords' | 'guitar' | 'arp' | 'drums';
  /** 'hat' is the ride cymbal in the jazz and brush kits; 'pedal' is the hi-hat played with the foot. */
  type Drum = 'kick' | 'snare' | 'clap' | 'hat' | 'pedal' | 'open' | 'crash';

  /**
   * What plays and how. Every field is optional; the style supplies the rest.
   * Any field may also be a list (e.g. lead: ['violin', 'flute']): the song uses them all,
   * section by section (verse, chorus, bridge, pre-chorus), and the last chorus layers two.
   * 'none' in a list leaves the part out of some sections.
   */
  interface Parts {
    /** Drum kit. */
    /** 'bossa' = soft bass drum, rim click, shaker and ride. */
    drums?: 'acoustic' | 'electronic' | 'lofi' | 'chip' | 'brush' | 'perc' | 'jazz' | 'bossa' | 'none';
    /** Drum pattern family (each song generates its own pattern within it). 'bossa' plays the bossa clave over two bars. */
    groove?: 'eightbeat' | 'sixteenbeat' | 'fourfloor' | 'halftime' | 'shuffle' | 'swing' | 'breakbeat' | 'chip' | 'bossa';
    bass?: 'synth' | 'finger' | 'sine' | 'chip' | 'upright' | 'fm' | 'tuba' | 'none';
    /** How the bass plays: 'syncopated' locks to the kick drum, 'walking' in quarter notes, 'bossa' on 1, the "and" of 2, 3 and the "and" of 4. */
    bassLine?: 'root' | 'drive' | 'offbeat' | 'syncopated' | 'walking' | 'long' | 'bossa';
    /** Chord instrument. 'cutpiano' = a piano whose notes are cut short (release cut). */
    chords?: 'piano' | 'cutpiano' | 'epiano' | 'synth' | 'organ' | 'chip' | 'harp' | 'marimba' | 'vibes' | 'accordion' | 'pizzicato' | 'musicbox' | 'none';
    /** How the chords play. 'rhythm' is a generated syncopated pattern, 'stab' short offbeat chords, 'broken' broken chords (Alberti), 'jazz' swing comping figures (Charleston, pushes), 'bossa' soft offbeat chords. */
    comping?: 'block' | 'rhythm' | 'arpeggio' | 'sustain' | 'stab' | 'broken' | 'jazz' | 'bossa';
    /** Guitar (plucked string synthesis): strumming, 16th-note cutting, arpeggios, nylon-string fingerpicking, or the bossa nova batida on nylon strings. */
    guitar?: 'strum' | 'cutting' | 'arpeggio' | 'fingerpick' | 'bossa' | 'none';
    pad?: 'warm' | 'wide' | 'strings' | 'ambient' | 'choir' | 'none';
    /** Melody instrument. 'pwm', 'fm' and 'robot' (ring modulation, bit-crushed) are machine sounds. */
    lead?: 'saw' | 'pluck' | 'soft' | 'square' | 'pwm' | 'fm' | 'robot' | 'flute' | 'whistle' | 'sax' | 'brass' | 'violin' | 'voice' | 'bell' | 'piano' | 'vibes' | 'harp' | 'marimba' | 'musicbox' | 'accordion';
    arp?: 'eighths' | 'sixteenths' | 'bells' | 'harp' | 'marimba' | 'musicbox' | 'digital' | 'none';
    /** 0 (straight) – 0.5. */
    swing?: number;
  }

  /**
   * A mix of styles: 'jpop+lofi' (equal parts), 'jpop:2+lofi' (weighted; ',' also
   * separates), an array of styles, or weights by style.
   */
  type StyleMix = string | Style[] | { [S in Style]?: number };

  /** A style of your own: a base style (or mix) with its settings changed. */
  interface CustomStyle {
    /** Shown as the song's styleLabel. */
    name?: string;
    /** Default 'pop'. */
    base?: Style | StyleMix;
    /** Tempo range [min, max] (or one tempo), 40–240. */
    bpm?: number | [number, number];
    /** Modes to choose from. */
    modes?: Mode[];
    /** Instruments and playing (compose's `parts` option still overrides these). */
    parts?: PartChoices;
    /** 0–1: chromatic colour (secondary dominants, borrowed chords, appoggiaturas). */
    spice?: number;
    /** 0–1: chance of seventh chords. */
    sevenths?: number;
    /** 0–1: chance of a free walk through functional harmony instead of a stock progression. */
    functional?: number;
    /** 0–1: how much the melody likes syncopation. */
    sync?: number;
    /** 1.5–8: melody notes per bar (below 3 = slow, long notes). */
    notes?: number;
    /** 0–1: timing and velocity looseness. */
    humanize?: number;
    /** 1 or 2: bars per chord. */
    chordBars?: number;
    /** 0–1 chances: pre-chorus, bridge, quiet drop chorus, last-chorus key change. */
    form?: { pre?: number; bridge?: number; drop?: number; modulate?: number };
    /** A harmony line in the last chorus. */
    harmony?: boolean;
    /** 0–1: pitch scoops on melody notes. */
    bend?: number;
    /** 0–1 */
    reverb?: number;
    /** 0–1 */
    delay?: number;
    /** 0–1: ducking on the kick drum. */
    sidechain?: number;
    /** Tape: low-pass, hiss and crackle. */
    lofi?: boolean;
  }

  /** Parts where each field may be one value or a list used across the song. */
  type PartChoices = { [K in keyof Parts]?: Parts[K] | Array<NonNullable<Parts[K]>> } & {
    /** Parts that some songs leave out (half of them, decided by the seed). */
    sometimes?: Array<'drums' | 'bass' | 'chords' | 'guitar' | 'pad' | 'arp'>;
    /** Parts whose listed instruments all play at once, all the way through (layered), instead of taking turns by section. */
    together?: Array<'lead' | 'bass' | 'chords' | 'pad' | 'arp'>;
    /**
     * Parts whose listed instruments are layered but brought in and out as the song builds
     * (bare first verse, more in the second verse and pre-chorus, all in the choruses).
     * On the lead the extra instruments play a counter-line, a harmony a third below,
     * double the tune, or take the tune over in the bridge.
     */
    arrange?: Array<'lead' | 'bass' | 'chords' | 'pad' | 'arp'>;
  };

  interface ComposeOptions {
    /** Same seed + options => same song. Random if omitted. */
    seed?: string | number;
    /** A style, a mix of styles, or a custom style. Default 'auto' (picked from the seed). */
    style?: Style | 'auto' | StyleMix | CustomStyle;
    /** Override the style's instruments and playing. */
    parts?: PartChoices;
    /** 40–240. Chosen from the style if omitted. */
    bpm?: number;
    /** 'C' … 'B', sharps or flats ('F#', 'Bb'), or a pitch class 0–11. Picked from the seed if omitted. */
    key?: string | number;
    /** Chosen from the style if omitted (or from the mood, when there is one). */
    mode?: Mode | 'auto';
    /**
     * The song's mood: bright (major, quicker), dark (minor, slower, lower, the Neapolitan bII),
     * sad (slower, more sevenths and leaning notes), calm (slow, softer drums, fewer notes),
     * energetic (quick, busier), dreamy (lydian, add9 and maj7 chords, more reverb),
     * tense (minor, quick, driving). Default 'auto': the style as it is.
     */
    mood?: Mood | 'auto';
    /**
     * Sections in the parallel key of the other colour: in a bright song the pre-choruses
     * (or, without them, the verses after the first) and the bridge turn minor; in a dark song, major.
     */
    contrast?: boolean;
    /** Length in bars, rounded to a multiple of 4 (8–256). Default 32. A song that changes key gets one more chorus in the new key (8 bars). */
    bars?: number;
    /** Target length in seconds (including the reverb tail), used when `bars` is omitted. Rounded to whole 4-bar blocks. */
    duration?: number;
    /** true => seamless loop: no intro/outro, reverb tail folded onto the start. */
    loop?: boolean;
    /** '4/4' (default) or '3/4' (triple meter: waltz patterns, downbeat-led phrasing, and instruments that suit it). */
    meter?: '4/4' | '3/4';
    /**
     * Let the song run longer so it ends on a whole chorus rather than mid-section
     * (true: up to 30 seconds more, at least 8 bars; a number: up to that many seconds).
     * If the next whole chorus is further than that, the song ends up to 8 bars earlier instead.
     */
    extend?: boolean | number;
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
    /** Mode of this section: the song's, or the other colour's in a contrasting section. */
    mode: Mode;
    /** In the parallel key of the other colour (compose({ contrast: true })). */
    contrast: boolean;
    /** Semitones above the song's key (a final chorus may move up). */
    shift: number;
    /** A quiet chorus (chords and melody only) before the last one. */
    drop: boolean;
  }

  interface Chord {
    bar: number;
    /** Start time in seconds. */
    time: number;
    /** e.g. 'Am7', 'F', 'Bbmaj7', 'E7', 'Gsus4', 'C/E' */
    name: string;
    /** 0-based scale degree. */
    degree: number;
    /** Pitch classes of the chord (0 = C), root first. */
    tones: number[];
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
    /** A second instrument doubling this part (the last chorus, parts.together, parts.arrange). */
    layer?: boolean;
    /** A counter-line under the lead (parts.arrange). */
    counter?: boolean;
  }

  interface Song {
    version: string;
    /** Generated from the seed, e.g. 'Crystal Drift'. */
    title: string;
    seed: string;
    /** The style, a mix ('jpop+lofi'), or 'custom'. */
    style: Style | string;
    /** e.g. 'J-POP', 'J-POP × Lo-fi', or a custom style's name. */
    styleLabel: string;
    /** Weight of each style (1 for a single style). */
    mix: { [S in Style]?: number };
    /** The parts actually used (style defaults plus overrides); a list where the song changes them by section. */
    parts: { [K in keyof Parts]-?: NonNullable<Parts[K]> | Array<NonNullable<Parts[K]>> } & { together?: string[]; arrange?: string[] };
    meter: '4/4' | '3/4';
    /** 4 or 3. A bar is beatsPerBar * 4 sixteenths long. */
    beatsPerBar: number;
    bpm: number;
    key: string;
    mode: Mode;
    /** The mood asked for, or null. */
    mood: Mood | null;
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
    /** Mix settings used by render() (reverb, delay, sidechain, tape). */
    fx: { room: number; damp: number; wet: number; delay: number; sidechain: number; lofi: boolean; tail: number };
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
  /** The choices for each field of `parts`. */
  readonly parts: { [K in keyof MusicComposition.Parts]-?: string[] };
  /** Each style's default parts. */
  readonly styleParts: { [S in MusicComposition.Style]: Required<MusicComposition.Parts> };
  /** Each style's settings in the terms of a custom style; parts3 = what changes in 3/4. */
  readonly styleSettings: { [S in MusicComposition.Style]: Required<Omit<MusicComposition.CustomStyle, 'name' | 'base'>> & { parts3: MusicComposition.Parts } };
  readonly modes: MusicComposition.Mode[];
  readonly moods: MusicComposition.Mood[];
  readonly keys: string[];
}

declare const MusicComposition: MusicCompositionStatic;
export = MusicComposition;
export as namespace MusicComposition;
