# JSKim 設定

`jskim.config.js` はワークスペースルート（コマンドを実行した `process.cwd()`）に置き、すべてのビルド動作の基準になります。npm パッケージとして入れた場合も、インストール先ではなく実行時のカレントディレクトリをルートとして扱います。

## 推奨設定例

```js
module.exports = {
  defaults: {
    files: [{ from: 'pages', to: '' }],
    templates: ['layouts', 'components'],
    data: {
      site: { name: 'JSKim Sample', language: 'ja' },
    },
    nunjucks: {
      filters: {
        formatPrice(value) {
          return `${Number(value).toLocaleString('ja-JP')}円`;
        },
      },
      globals: {
        currentYear() {
          return new Date().getFullYear();
        },
      },
    },
    build: { clean: true },
    watch: { debounce: 150 },
    serve: { host: '127.0.0.1', port: 3000 },
    dev: { liveReload: true },
  },
  projects: {
    sample: {
      sourceDir: 'src/sample',
      outputDir: 'dist/sample',
    },
  },
};
```

## defaults / projects

`defaults` はすべてのプロジェクトに共通で適用される既定値です。`projects` はプロジェクト名から設定オブジェクトへのマップです。

```bash
npm run build -- sample
npm run watch -- sample
npm run serve -- sample
npm run dev -- sample
```

上記の `sample` が `projects.sample` を指します。

必須:

- `sourceDir`
- `outputDir`

任意:

- `files`, `render`, `templates`, `copy`, `data`, `nunjucks`, `build`, `watch`, `serve`, `dev`

## mode selection

JSKim には 2 つの build mode があります。

| mode | 条件 | 用途 |
|------|------|------|
| files mode | `files` が空でない配列 | v0.3.0 以降の推奨。Nunjucks と静的ファイルを同じルールで扱う |
| legacy mode | `files` 未設定、かつ `render` が空でない配列 | 既存の `render` / `copy` 設定を継続する |

同じプロジェクトで `files` と `render` / `copy` は同時に設定できません。files mode を使う場合は `render` / `copy` を空にしてください。legacy mode を使う場合は `files` を設定しないでください。

## sourceDir / outputDir

`sourceDir` はプロジェクトのソースルートです。`outputDir` はビルド結果のルートです。どちらも **ワークスペースルート** 基準の相対パス（または絶対パス）です。

```js
projects: {
  sample: {
    sourceDir: 'src/sample',
    outputDir: 'dist/sample',
  },
},
```

`serve` は `outputDir` を静的サーバーのルートとして公開します。

## files

files mode の処理ルール配列です。

| フィールド | 基準 | 必須 | 説明 |
|------|------|------|------|
| `from` | sourceDir | 必須 | 探索開始ディレクトリ |
| `to` | outputDir | 任意 | 出力基準ディレクトリ。未指定または `''` は出力ルート |
| `include` | from 基準 | 任意 | glob パターン配列。既定は `['**/*']` |
| `exclude` | from 基準 | 任意 | 除外 glob パターン配列。既定は `[]` |

処理:

- 末尾が `.njk` のファイルは Nunjucks でレンダリングし、末尾の `.njk` だけを外して出力する
- それ以外のファイルは byte copy する
- 出力先が同じになるファイルが複数ある場合はエラーにする
- `templates[]` 配下のファイルは直接出力しない

例:

```text
src/sample/pages/index.html.njk             → dist/sample/index.html
src/sample/pages/assets/css/style.css.njk   → dist/sample/assets/css/style.css
src/sample/pages/assets/image/logo.svg      → dist/sample/assets/image/logo.svg
```

推奨命名:

- HTML: `index.html.njk`
- CSS: `style.css.njk`
- JS: `main.js.njk`
- Nunjucks 処理しない画像など: `logo.svg`

## templates

Nunjucks loader の追加検索パスです。**sourceDir** 基準です。

```js
templates: ['layouts', 'components'],
```

`sourceDir` 自体も常に loader root に含まれるため、次が動作します。

```njk
{% extends "layouts/base.njk" %}
{% include "components/header.njk" %}
```

files mode では、`templates` に指定された既存ディレクトリ配下のファイルは直接出力から除外されます。layout / component を `files[].from` の範囲内に置いた場合でも、`templates` として指定しておけば出力対象になりません。

## data

`data` はすべての Nunjucks レンダリング context に渡される plain object です。

