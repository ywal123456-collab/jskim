# JSKim 設定

`jskim.config.js` はワークスペースルート（コマンドを実行した `process.cwd()`）に置き、すべてのビルド動作の基準になります。npm パッケージとして入れた場合も、インストール先ではなく実行時のカレントディレクトリをルートとして扱います。

## 全体例

```js
module.exports = {
  defaults: {
    render: [
      {
        from: 'pages',
        to: '',
        include: ['**/*.njk'],
        extension: '.html',
      },
    ],

    templates: [
      'layouts',
      'components',
    ],

    copy: [
      {
        from: 'assets',
        to: 'assets',
      },
    ],

    build: {
      clean: true,
    },

    watch: {
      debounce: 150,
    },

    serve: {
      host: '127.0.0.1',
      port: 3000,
    },

    dev: {
      liveReload: true,
    },
  },

  projects: {
    sample: {
      sourceDir: 'src/sample',
      outputDir: 'dist/sample',
    },
  },
};
```

## defaults

すべてのプロジェクトに共通で適用される既定値です。

プロジェクトに同じキーがあれば、プロジェクト側が優先されます。

## projects

プロジェクト名 → 設定オブジェクトのマップです。

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

- `render`, `templates`, `copy`, `build`, `watch`, `serve`, `dev` — defaults の上書き

## sourceDir

プロジェクトのソースルートです。**ワークスペースルート**基準の相対パス（または絶対パス）です。

例: `src/sample`

## outputDir

ビルド結果のルートです。**ワークスペースルート**基準です。

例: `dist/sample`

`serve` はこのディレクトリを静的サーバーのルートとして公開します。

## render

Nunjucks ファイルを HTML にレンダリングするルール配列です。

| フィールド | 基準 | 説明 |
|------|------|------|
| `from` | sourceDir | 探索開始ディレクトリ |
| `to` | outputDir | 出力基準ディレクトリ（`''` = 出力ルート） |
| `include` | from 基準 | glob パターン配列 |
| `extension` | — | 出力拡張子（例: `.html`） |

例:

```text
src/sample/pages/index.njk        → dist/sample/index.html
src/sample/pages/guide/basic.njk  → dist/sample/guide/basic.html
```

`layouts` と `components` は render 対象ではなく、直接出力されません。

## templates

Nunjucks loader の追加検索パスです。**sourceDir** 基準です。

`sourceDir` 自体も常に loader root に含まれるため、次が動作します。

```njk
{% extends "layouts/base.njk" %}
{% include "components/header.njk" %}
```

## copy

静的ファイルを変換せずにコピーするルール配列です。

| フィールド | 基準 | 説明 |
|------|------|------|
| `from` | sourceDir | コピー元 |
| `to` | outputDir | コピー先 |

`from` が無い場合は警告のみ出してビルドを続行します。

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
| マージ | `build` と同様にオブジェクト 1 段階マージ — プロジェクトで `watch.debounce` だけ上書き可能 |

プロジェクト別の上書き例:

```js
projects: {
  sample: {
    sourceDir: 'src/sample',
    outputDir: 'dist/sample',
    watch: {
      debounce: 300,
    },
  },
},
```

不正な値:

- 負数
- 数値でない
- `NaN` / `Infinity`

この場合は設定エラーで終了します。

注意:

- この段階では `jskim.config.js` 自体は watch しません
- 設定を変えた場合は watch コマンドを再起動してください

## serve.host

ローカル静的サーバーのバインドホストです。

| 項目 | 内容 |
|------|------|
| 型 | 空でない `string` |
| 既定値 | `'127.0.0.1'` |
| マージ | `serve` オブジェクトの 1 段階マージ |

不正な値（空文字・非文字列）は設定エラーで終了します。

## serve.port

ローカル静的サーバーのポートです。

| 項目 | 内容 |
|------|------|
| 型 | 整数 |
| 範囲 | `1` 以上 `65535` 以下 |
| 既定値 | `3000` |
| マージ | `serve` オブジェクトの 1 段階マージ — `serve.port` だけ上書き可能 |

プロジェクト別の上書き例:

```js
projects: {
  sample: {
    sourceDir: 'src/sample',
    outputDir: 'dist/sample',
    serve: {
      port: 4000,
    },
  },
},
```

不正な値の例: 文字列、小数、`NaN`、負数、`0`、`65536` 以上。

エラー例:

```text
[JSKim] 設定値が不正です: serve.port
1から65535までの整数を指定してください。
受け取った値: -1
```

`serve` は自動ビルドしません。`outputDir` が無い場合は先に `npm run build -- <name>` を実行してください。

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
- **成功した再ビルドのあとだけ** `reload` event を送信

`false` のとき:

- SSE endpoint は提供しない（404）
- HTML への script 注入なし
- build + watch + serve 自体は動作

### 予約パス `/_jskim/live-reload`

`dev.liveReload: true` のときだけ有効になる内部 SSE endpoint です。

- JSKim が予約するパスであり、プロジェクトの静的ファイルとしては使わないことを推奨します
- `serve` コマンドでは有効になりません
- `dev.liveReload: false` では有効になりません
- パス自体を設定で変更するオプションはありません

プロジェクト別の上書き例:

```js
projects: {
  sample: {
    sourceDir: 'src/sample',
    outputDir: 'dist/sample',
    dev: {
      liveReload: false,
    },
  },
},
```

不正な値（boolean 以外）は設定エラーで終了します。

### dev が再利用する設定

| 設定 | 用途 |
|------|------|
| `watch.debounce` | 変更後の再ビルド待ち時間 |
| `serve.host` | 開発サーバーのホスト |
| `serve.port` | 開発サーバーのポート |
| `dev.liveReload` | ライブリロード on/off |

`dev.host` / `dev.port` / `dev.debounce` は用意しません。

設定変更後は実行中の watcher/server は自動再構成されないため、`dev` / `watch` / `serve` を再起動してください。

## パス基準のまとめ

| 設定 | 基準 |
|------|------|
| `sourceDir`, `outputDir` | ワークスペースルート（`jskim.config.js` の場所） |
| `render[].from`, `templates[]`, `copy[].from` | `sourceDir` |
| `render[].to`, `copy[].to` | `outputDir` |

Windows / POSIX とも `node:path` で解釈します。HTML 内パス（`rootPath` など）は `/` を使います。

## 配列マージ規則

- **通常値**: プロジェクト設定があれば優先、なければ defaults
- **オブジェクト**（`build`, `watch`, `serve`, `dev` など）: 1 段階マージ — 例: `build.clean`、`watch.debounce`、`serve.port`、`dev.liveReload` だけ上書き可能
- **配列**（`render`, `templates`, `copy`）: プロジェクトに同じ配列があれば **defaults 配列を丸ごと置き換え**。項目単位の自動マージなし

元の `defaults` とプロジェクト設定オブジェクトは変更しません。

## 外部パス

`sourceDir` / `outputDir` にワークスペース外のパスを使うことは禁止しません。
フレームワークは Git 構成やフォルダ配置を強制しません。
ただし clean の安全装置（上記）は常に適用されます。
