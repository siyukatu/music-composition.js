# music-composition.js

シード値から曲を自動で作曲し、WAV ファイルとして書き出す JavaScript ライブラリです。
作曲も音声合成もすべてクライアントサイドで行うため、サーバーや外部ライブラリは必要ありません。

- 依存ライブラリなし・1ファイル
- ブラウザ / Web Worker / Node.js で動作（UMD）
- 同じシードとオプションなら、いつでも同じ曲を生成
- ゲーム用のシームレスなループ書き出しに対応
- 出力は 16-bit ステレオ PCM WAV（`ArrayBuffer`）

`site/` にはこのライブラリを使ったサンプルページがあります。

## インストール

```bash
npm install music-composition.js
```

ビルドせずにブラウザで使う場合は CDN から読み込めます。

```html
<script src="https://cdn.jsdelivr.net/npm/music-composition.js@1"></script>
```

## 使い方

### ブラウザ

```html
<script src="https://cdn.jsdelivr.net/npm/music-composition.js@1"></script>
<script>
  const wav = MusicComposition.generate({ style: 'lofi', seed: 'sakura', loop: true }); // ArrayBuffer (WAV)
  const audio = new Audio(MusicComposition.toURL(wav));
  audio.loop = true;
  audio.play();
</script>
```

レンダリング中に画面を止めたくない場合は `generateAsync()` を使います。
`<script src>` で読み込んだ場合は Web Worker で処理します。バンドラー経由で読み込んだ場合など、Worker が使えない環境では自動でメインスレッドにフォールバックします（結果は同じです）。

```js
const wav = await MusicComposition.generateAsync({ style: 'chiptune', seed: 'stage-1' });
```

### Node.js / バンドラー

```js
const MusicComposition = require('music-composition.js');
// または import MusicComposition from 'music-composition.js';
const fs = require('fs');

const wav = MusicComposition.generate({ style: 'chiptune', seed: 'stage-1', loop: true });
fs.writeFileSync('stage-1.wav', Buffer.from(wav));
```

TypeScript の型定義（`music-composition.d.ts`）を同梱しています。

## API

| 関数 | 戻り値 | 説明 |
|---|---|---|
| `generate(options)` | `ArrayBuffer` | 作曲して WAV を返す（同期） |
| `generateAsync(options)` | `Promise<ArrayBuffer>` | Worker でレンダリングし、画面を止めない |
| `compose(options)` | `song` | 楽譜だけを作る（音符・コード・構成・曲名など） |
| `render(song, { sampleRate })` | `ArrayBuffer` | 楽譜を WAV に書き出す |
| `renderAsync(song, { sampleRate })` | `Promise<ArrayBuffer>` | `render` の非同期版 |
| `encodeWAV(left, right, sampleRate)` | `ArrayBuffer` | Float32Array を 16-bit WAV にエンコード |
| `toBlob(wav)` / `toURL(wav)` | `Blob` / `string` | `<audio>` やダウンロード用 |
| `styles` / `modes` / `keys` | `string[]` | 指定できる値の一覧 |
| `version` | `string` | ライブラリのバージョン |

### オプション

| オプション | 値 | 既定値 |
|---|---|---|
| `seed` | 文字列 / 数値 | ランダム |
| `style` | `pop` `dance` `lofi` `chiptune` `ambient` `auto` | `auto`（シードで決定） |
| `key` | `C`〜`B`（`F#`, `Bb` なども可） | シードで決定 |
| `mode` | `major` `minor` `dorian` `mixolydian` `lydian` | スタイルに合わせて決定 |
| `bpm` | 40〜240 | スタイルに合わせて決定 |
| `bars` | 8〜256（4 の倍数に丸め） | `32` |
| `duration` | 目安の秒数（`bars` 未指定時） | — |
| `loop` | `true` / `false` | `false` |
| `sampleRate` | 8000〜96000 | `44100` |

`loop: true` のときはイントロとアウトロを省き、曲の末尾からはみ出したリバーブやリリースを先頭に重ねて、継ぎ目なくループする WAV を書き出します。

### `compose()` が返す楽譜

```js
const song = MusicComposition.compose({ seed: 'sakura-2026', style: 'lofi' });
song.title     // 'Crystal Drift'（シードから生成される曲名）
song.style     // 'lofi'
song.key       // 'A'
song.mode      // 'dorian'
song.bpm       // 70
song.duration  // 秒数（ループ時は loopEnd と同じ）
song.sections  // [{ type: 'intro' | 'A' | 'B' | 'outro', startBar, bars, start }]
song.chords    // [{ bar, time, name: 'Am7', degree }]
song.notes     // [{ t, d, midi, vel, inst: 'lead' | 'bass' | 'chords' | 'arp' | 'drums', ... }]
```

楽譜を見てから `render(song)` で音声化できるので、ピアノロールの表示などにも使えます。

## サンプルページ

`site/index.html` がサンプルページです。ライブラリ本体はリポジトリ直下の `music-composition.js` だけで、ビルド時に `site/` へコピーします（`site/music-composition.js` はコミットしません）。

ローカルで確認するには:

```bash
npm run dev
```

http://localhost:8765 を開きます。

### Cloudflare Pages の設定

| 項目 | 値 |
|---|---|
| ビルドコマンド | `npm run build` |
| ビルド出力ディレクトリ | `site` |
| ルートディレクトリ | （空欄） |

## 開発

```bash
npm test
```

`npm publish` の前にも自動で実行されます。

## ライセンス

[MIT](LICENSE)
