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
- 成功した再ビルド後のライブリロード（SSE）
- 再ビルド失敗時の browser error overlay（`dev` + `liveReload`）
- 安全な CSS 変更時の stylesheet soft reload（`dev` + `liveReload`）
- CLI 便利機能（`build --all`、project 省略、`--host` / `--port`、`dev --open`）
- CLI binary `jskim`
- プロジェクト生成 CLI `create-jskim`
- 画面設計書（optional / prototype）: `jskim spec collect`（snapshot + CSS/アセット自動収集）→ `jskim spec build` → `jskim dev` の `/spec/` 静的提供

詳細は [docs/screen-spec/README.md](docs/screen-spec/README.md) を参照してください。companion `@ywal123456/jskim-screen-spec` は現時点で private であり、一般利用向けの公開 npm 配布前です。

Screen Spec（optional）の流れ:

```bash
jskim spec collect sample
jskim spec build sample
jskim dev sample
```

## 現在の非対応範囲

- ブラウザ選択 option / `serve --open`
- HMR / JavaScript module hot replacement
- JSON / YAML などの外部データファイル自動読み込み
- API / Mock API
- 増分ビルド
- SPA fallback / proxy
- formatter 機能

既存 HTML の自動 import / migration は JSKim core の責任範囲外です。既存 source の移行は利用者が project に合わせて行います。将来必要になった場合も、JSKim 本体ではなく独立した tool / package として検討します。

## パッケージの役割

| 名称 | 種類 | 役割 |
|------|------|------|
| `@ywal123456/jskim` | npm engine package | `jskim build` / `watch` / `serve` / `dev` / `spec collect` / `spec build` |
| `create-jskim` | npm creator package | 新しい JSKim 作業空間の生成 |
| `@ywal123456/jskim-screen-spec` | companion（開発中 / private） | 画面設計書 collect / viewer build（optional） |
| `jskim` | CLI binary | インストール後に実行するコマンド名 |

製品名は **JSKim**、CLI binary は **`jskim`**、npm engine package は **`@ywal123456/jskim`** です。package 名と binary 名を混同しないでください。

`@ywal123456/jskim` と `create-jskim` は npm registry で公開済みの MIT package です。

詳細:

- 公式ユーザーガイド: [docs/user-guide/README.md](docs/user-guide/README.md)
- 公式ユーザーガイド PDF（npm package 同梱）: `node_modules/@ywal123456/jskim/docs/JSKim_User_Guide_v0.5.2.pdf`
- PDF生成手順: [docs/user-guide-pdf-build.md](docs/user-guide-pdf-build.md)（maintainer 向け。release 用 PDF は `npm run docs:pdf:package`）
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
pnpm create jskim
yarn create jskim
```

代替:

```bash
npx create-jskim my-project
```

生成器は自動で `npm install` / `git init` を実行しません。空ではない既存ディレクトリも上書きしません。完了案内は実行した package manager に合わせた install / dev コマンドと、既定の開発 URL（`http://127.0.0.1:3000/`）を表示します。

## CLI

```bash
jskim build [<project>]
jskim build --all
jskim watch [<project>]
jskim serve [<project>] [--host <host>] [--port <port>]
jskim dev [<project>] [--host <host>] [--port <port>] [--open]
jskim spec collect [<project>]
jskim spec build [<project>]
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
- 設定内の project が 1 件だけのとき、project 名を省略できる
- `build --all` は定義順に全 project を順次 build する。1 件でも失敗すれば exit code 1
- `--host` / `--port` は serve / dev の CLI 上書き（config より優先）。`dev` の config hot reload 中も維持される
- `dev --open` は listen 成功後に browser を 1 回開く。失敗しても warning のみで dev は継続する
- option は project の前でも後ろでもよい（例: `jskim dev --port 4000 sample`）

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
src/sample/pages/index.html.njk                 → dist/sample/index.html
src/sample/pages/dashboard/index.html.njk       → dist/sample/dashboard/index.html
src/sample/pages/assets/css/common.css          → dist/sample/assets/css/common.css
src/sample/pages/dashboard/assets/css/dashboard.css → dist/sample/dashboard/assets/css/dashboard.css
src/sample/pages/assets/img/logo.svg            → dist/sample/assets/img/logo.svg
```

推奨命名:

- HTML は `index.html.njk`、`dashboard/index.html.njk` のように最終拡張子を含める
- CSS / JS を Nunjucks で処理する場合は `style.css.njk`、`main.js.njk` のように書く
- 画像や平文 CSS などテンプレート処理しないファイルは通常の拡張子のまま置く

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

`watch` / `dev` は `jskim.config.js` の変更を検知し、正常なら監視対象を更新して全体ビルドします。`dev` で effective な `outputDir` / `serve.host` / `serve.port` / `dev.liveReload` を変えた場合は process 再起動が必要です。CLI の `--host` / `--port` がある場合は、その上書き後の値で再起動要否を判定します。

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
- `watch` にも browser overlay / CSS soft reload はありません
- `dev` は `dev.liveReload: true` のときだけ browser 向け機能を有効にします
- 再ビルド失敗時は terminal 診断に加え、browser error overlay を表示します（成功するまで full reload / CSS reload は送りません）
- CSS ファイルだけが安全に変更された再ビルドでは、ページ全体ではなく stylesheet を更新します
- CSS 以外の変更や判定が不確実な場合は、従来どおりページ全体 reload します
- `dev` でも `dist` ファイルへ runtime は書き込みません
- `jskim serve|dev ... --host` / `--port` で待受を上書きできる（config より優先）
- ポート衝突時は `--port` の例と `serve.port` 変更を案内する（自動で別 port は選ばない）
- `jskim dev ... --open` で listen 成功後に browser を 1 回開く（失敗は warning、dev は継続）
- 厳格な Content Security Policy で inline script または inline style が禁止されている場合、dev の live reload・error overlay・CSS soft reload が動作しないことがあります

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
│     │  ├─ dashboard/
│     │  └─ assets/
│     ├─ layouts/
│     └─ components/
└─ dist/
   └─ sample/
```

## rootPath の使い方

各 `.njk` ファイルの最終出力位置を基準に `rootPath` が自動計算され、Nunjucks context に注入されます。

```njk
<link rel="stylesheet" href="{{ rootPath }}assets/css/common.css">
<a href="{{ rootPath }}index.html">Portal</a>
```

ページローカル asset は出力ページからの相対パスで参照します。

```njk
<link rel="stylesheet" href="assets/css/dashboard.css">
```

| 出力ファイル | rootPath |
|-----------|----------|
| `dist/sample/index.html` | `./` |
| `dist/sample/dashboard/index.html` | `../` |
| `dist/sample/guide/syntax/index.html` | `../../` |

`data.rootPath` は予約語のため使えません。

## sample

`src/sample` は公式の静的 UI sample です。Portal / Dashboard / CRUD / Wizard を含みます。API や入力保存などの application 処理は含みません。`create-jskim` が生成する project にも同じ sample が入る。

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