```js
data: {
  site: {
    name: 'JSKim Sample',
    language: 'ja',
    themeColor: '#222222',
  },
  samplePrice: 12000,
},
```

テンプレートでは通常の変数として参照できます。

```njk
<html lang="{{ site.language }}">
{{ samplePrice }}
```

`rootPath` は JSKim が注入する予約キーです。`data.rootPath` は使えません。

機密情報を `data` に入れると、生成済み HTML / JS / CSS に出力される可能性があります。API key、token、社内 URL などの secret は入れないでください。

## nunjucks.filters / nunjucks.globals

Nunjucks のカスタム filter / global を `jskim.config.js` から登録できます。

```js
nunjucks: {
  filters: {
    formatPrice(value) {
      return `${Number(value).toLocaleString('ja-JP')}円`;
    },
    toJson(value) {
      const nunjucks = require('nunjucks');
      return new nunjucks.runtime.SafeString(JSON.stringify(value));
    },
  },
  globals: {
    currentYear() {
      return new Date().getFullYear();
    },
  },
},
```

filter は function である必要があります。global は function 以外の値も登録できます。非同期 filter / global は現在サポートしていません。

Nunjucks は `autoescape: true` です。JavaScript テンプレートへ JSON を埋め込む場合は、HTML escape されないよう `SafeString` を返す filter を使ってください。

```njk
const site = {{ site | toJson }};
```

## legacy render / copy

既存プロジェクト向けに `render` / `copy` は継続サポートします。

```js
defaults: {
  render: [
    {
      from: 'pages',
      to: '',
      include: ['**/*.njk'],
      extension: '.html',
    },
  ],
  templates: ['layouts', 'components'],
  copy: [
    {
      from: 'assets',
      to: 'assets',
    },
  ],
},
```

### render

Nunjucks ファイルを HTML などへレンダリングするルール配列です。

| フィールド | 基準 | 説明 |
|------|------|------|
| `from` | sourceDir | 探索開始ディレクトリ |
| `to` | outputDir | 出力基準ディレクトリ（`''` = 出力ルート） |
| `include` | from 基準 | glob パターン配列 |
| `extension` | — | 出力拡張子（例: `.html`） |

legacy render では `pages/index.njk` を `index.html` のように出力する構成が一般的です。

### copy

静的ファイルを変換せずにコピーするルール配列です。

| フィールド | 基準 | 説明 |
|------|------|------|
| `from` | sourceDir | コピー元 |
| `to` | outputDir | コピー先 |

`from` が無い場合は警告のみ出してビルドを続行します。

## collision

files mode では出力パスの衝突を検出します。たとえば同じ `files` 範囲に `about.html` と `about.html.njk` がある場合、どちらも `about.html` に出力されるためエラーになります。Windows では大文字小文字の違いだけの衝突も同じ出力として扱います。

## rootPath

各 `.njk` ファイルの最終出力位置を基準に `rootPath` が自動計算され、Nunjucks context に注入されます。

```njk
<link rel="stylesheet" href="{{ rootPath }}assets/css/style.css">
<a href="{{ rootPath }}index.html">Home</a>
```

| 出力ファイル | rootPath |
|-----------|----------|
| `dist/sample/index.html` | `./` |
| `dist/sample/request/index.html` | `../` |
| `dist/sample/guide/syntax/index.html` | `../../` |

## build.clean

`true` のとき、ビルド前に `outputDir` だけを整理します。

次のパスは削除せず、該当すればエラーで終了します。

- ファイルシステムルート
- ワークスペースルート
- sourceDir 自体
- sourceDir の上位パス
- 空のパス

## watch.debounce

ファイル変更後、全体再ビルドを開始するまでの待ち時間（ms）です。

| 項目 | 内容 |
|------|------|
| 型 | `number`（有限の非負数） |
| 既定値 | `150` |
| マージ | `watch` オブジェクトの 1 段階マージ |

不正な値（負数、数値でない、`NaN` / `Infinity`）は設定エラーで終了します。

## serve.host / serve.port

ローカル静的サーバーのバインドホストとポートです。

| 設定 | 型 | 既定値 |
|------|------|------|
| `serve.host` | 空でない `string` | `'127.0.0.1'` |
| `serve.port` | `1` 以上 `65535` 以下の整数 | `3000` |

`serve` は自動ビルドしません。`outputDir` が無い場合は先に `jskim build <name>` を実行してください。

