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

- **構成**: イントロ・Aメロ・プレコーラス（Bメロ）・サビ・ブリッジ・アウトロから、長さに合わせて組み立てます。最後のサビの前に静かな「落ちサビ」を入れたり、最後のサビで半音〜全音上に転調したりします（直前に新しいキーの V7 を置きます）
- **和声**: 王道進行・小室進行・カノン進行・丸サ進行・下降ベースなど、名前のある進行をスタイルとセクションの役割に合わせて選び、機能が同じコードへの置き換え（I↔vi、IV↔ii、iii→III7）で変化を付けます。プレコーラスは必ずドミナントで終わり、サビへ向かいます。セカンダリードミナント、同主調からの借用和音（iv・♭VI・♭VII など）、sus4 の解決、ベースが順次進行になる転回形、セクションの変わり目の ii–V も使います。マイナーキーのドミナントは導音を上げた V です
- **ジャズ**: ii–V–I（マイナーでは ii ø7–V7(♭9)–i）、I–vi–ii–V、iii–VI–ii–V の循環、裏コード（V7 の代わりの ♭II7）を使い、すべてのコードを 7th にして、それぞれのスケールで使える 9th・13th（ドミナントでは ♭9）を足します（11th と、ドミナント以外の ♭9 は避けます）。ピアノはルートを省いたルートレス・ボイシング（ルートはウォーキングベース）で、チャールストンなどのリズムで刻みます。ドラムはライドの「チン、チキ、チン」とハイハットのペダル（2・4 拍）。メロディは 8 分音符の格子の上でつくり、2:1 でスウィングさせます
- **メロディ**: 4 小節の「モチーフ→応答→モチーフ（移高・反行・語尾の変化）→終止」でつくり、強拍はコードトーン、ときどき倚音で解決させます。リズムは拍ごとのリズムセル（シンコペーション・タイを含む）から曲ごとに生成します。サビは直前のメロディより 3〜5 度上から入り、サビの終盤に一度だけ最高音を置きます（最後のサビはさらに高く）。コードごとのスケールで鳴らすので、借用和音やセカンダリードミナントの上でも音が外れません
- **伴奏**: ドラム・ベース・コードのパターンを、リズムの種類（8 ビート、4 つ打ち、シャッフル…）のルールに沿って曲ごとに生成します。4 小節ごとのフレーズ終わりのバリエーション、キックに合わせたベース、次のコードを先取りする「食い」も入ります
- **拍子**: 4/4 と 3/4。3/4 は強・弱・弱の拍節に合わせて、キックは 1 拍目、ワルツの伴奏はベースが 1 拍目・コードが 2・3 拍目（ブン・チャッ・チャッ）、コードの変わり目は 1 拍目（または 2+1 の 3 拍目）、メロディのフレーズは 1 拍目か 3 拍目の弱起から始まり、終止は 1 拍目に着地します
- **理論のチェック**: 強拍のメロディはコードトーン（解決する倚音を除く）、メロディとベースの連続 5 度・8 度（と跳躍で入る並達 5 度・8 度）を避けます。メロディの線も声部進行の決まりに照らします。コードにない音は次の音へ順次進行で解決し、順次進行で入ります（跳躍で入れるのは強拍の倚音だけ）。増 4 度（三全音）・7 度・オクターブを超える跳躍はしません。跳躍のあとは反対向きに戻ります。短い音は同じ音か隣の音へ進むことが多く、歌のように同じ音をくり返します。テストで両方の拍子を確認しています
- **スタイルのミックス**: `style: 'jpop+lofi'` のように複数のスタイルを混ぜられます。テンポ・和声の彩り・構成などの数値は重み付きの平均、モードと進行は重みに応じてそれぞれのスタイルから、楽器は「ドラムとリズム」「ベースと弾き方」「コード楽器と弾き方」などのまとまりごとにどれかのスタイルから選びます
- **カスタムスタイル**: 元になるスタイル（ミックスも可）のテンポの範囲・モード・楽器・和声の彩り・メロディの密度・構成・残響などを変えた、自分のスタイルを渡せます
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
| `style` | `pop` `jpop` `dance` `lofi` `chiptune` `ambient` `jazz` `auto`、ミックス（`'jpop+lofi'`）、カスタムスタイル（オブジェクト） | `auto`（シードで決定） |
| `parts` | 楽器と演奏（下の表）。指定したものだけスタイルの設定を上書き。値を配列にすると 1 曲の中で使い分ける（下を参照） | スタイルどおり |
| `key` | `C`〜`B`（`F#`, `Bb` なども可） | シードで決定 |
| `mode` | `major` `minor` `dorian` `mixolydian` `lydian` | スタイルに合わせて決定 |
| `bpm` | 40〜240 | スタイルに合わせて決定 |
| `bars` | 8〜256（4 の倍数に丸め） | `32` |
| `duration` | 目安の秒数（残響を含む。`bars` 未指定時。4 小節単位に丸め） | — |
| `meter` | `'4/4'` / `'3/4'`（三拍子） | `'4/4'` |
| `extend` | `true`（最大 30 秒）/ 秒数。サビの途中やAメロのあとでアウトロに入らないよう、区切りのいいところ（丸ごとのサビ）まで曲を延ばす。延ばしきれないときは最大 8 小節短くする | `false` |
| `loop` | `true` / `false` | `false` |
| `sampleRate` | 8000〜96000 | `44100` |

