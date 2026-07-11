# JSKim

Nunjucks を使った汎用の静的 HTML ビルド環境です。

特定のアプリ構成、業務ロジック、CSS/JS 設計、Git 運用、デプロイ基盤を強制しません。`jskim.config.js` に従ってソースを処理し、配布可能な静的ファイルを `outputDir` に生成します。

## 現在の対応範囲

- `files` pipeline による Nunjucks レンダリングと静的ファイルコピー
- legacy `render` / `copy` 設定の継続サポート
- `data`、Nunjucks `filters` / `globals`
- `rootPath` の自動注入
- outputDir の clean
- ファイル監視（`watch`）後の全体再ビルド
- ビルド結果のローカル静的サーバー（`serve`）
- 開発サーバー（`dev` = build + watch + serve）
- 成功した再ビルド後のページ全体ライブリロード（SSE）
- CLI binary `jskim`
- プロジェクト生成 CLI `create-jskim`

## 現在の非対応範囲

- ブラウザ自動起動
- HMR / CSS だけのホット更新
- JSON / YAML などの外部データファイル自動読み込み
- API / Mock API
- 増分ビルド
- SPA fallback / proxy
- formatter 機能

既存 HTML の自動 import / migration は JSKim core の責任範囲外です。既存 source の移行は利用者が project に合わせて行います。将来必要になった場合も、JSKim 本体ではなく独立した tool / package として検討します。

## パッケージの役割

| 名称 | 種類 | 役割 |
|------|------|------|
| `@ywal123456/jskim` | npm engine package | `jskim build` / `watch` / `serve` / `dev` |
| `create-jskim` | npm creator package | 新しい JSKim 作業空間の生成 |
| `jskim` | CLI binary | インストール後に実行するコマンド名 |

製品名は **JSKim**、CLI binary は **`jskim`**、npm engine package は **`@ywal123456/jskim`** です。package 名と binary 名を混同しないでください。

`@ywal123456/jskim` と `create-jskim` は npm registry で公開済みの MIT package です。

詳細:

- [docs/configuration.md](docs/configuration.md)
- [docs/create-jskim.md](docs/create-jskim.md)
- [docs/publishing.md](docs/publishing.md)（maintainer 向け release 手順）

## インストール

```bash
npm install --save-dev @ywal123456/jskim
```

## 新規 project の作成

```bash
npm create jskim@latest
```

代替:

```bash
npx create-jskim my-project
```

生成器は自動で `npm install` / `git init` を実行しません。空ではない既存ディレクトリも上書きしません。

## CLI

```bash
jskim build <project>
jskim watch <project>
jskim serve <project>
jskim dev <project>
```

`package.json` の scripts 例:

```json
{
  "scripts": {
    "build": "jskim build sample",
    "watch": "jskim watch sample",
    "serve": "jskim serve sample",
    "dev": "jskim dev sample"
  }
}
```

要点:

- コマンドは実行したディレクトリの `process.cwd()` をプロジェクトルートとして扱う
- パッケージのインストール先（`node_modules/@ywal123456/jskim`）を作業空間とはみなさない
- プロジェクトルートに `jskim.config.js` が必要

ヘルプ / バージョン:

```bash
jskim --help
jskim --version
```

## files pipeline

v0.3.0 以降の推奨設定は `files` です。`files[].from` 配下を走査し、末尾が `.njk` のファイルは Nunjucks でレンダリングして末尾の `.njk` だけを外します。それ以外のファイルは byte copy します。

```js
module.exports = {
  defaults: {
    files: [{ from: 'pages', to: '' }],
    templates: ['layouts', 'components'],
  },
  projects: {
    sample: {
      sourceDir: 'src/sample',
      outputDir: 'dist/sample',
    },
  },
};
```

例:

```text
src/sample/pages/index.html.njk        → dist/sample/index.html
src/sample/pages/assets/css/style.css.njk → dist/sample/assets/css/style.css
src/sample/pages/assets/image/logo.svg → dist/sample/assets/image/logo.svg
```

推奨命名:

- HTML は `index.html.njk`、`request/index.html.njk` のように最終拡張子を含める
- CSS / JS を Nunjucks で処理する場合は `style.css.njk`、`main.js.njk` のように書く
- 画像などテンプレート処理しないファイルは通常の拡張子のまま置く