CLI の `--host` / `--port` は config より優先されます。`dev` では config hot reload 後も CLI override を再適用します。

## build --all

`jskim build --all` は `Object.keys(config.projects)` の定義順に全 project を順次 build します。

- config は 1 回だけ load する
- project ごとの resolve / build 失敗があっても、可能な限り次の project を続ける
- 1 件でも失敗すれば最終 exit code は 1
- 同一または入れ子の `outputDir` は、どの build も始める前にエラーで中断する
- `jskim build all` は名前が `all` の project 1 件を build する（`--all` とは別）

## project 名の省略

設定内の project がちょうど 1 件のとき、`build` / `watch` / `serve` / `dev` で project 名を省略できます。0 件または 2 件以上では明示指定が必要です（`build --all` を除く）。

## dev.liveReload

開発サーバー（`npm run dev`）のライブリロード有効/無効です。

| 項目 | 内容 |
|------|------|
| 型 | `boolean` |
| 既定値 | `true` |
| マージ | `dev` オブジェクトの 1 段階マージ |

`true` のとき:

- `GET /_jskim/live-reload` で SSE を提供
- HTML レスポンスにだけ client script を一時注入（`dist` には書き込まない）
- 成功した再ビルドのあとだけ browser 更新を送信（通常はページ全体 reload）
- 再ビルド失敗時は browser error overlay を表示（成功するまで reload / CSS 更新は送らない）
- CSS ファイルだけが安全に変更された場合は、ページ全体ではなく stylesheet を更新

`false` のとき:

- SSE endpoint は提供しない（404）
- HTML への script 注入なし
- error overlay / CSS soft reload も無効
- build + watch + serve 自体は動作

`/_jskim/live-reload` は内部予約パスです。プロジェクトの静的ファイルとしては使わないことを推奨します。

厳格な Content Security Policy で inline script または inline style が禁止されている場合、dev の live reload・error overlay・CSS soft reload が動作しないことがあります。`watch` と `serve` にはこれらの browser 機能はありません。

## config hot reload

`watch` と `dev` はワークスペースルートの `jskim.config.js` を監視します。

| コマンド | 動作 |
|----------|------|
| `build` | 実行時に config を 1 回読み込む。監視しない |
| `serve` | 実行時に config を 1 回読み込む。監視しない。変更後は process 再起動が必要 |
| `watch` | config 変更を hot apply。`outputDir` 変更も可。以前の outputDir は自動削除しない |
| `dev` | build / watch 関連設定を hot apply。一部 runtime 設定は再起動が必要 |

`dev` では次の **effective** 値が変わった candidate config は適用しません。

- `outputDir`
- `serve.host`
- `serve.port`
- `dev.liveReload`

CLI の `--host` / `--port` がある場合は、上書き適用後の値で比較します。そのため CLI で port を固定しているあいだに config の `serve.port` だけが変わっても、effective が同じなら再起動警告は出ません。

理由: server bind と serve root を安全に切り替えるには process 再起動が必要で、部分適用すると build output と serve root がずれるためです。

## パス基準のまとめ

| 設定 | 基準 |
|------|------|
| `sourceDir`, `outputDir` | ワークスペースルート（`jskim.config.js` の場所） |
| `files[].from`, `render[].from`, `templates[]`, `copy[].from` | `sourceDir` |
| `files[].to`, `render[].to`, `copy[].to` | `outputDir` |
| `files[].include`, `files[].exclude`, `render[].include` | 各 `from` |

Windows / POSIX とも `node:path` で解釈します。HTML 内パス（`rootPath` など）は `/` を使います。

## マージ規則

- **通常値**: プロジェクト設定があれば優先、なければ defaults
- **オブジェクト**（`build`, `watch`, `serve`, `dev`, `data`, `nunjucks`）: 1 段階マージ
- **`nunjucks.filters` / `nunjucks.globals`**: それぞれ 1 段階マージ
- **配列**（`files`, `render`, `templates`, `copy`）: プロジェクトに同じ配列があれば defaults 配列を丸ごと置き換え。項目単位の自動マージなし

元の `defaults` とプロジェクト設定オブジェクトは変更しません。

## 外部パス

`sourceDir` / `outputDir` にワークスペース外のパスを使うことは禁止しません。フレームワークは Git 構成やフォルダ配置を強制しません。ただし clean の安全装置は常に適用されます。
