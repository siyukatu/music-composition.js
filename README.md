# music-composition.js

シード値から曲を自動で作曲し、WAV ファイルとして書き出す JavaScript ライブラリです。
作曲も音声合成もすべてクライアントサイドで行うため、サーバーや外部ライブラリは必要ありません。

- 依存ライブラリなし・1ファイル
- ブラウザ / Web Worker / Node.js で動作（UMD）
- 同じシードとオプションなら、いつでも同じ曲を生成
- ゲーム用のシームレスなループ書き出しに対応
- 出力は 16-bit ステレオ PCM WAV（`ArrayBuffer`）

**デモ: [https://mcj.siyukatu.me/](https://mcj.siyukatu.me/)**（`site/` にあるサンプルページです）

## 作曲のしくみ

- **構成**: イントロ・Aメロ・プレコーラス・サビ・ブリッジ・アウトロから、長さに合わせて組み立てます。最後のサビで半音〜全音上に転調することがあります（直前に新しいキーの V7 を置きます）
- **和声**: 定番の 4 コードループか、機能和声（T→S→D）に沿った進行を選び、セカンダリードミナント、同主調からの借用和音（iv・♭VI・♭VII など）、sus4 の解決、ベースが順次進行になる転回形、セクションの変わり目の ii–V やドミナントで彩ります。マイナーキーのドミナントは導音を上げた V を使います
- **メロディ**: 4 小節の「モチーフ→応答→モチーフ（移高・反行・語尾の変化）→終止」でつくり、強拍はコードトーン、ときどき倚音で解決させます。コードごとのスケールで鳴らすので、借用和音やセカンダリードミナントの上でも音が外れません。サビは高めの音域で、フレーズの頂点にアクセントを付けます
- **表現**: 3 連符、しゃくり（ピッチベンド）、ゴーストノート、フィル・ブレイク、プレコーラスのビルドアップ、ブリッジのハーフタイム、最後のサビのハモり

## インストール

> 現在はベータ版です。API は正式版までに変わる可能性があります。

```bash
npm install music-composition.js@beta
```

ビルドせずにブラウザで使う場合は CDN から読み込めます。

```html
<script src="https://cdn.jsdelivr.net/npm/music-composition.js@beta"></script>
```

## 使い方

### ブラウザ

```html
<script src="https://cdn.jsdelivr.net/npm/music-composition.js@beta"></script>
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
| `duration` | 目安の秒数（残響を含む。`bars` 未指定時。4 小節単位に丸め） | — |
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
song.sections  // [{ type: 'intro' | 'A' | 'P' | 'B' | 'C' | 'outro', startBar, bars, start, key, shift }]
               // A = Aメロ, P = プレコーラス, B = サビ, C = ブリッジ。最後のサビで転調することがあります
song.chords    // [{ bar, time, name: 'Am7', degree }]（1 小節に 2 つのコードが入ることもあります）
song.notes     // [{ t, d, midi, vel, inst: 'lead' | 'bass' | 'chords' | 'arp' | 'drums', ... }]
```

楽譜を見てから `render(song)` で音声化できるので、ピアノロールの表示などにも使えます。

## サンプルページ

`site/index.html` がサンプルページです。ライブラリ本体はリポジトリ直下の `music-composition.js` だけで、ビルド（`npm run build` = `scripts/build.js`）で `site/` へコピーします（`site/music-composition.js` はコミットしません）。ビルドは `site/*.html` の `<script src>` に `?h=<SHA-256 の先頭 6 桁>` を付け、デプロイ後に古い JS がキャッシュから読まれないようにします。

ローカルで確認するには:

```bash
npm run dev
```

http://localhost:8765 を開きます。

### 曲の共有

曲はオプションだけで決まるので、URL がそのまま曲になります。

```
https://mcj.siyukatu.me/?seed=sakura-2026&style=lofi&bpm=80&sec=60
```

| パラメータ | 内容 |
|---|---|
| `seed` | シード（必須） |
| `style` `key` `mode` `bpm` | 省略するとシードから決まる |
| `bars` / `sec` | 長さ（小節 / 秒）。どちらもなければ 32 小節 |
| `loop=1` | ループ用 |

共有ダイアログの「ほかのアプリで共有…」（`navigator.share`）では、ブラウザで描いたカード画像（1200×630 の PNG）も一緒に渡します。

### 動画の書き出し

共有ダイアログから、曲に合わせてピアノロール・コード・ビートが動く動画（横 16:9 / 正方形 / 縦 9:16）を書き出せます（`site/video.js`）。

- WebCodecs が使えるブラウザでは、[Mediabunny](https://mediabunny.dev/)（MPL-2.0、書き出し時に jsDelivr から読み込み）で MP4（H.264 + AAC など）に実時間より速くエンコードします
- 使えないブラウザでは MediaRecorder で再生しながら録画します（曲の長さだけかかります）

> 同じ URL で同じ曲が再現できるのは、同じバージョンのライブラリで作曲した場合です。作曲アルゴリズムを変えると、既存の URL の曲も変わります。

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