### `parts`（楽器と演奏）

| キー | 値 |
|---|---|
| `drums` | `acoustic` `electronic` `lofi` `chip` `brush`（ブラシとライド）`perc`（コンガ・リム・シェイカー・タンバリン）`jazz`（スティックとライド）`none` |
| `groove` | `eightbeat` `sixteenbeat` `fourfloor` `halftime` `shuffle` `swing`（ライドとハイハットのペダル）`breakbeat` `chip` |
| `bass` | `synth` `finger` `sine` `chip` `upright`（ウッドベース）`fm` `tuba` `none` |
| `bassLine` | `root` `drive` `offbeat` `syncopated`（キックに合わせる）`walking` `long` |
| `chords` | `piano` `cutpiano`（リリースカットピアノ）`epiano` `synth` `organ` `chip` `harp` `marimba` `vibes`（ビブラフォン）`accordion` `pizzicato` `musicbox`（オルゴール）`none` |
| `comping` | `block` `rhythm` `arpeggio` `sustain` `stab`（裏拍の短いコード）`broken`（分散和音／アルベルティ・バス）`jazz`（チャールストンなどのジャズの刻み） |
| `guitar` | `strum` `cutting` `arpeggio` `fingerpick`（ナイロン弦の指弾き）`none` |
| `pad` | `warm` `wide` `strings` `ambient` `choir` `none` |
| `lead` | `saw` `pluck` `soft` `square` `pwm` `fm` `robot`（リング変調＋ビットクラッシュ）`flute` `whistle` `sax` `brass` `violin` `voice` `bell` `piano` `vibes` `harp` `marimba` `musicbox` `accordion` |
| `arp` | `eighths` `sixteenths` `bells` `harp` `marimba` `musicbox` `digital` `none` |
| `swing` | 0〜0.5 |

3/4 では、スタイルによって三拍子に合う楽器に替わります（Lo-fi はブラシとウッドベースのジャズワルツ、J-POP はナイロンギターの指弾き、Pop はハープのアルペジオ、Ambient はオルゴール）。`parts` で指定すればそちらが優先です。

