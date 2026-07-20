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
- 画面設計書（optional）: `jskim spec collect` / `jskim spec build` / **`jskim spec dev`**（収集・viewer build・同一 port の `/spec/` 自動更新）。Viewer では **Live / PC / SP / 参照** Preview を切り替えられます（Live は Shadow DOM、PC/SP は実装結果の Device Capture、参照はデザイン基準の Reference Image。PNG の追加・置き換え・削除と Device Capture 再収集は `spec dev` のみ。read-only Viewer では表示のみ）。通常の `jskim dev` は Screen Spec を自動実行しません。

詳細は [docs/screen-spec/README.md](docs/screen-spec/README.md) を参照してください。companion `@ywal123456/jskim-screen-spec` は **optional** の公開 npm package です。利用時は engine とあわせてインストールし、Chromium（Playwright）の用意が必要です。Vite HMR や screen 単位の incremental collect はありません（full-page reload / ローカル利用）。

`jskim spec dev` では、Figma の Frame を参照画像（Reference Image）として **Import / Reimport** できます（PAT + 環境変数 `JSKIM_FIGMA_TOKEN`。OAuth 未対応。`serve` / 読み取り専用 Viewer では不可）。手順・セキュリティ注意は companion の [jskim-screen-spec/README.md](jskim-screen-spec/README.md) を参照してください。

Screen Spec（optional）の開発用流れ:

```bash
jskim spec dev sample
# /       → 実装画面
# /spec/  → 画面設計書（変更監視で collect/build + reload）
```

手動の段階実行（`jskim dev` と組み合わせる場合）:

```bash
jskim spec collect sample
jskim spec build sample
jskim dev sample
```

`jskim spec dev` と `jskim dev` の違い:

| コマンド | Playwright collect | viewer 自動 build | `/spec/` 自動 reload | Viewer 編集（ローカル JSON 保存） |
|----------|--------------------|-------------------|----------------------|-----------------------------------|
| `jskim spec dev` | あり（初期 + source 変更時） | あり | あり | あり（same-origin API） |
| `jskim dev` | なし | なし | なし（静的 mount のみ） | なし |
| `jskim serve` | なし | なし | なし | なし（読み取り専用） |

`jskim spec dev` では Viewer から画面名 / 画面説明 / 項目の名称・種別・説明・備考を編集し、`spec/{project}/src/data/{screenId}.json` へローカル保存できます。書き込み API は `spec dev` 専用です。`--host 0.0.0.0` で待受けると LAN 上の他端末からも到達し得るため、信頼できるネットワークでのみ使用してください。

`jskim spec collect` は実装画面の snapshot / Preview 用データを収集します。**Description JSON（画面設計書）は自動生成しません。** Description が無い実装画面は Viewer で「実装のみ」として表示され、項目・Preview は収集結果から合成されます。画面設計書 JSON は Viewer で初めて保存したとき、または「画面を作成」「画面を複製」で作ります。

`jskim spec dev` の Viewer からは、実装より先に画面を作る「設計先行」で新しい画面設計書を作成できます（Sidebar の「＋ 画面を作成」）。作成直後の画面はまだ実装（Source JSON / snapshot）と連携していないため、Preview 領域には「No Preview」表示が出ます。実装側で `screenId` を付与して `jskim spec collect` を実行すると Preview が表示されます。この画面作成 UI は `jskim spec dev`（same-origin 編集 API）専用で、`jskim serve` / 通常の `jskim dev` の静的 mount は読み取り専用のままです。

同じ Viewer では「＋ 項目を追加」で手動項目を追加でき、項目の複製・上下ボタンでの並び替えができます。現在の実装（collected）と結びついていない手動項目は削除できます。実装画面と連携している項目は削除できませんが、「設計対象から除外」で画面設計書の通常項目から外せます（実装 element 自体は消えません。入力済みの説明は保持されます）。除外した項目は「除外した項目」から「設計対象に戻す」で復元できます。また「画面を複製」で既存の画面設計書（通常項目と並び順）を元に新しい設計のみ画面を作れます（実装画面・Preview・除外項目は複製しません。`jskim spec dev` 専用）。「画面設計を削除」で画面設計書 JSON だけを削除できます（source / Preview / snapshot は消しません。設計のみ画面は一覧から消え、連携済み画面は「実装のみ」のまま残ります。未保存の変更があるときは削除できません。`jskim spec dev` 専用）。`screenId` / `itemId` は作成後に変更できません。保存時の Description JSON は `schemaVersion: "1.2"`（`itemOrder` / `excludedItems` 付き）として書き出されます。

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
| `@ywal123456/jskim` | npm engine package | `jskim build` / `watch` / `serve` / `dev` / `spec collect` / `spec build` / `spec dev` / `spec version` |
| `create-jskim` | npm creator package | 新しい JSKim 作業空間の生成 |
| `@ywal123456/jskim-screen-spec` | optional published companion | 画面設計書 collect / viewer build（optional） |
| `jskim` | CLI binary | インストール後に実行するコマンド名 |

製品名は **JSKim**、CLI binary は **`jskim`**、npm engine package は **`@ywal123456/jskim`** です。package 名と binary 名を混同しないでください。

`@ywal123456/jskim`、`@ywal123456/jskim-screen-spec`（optional）、`create-jskim` は npm registry で公開済みの MIT package です。

詳細:

- 公式ユーザーガイド: [docs/user-guide/README.md](docs/user-guide/README.md)
- 公式ユーザーガイド PDF（npm package 同梱）: `node_modules/@ywal123456/jskim/docs/JSKim_User_Guide_v0.7.0.pdf`
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
jskim spec dev [<project>] [--host <host>] [--port <port>] [--open]
jskim spec version <subcommand>   # Screen Spec のローカル版管理（詳細: jskim spec version --help）
```

最小 workflow（版管理）:

```powershell
npx jskim spec collect sample
npx jskim spec version init sample
npx jskim spec version config sample --name "Taro Yamada" --email "taro@example.com"
npx jskim spec version add sample --all
npx jskim spec version commit sample -m "初回登録"
npx jskim spec version status sample
npx jskim spec version log sample

# 改訂履歴（Viewer・read-only。mutation は CLI）
npx jskim spec dev sample
# → 画面ヘッダの「改訂履歴」。API は spec dev のみ。static Viewer には出ない
```

- collect は自動実行しません。commit は stage 済み Screen Spec のみです
- implementation の source Git / Git tag とは別系統で、Remote はありません
- checkout は仕様 source を切り替え、実装 Nunjucks は変更しません

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