`templates` に指定した `layouts` / `components` は loader の検索パスになり、直接出力されません。

legacy の `render` / `copy` も引き続き使えます。ただし同じプロジェクトで `files` と `render` / `copy` は同時に設定できません。詳細は [docs/configuration.md](docs/configuration.md) を参照してください。

## data / filters / globals

`defaults.data` と project の `data` はテンプレート context に渡されます。Nunjucks の filter / global も `jskim.config.js` から登録できます。

```js
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
```

Nunjucks は `autoescape: true` です。JavaScript に JSON を埋め込む filter は `nunjucks.runtime.SafeString` を返してください。

```js
toJson(value) {
  const nunjucks = require('nunjucks');
  return new nunjucks.runtime.SafeString(JSON.stringify(value));
}
```

機密情報を `data` やテンプレートへ入れると、生成済み HTML / JS / CSS に含まれる可能性があります。API key、token、社内 URL などの secret は公開成果物に混入しないよう確認してください。

## このリポジトリでの開発コマンド

開発リポジトリでは従来どおり `npm run` も使えます。

```bash
npm install
npm run build -- sample
npm run dev -- sample
```

`sample` は `jskim.config.js` の `projects` に登録されたプロジェクト名です。

## watch

```bash
npm run watch -- sample
# または
jskim watch sample
```

動作:

1. 初回に全体ビルドを実行
2. プロジェクト関連パスの監視を開始
3. 変更検知後、debounce して全体ビルドを再実行
4. ビルドエラーがあってもウォッチャーは維持し、次の保存で再試行

監視対象はマージ済みプロジェクト設定から計算します。

- files mode: `sourceDir` + `files[].from`、`sourceDir` + `templates[]`
- legacy mode: `sourceDir` + `render[].from`、`sourceDir` + `templates[]`、`sourceDir` + `copy[].from`
- `dist/`、`node_modules/`、`outputDir` は監視しません

`watch` / `dev` は `jskim.config.js` の変更を検知し、正常なら監視対象を更新して全体ビルドします。`dev` で `outputDir` / `serve.host` / `serve.port` / `dev.liveReload` を変えた場合は process 再起動が必要です。

## serve / dev

`serve` は **すでにビルドされた** `outputDir` をローカルで確認するためのコマンドです。

```bash
npm run build -- sample
npm run serve -- sample
```

`dev` は build + watch + serve を統合します。

```bash
npm run dev -- sample
```

既定 URL:

```text
http://127.0.0.1:3000/
```

ポイント:

- `serve` は自動で build / watch を実行しません
- サーバールートは `outputDir`（例: `dist/sample`）
- `serve` は HTML を変換せず、ライブリロード script を注入しません
- `dev` は成功した再ビルドのあとだけ SSE でページ全体 reload を送ります
- `dev` でも `dist` ファイルへ script は書き込みません
- ブラウザ自動起動はサポートしません

`/_jskim/live-reload` は `dev.liveReload: true` のときだけ使う内部予約パスです。実際の静的ファイルパスとしては使わないことを推奨します。

## 基本ディレクトリ構成

```text
jskim/
├─ bin/
├─ jskim.config.js
├─ scripts/
├─ src/
│  └─ sample/
│     ├─ pages/
│     │  ├─ index.html.njk
│     │  ├─ assets/
│     │  └─ request/
│     ├─ layouts/
│     └─ components/
└─ dist/
   └─ sample/
```

## rootPath の使い方

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

`data.rootPath` は予約語のため使えません。

## sample

`src/sample` は files pipeline、`data`、custom filter、global、ページ別 assets を示す小さなサンプルです。

```bash
npm run build -- sample
npm run serve -- sample
# または
npm run dev -- sample
```

ビルド後、`dist/sample/index.html` または `http://127.0.0.1:3000/` で確認できます。

## テスト

```bash
npm test
```

Node 標準の `node:test` / `node:assert` を使います。外部テスト framework は使いません。

## リポジトリ

- Repository: https://github.com/ywal123456-collab/jskim
- Issues: https://github.com/ywal123456-collab/jskim/issues

## ライセンス

JSKim は MIT License のもとで提供されます。自由に使用・修正・再配布・商用利用できます。著作権表示と License 文言の保持が必要であり、無保証です。詳細は [`LICENSE`](./LICENSE) を確認してください。