```js
MusicComposition.generate({ style: 'lofi', seed: 'rain', parts: { chords: 'piano', guitar: 'arpeggio', bassLine: 'walking' } });
// 配列: 1 曲の中で使い分ける（Aメロ・サビ・ブリッジ・Bメロの順に割り当て、最後のサビは 2 つを重ねる）
// 次のセクションへつなぐ弱起（アウフタクト）や、ベース・コードの食いは、つながる先のセクションの楽器で鳴らす
// 'none' を混ぜると、そのパートが入らないセクションができる。sometimes: 曲によっては使わないパート
MusicComposition.generate({ seed: 'rain', parts: { lead: ['flute', 'violin'], guitar: ['arpeggio', 'none'], sometimes: ['arp'] } });
// together: 挙げたパートは、配列の楽器を最初から最後まで重ねて同時に鳴らす（lead・bass・chords・pad・arp）
MusicComposition.generate({ seed: 'rain', parts: { lead: ['flute', 'violin'], chords: ['piano', 'harp'], together: ['lead', 'chords'] } });
// arrange: 重ねつつ、盛り上がりに合わせて出し入れする。1 番のAメロと落ちサビは最初の楽器だけ、
// 2 番のAメロとBメロで 1 つ加わり、サビで全部。メロディでは 2 つめ以降の楽器が
// 対旋律（コードの 3 度・7 度を順次進行でつなぐ長い音）、3 度下のハモリ、ユニゾンを受け持ち、ブリッジでは主旋律を引き継ぐ
MusicComposition.generate({ seed: 'rain', parts: { lead: ['flute', 'violin', 'harp'], chords: ['piano', 'harp'], arrange: ['lead', 'chords'] } });
MusicComposition.parts        // 選べる値の一覧
MusicComposition.styleParts   // 各スタイルの既定値
```

### スタイルのミックスとカスタムスタイル

```js
// ミックス: 'jpop+lofi'（等分）、'jpop:2+lofi'（重み付き）、['jpop', 'lofi']、{ jpop: 2, lofi: 1 }
MusicComposition.generate({ style: 'jpop+lofi', seed: 'rain' });

// カスタムスタイル: base（スタイルかミックス）の設定を変える。指定しなかった項目は base のまま
MusicComposition.generate({
  seed: 'rain',
  style: {
    name: 'Night Waltz',
    base: 'lofi+ambient',
    bpm: [84, 96],                 // テンポの範囲
    modes: ['minor', 'dorian'],
    parts: { lead: 'violin', chords: 'harp', drums: 'brush' },
    spice: 0.7,                    // 和声の彩り（セカンダリードミナント・借用和音・倚音）0〜1
    sevenths: 0.8,                 // 7th コードの割合 0〜1
    sync: 0.4,                     // メロディのシンコペーション 0〜1
    notes: 4,                      // メロディの 1 小節あたりの音数 1.5〜8
    form: { pre: 1, bridge: 0.5, drop: 0, modulate: 1 },  // Bメロ・ブリッジ・落ちサビ・転調の確率
    reverb: 0.7, delay: 0.3, sidechain: 0, lofi: true
  }
});
MusicComposition.styleSettings.lofi  // 各スタイルの設定（カスタムスタイルの出発点に）
```

ほかに `functional`（決まった進行ではなく機能和声で進む確率）、`humanize`（タイミングと強弱の揺れ）、`chordBars`（1 コードの小節数 1 / 2）、`harmony`（最後のサビのハモり）、`bend`（しゃくり）を指定できます。

パターン（ドラムの叩き方、ベースライン、コードのリズム）はどの設定でも曲ごとに自動で作られます。

`loop: true` のときはイントロとアウトロを省き、曲の末尾からはみ出したリバーブやリリースを先頭に重ねて、継ぎ目なくループする WAV を書き出します。

### `compose()` が返す楽譜

```js
const song = MusicComposition.compose({ seed: 'sakura-2026', style: 'lofi' });
song.title     // 'Crystal Drift'（シードから生成される曲名）
song.style     // 'lofi'（ミックスなら 'jpop+lofi'、カスタムスタイルなら 'custom'）
song.styleLabel // 'Lo-fi'（'J-POP × Lo-fi'、カスタムスタイルの name）
song.mix       // { lofi: 1 }（ミックスの重み）
song.key       // 'A'
song.mode      // 'dorian'
song.bpm       // 70
song.duration  // 秒数（ループ時は loopEnd と同じ）
song.parts     // 使われた楽器と演奏 { drums: 'lofi', groove: 'shuffle', ... }
song.sections  // [{ type: 'intro' | 'A' | 'P' | 'B' | 'C' | 'outro', startBar, bars, start, key, shift, drop }]
               // A = Aメロ, P = プレコーラス, B = サビ（drop: true は落ちサビ）, C = ブリッジ。最後のサビで転調することがあります
song.meter     // '4/4' | '3/4'
song.chords    // [{ bar, time, name: 'Am7', degree, tones: [9, 0, 4, 7] }]（1 小節に 2 つのコードが入ることもあります）
song.notes     // [{ t, d, midi, vel, inst: 'lead' | 'bass' | 'chords' | 'guitar' | 'arp' | 'drums', ... }]
```

楽譜を見てから `render(song)` で音声化できるので、ピアノロールの表示などにも使えます。

## サンプルページ

`site/index.html` がサンプルページです。ライブラリ本体はリポジトリ直下の `music-composition.js` だけで、ビルド（`npm run build` = `scripts/build.js`）で `site/` へコピーします（`site/music-composition.js` はコミットしません）。ビルドは `site/*.html` の `<script src>` に `?h=<SHA-256 の先頭 6 桁>` を付け、デプロイ後に古い JS がキャッシュから読まれないようにします。

Cloudflare Pages でのビルド（環境変数 `CF_PAGES=1`）では、`site/` の `.js`（ライブラリ・`video.js`・`midi.js`・`sw.js`）を [terser](https://terser.org/) で圧縮します（ライブラリは約 190 KB → 約 95 KB）。手元の `site/` は読めるまま残すため、ローカルで圧縮版を確かめるときは別のフォルダーに書き出します。

```bash
node scripts/build.js --minify --out dist
```

ローカルで確認するには:

```bash
npm run dev
```

http://localhost:8765 を開きます。

### アプリ（PWA）

公式サイトはアプリとしてインストールできます（`site/manifest.webmanifest`、アイコンは `node scripts/make-images.js icons` で作成）。

- **オフライン**: Service Worker（`site/sw.js`）は、原則としてサーバーから新しいファイルを読み込み、受け取ったものをキャッシュに置きます。ネットワークにつながらないときだけキャッシュを使うので、オフラインでもアプリが開き、作曲・再生・保存ができます（共有 URL を開いても、キャッシュのアプリで作曲します）。初回に開いたときに、ページ・スクリプト・アイコンを保存します
- **再生バー**: 画面下に常に表示。カバーアート（曲のピアノロール）、再生・一時停止、前の曲・次の曲、シークバー、この曲をくり返す、お気に入り。次の曲は、連続再生中ならその次の曲、お気に入りから再生していれば次のお気に入り、それ以外は同じ設定の新しい曲です
- **ライブラリ**: 作った曲の履歴（50 曲）とお気に入りを、このブラウザに保存します
- **ロック画面・通知**: Media Session でカバーアートと曲名を表示し、再生・一時停止・前後の曲・シークを操作できます
- **キーボード**: Space 再生 / 一時停止、← / → 5 秒戻る / 進む、N 次の曲、P 前の曲、L お気に入り、R くり返し
- インストールできるブラウザでは「アプリとしてインストール」ボタンが出ます。インストールしたアプリでは、開発者向けの説明を省いてプレーヤーだけを表示します

### スタイルと楽器の選び方

- **ミックス**: スタイル欄の「ミックス」で、スタイルごとの割合（0〜3）をスライダーで決めます
- **カスタムスタイル**: 「＋ カスタム」で、元にするスタイル（ミックスも可）・BPM の範囲・モード・和声（彩り、7th、自由な進行、コードの長さ）・メロディ（音の数、シンコペーション、しゃくり、ハモり）・構成（Bメロ、ブリッジ、落ちサビ、転調の確率）・揺らぎと音づくり（残響、ディレイ、サイドチェイン、テープ）・楽器と演奏を決めて保存します。保存先はブラウザ（localStorage）で、変えた項目だけを保存します。共有 URL に入るので、開いた人のブラウザにも追加されます。連続再生でも選べます
- **楽器と演奏**: パートごとに、使ってよい楽器・弾き方をチェックボックスで選びます。何も選ばなければスタイルどおり（点線で表示）、1 つならそれ、複数なら 1 曲の中で使い分けます（Aメロ・サビ・ブリッジ・Bメロの順に割り当て、最後のサビは 2 つを重ねます）。メロディ・ベース・コード・パッド・アルペジオは「重ねる」に切り替えると、選んだ楽器を最初から最後まで同時に鳴らします。「重ねて出し入れ」では盛り上がりに合わせて楽器が加わり、メロディでは対旋律やハモリも受け持ちます。「なし」だけならそのパートを鳴らさず、ほかと一緒に選ぶと入らないセクションができます。「曲によっては使わない」をオンにしたパートは、半分ほどの曲で抜けます
- **区切りのいいところまで延長**: 長さの下のスイッチ（連続再生にもあります）。曲がサビの途中やAメロのあとでいきなりアウトロに入らないよう、丸ごとのサビで終わるところまで延ばします（最大 30 秒）

### 曲の共有

曲はオプションだけで決まるので、URL がそのまま曲になります。

```
https://mcj.siyukatu.me/?seed=sakura-2026&style=lofi&bpm=80&sec=60
```

| パラメータ | 内容 |
|---|---|
| `seed` | シード（必須） |
| `style` `key` `mode` `bpm` | 省略するとシードから決まる。ミックスは `style=jpop,lofi`（重みは `jpop:2,lofi`） |
| `cs` | カスタムスタイル（設定を JSON にして Base64URL にしたもの） |
| `bars` / `sec` | 長さ（小節 / 秒）。どちらもなければ 32 小節 |
| `loop=1` | ループ用 |
| `ext=1` | 区切りのいいところまで延長（`extend: true`） |
| `meter=3/4` | 三拍子 |
| `parts` | 楽器と演奏。`parts=guitar:strum,lead:brass|violin,sometimes:arp|pad,together:lead`（`|` 区切りは 1 曲の中で使い分け、`together` に挙げたパートは重ねる、`arrange` は重ねて出し入れ） |

共有ダイアログの「ほかのアプリで共有…」（`navigator.share`）では、ブラウザで描いたカード画像（1200×630 の PNG）も一緒に渡します。

### 連続再生

サイドバーの「連続再生」で、スタイル（複数選択）・モード・BPM の範囲・1 曲の長さ（秒または小節）を決めると、その範囲からランダムに選んだ新しい曲を止めるまで流し続けます。再生中に次の曲を Worker で作っておくので、曲の切り替わりで待ちません。「次の曲へ」やロック画面の「次のトラック」（Media Session）で飛ばせます。

拍子（4/4・3/4）と保存したカスタムスタイルも選べます。「ときどきスタイルを混ぜる」をオンにすると、選んだスタイルから 2 つを混ぜた曲も流します（URL では `mix=1`）。「楽器と演奏」を変えていれば、その設定も使います。ルールは URL に入るので、ブックマークや共有もできます（再生はボタンを押してから始まります）。長さを小節で決めるときは `bars=16-32` です。

```
https://mcj.siyukatu.me/?radio=1&styles=lofi,ambient&modes=dorian&bpm=70-90&sec=60-120
```

### MIDI の書き出し

サンプルページの「MIDI」ボタンで、曲を Standard MIDI File（フォーマット 1、480 tick/四分音符）として保存できます（`site/midi.js`。ライブラリ本体には含みません）。

- 楽器の音色ごとに 1 トラック。General MIDI の音色番号を付け、ドラムは 10 チャンネル（ジャズ・ブラシのキットはライドとハイハットのペダル）
- テンポ・拍子（4/4・3/4）・調号・曲名、セクションのマーカー（Intro・A・Chorus…）、コード名（テキストイベントの専用トラック）
- 強弱、しゃくり（ピッチベンド。ベンド幅は ±2 半音を RPN で指定）。スウィングや揺らぎは演奏どおりのタイミングで書き出します

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
