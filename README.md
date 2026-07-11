# JSKim

Nunjucks を使った汎用の静的 HTML ビルド環境です。

特定のアプリ構成、業務ロジック、CSS/JS 設計、Git 運用、デプロイ基盤を強制しません。
Nunjucks ソースを設定に従って静的 HTML にレンダリングし、assets をコピーして配布可能な結果を作ります。

## 現在の対応範囲

- `jskim.config.js` による設定
- defaults とプロジェクト設定のマージ
- Nunjucks ページのレンダリング
- 静的ファイルのコピー
- outputDir の clean
- `rootPath` の自動注入
- プロジェクトごとの出力分離
- ファイル監視（`watch`）後の全体再ビルド
- ビルド結果のローカル静的サーバー（`serve`）
- 開発サーバー（`dev` = build + watch + serve）
- 成功した再ビルド後のページ全体ライブリロード（SSE）
- CLI binary `jskim`
- プロジェクト生成 CLI `create-jskim`

## 現在の非対応範囲

- ブラウザ自動起動
- HMR / CSS だけのホット更新
- HTML 移行
- JSON データの自動読み込み
- API / Mock API
- config の hot reload
- 増分ビルド
- SPA fallback / proxy

## パッケージの役割

| 名称 | 種類 | 役割 |
|------|------|------|
| `@ywal123456/jskim` | npm engine package | `jskim build` / `watch` / `serve` / `dev` |
| `create-jskim` | npm creator package | 新しい JSKim 作業空間の生成 |
| `jskim` | CLI binary | インストール後に実行するコマンド名 |

製品名は **JSKim**、CLI binary は **`jskim`**、npm engine package は **`@ywal123456/jskim`** です。package 名と binary 名を混同しないでください。

`@ywal123456/jskim` と `create-jskim` は npm registry で公開済みの MIT package です。

詳細:

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

- npm package 名は `@ywal123456/jskim`（scoped）
- インストール後の CLI binary 名は `jskim`
- コマンドは実行したディレクトリの `process.cwd()` をプロジェクトルートとして扱う
- パッケージのインストール先（`node_modules/@ywal123456/jskim`）を作業空間とはみなさない
- プロジェクトルートに `jskim.config.js` が必要

ヘルプ / バージョン:

```bash
jskim --help
jskim --version
```

## プロジェクト生成（create-jskim）

```bash
npm create jskim@latest
# または
npx create-jskim my-project
```

```bash
cd my-project
npm install
npm run dev
```

- 自動で `npm install` / `git init` は実行しません
- 空ではない既存ディレクトリは上書きしません

## このリポジトリでの開発コマンド

開発リポジトリでは従来どおり `npm run` も使えます。

## インストール（開発リポジトリ）

```bash
npm install
```

## ビルド

```bash
npm run build -- sample
# または（インストール済み binary）
jskim build sample
```

`sample` は `jskim.config.js` の `projects` に登録されたプロジェクト名です。

## ウォッチ

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

### 監視対象

マージ済みプロジェクト設定から計算します。

- `sourceDir` + `render[].from`（例: `src/sample/pages`）
- `sourceDir` + `templates[]`（例: `src/sample/layouts`, `src/sample/components`）
- `sourceDir` + `copy[].from`（例: `src/sample/assets`）

`dist/`、`node_modules/`、`outputDir` は監視しません。

### 現在の方針

- 関連する変更はすべて **全体ビルド** です（増分 render / 単一 asset copy なし）。
- `build.clean: true` のとき、再ビルドで outputDir を消して作り直すため、ソース削除も結果に反映されます。
- `jskim.config.js` を変更した場合は **watch / dev を再起動** してください（config hot reload なし）。
- 終了: `Ctrl+C`（SIGINT）または SIGTERM → `[JSKim] ウォッチを停止しました。`

debounce の既定値は `watch.debounce: 150`（ms）で、プロジェクトごとに上書きできます。詳細は [docs/configuration.md](docs/configuration.md) を参照してください。

## 静的サーバー（serve）

```bash
npm run build -- sample
npm run serve -- sample
# または
jskim build sample
jskim serve sample
```

`serve` は **すでにビルドされた** `outputDir` をローカルで確認するためのコマンドです。

- 自動で build / watch は実行しません
- サーバールートは `outputDir`（例: `dist/sample`）
- 対応 HTTP メソッドは `GET` と `HEAD` のみ
- ライブリロードはありません（HTML を変換しません）
- ローカル確認用です（本番サーバー機能ではありません）

既定の接続先:

```text
http://127.0.0.1:3000/
```

`host` / `port` は `jskim.config.js` の `serve` で変更できます。

`outputDir` が無い場合は、先に build するよう案内して終了します。

終了: `Ctrl+C` → `[JSKim] 静的サーバーを停止しました。`

## 開発サーバー（dev）

```bash
npm run dev -- sample
# または
jskim dev sample
```

`dev` は次を統合します。

1. 初回に全体ビルド
2. 実際の `outputDir`（`dist`）を静的サーバーで提供
3. ファイル監視と全体再ビルド（`watch` と同じ debounce / 直列化）
4. **成功した再ビルドのあとだけ** ブラウザを全体リロード（SSE）

ポイント:

- メモリ専用レンダリングではなく、常に実際の `dist` を提供します
- ライブリロードは HMR ではなく **ページ全体の reload** です
- `dist` ファイルへ script を書き込みません。dev の HTML レスポンスにだけ一時注入します
- ビルドエラー時も watcher / server は維持し、reload は送りません
- ブラウザ自動起動はサポートしません
- `watch.debounce` / `serve.host` / `serve.port` / `dev.liveReload` を使います

既定 URL:

```text
http://127.0.0.1:3000/
```

`dev.liveReload: false` にすると SSE endpoint と script 注入を無効化できます。

設定を変えた場合は `dev` を再起動してください。

終了: `Ctrl+C` → `[JSKim] 開発サーバーを停止しました。`

### 予約パス `/_jskim/live-reload`

`dev.liveReload: true` のとき、JSKim が内部で使う予約パスです。

- 実際の静的ファイルパスとして使わないことを推奨します
- `serve` ではこの endpoint は有効になりません
- `dev.liveReload: false` のときも有効になりません

## テスト

```bash
npm test
```

Node 標準の `node:test` / `node:assert` を使います。外部テスト framework は使いません。

- 実際の `src/sample` と `dist/sample` は変更しません
- 各テストは一時ワークスペース（`os.tmpdir`）で実行します
- build / watch / serve / dev / 言語ポリシーの回帰を検証します

## 基本ディレクトリ構成

```text
jskim/
├─ bin/
│  └─ jskim.js
├─ jskim.config.js
├─ scripts/
│  ├─ build.js
│  ├─ watch.js
│  ├─ serve.js
│  ├─ dev.js
│  └─ commands/
├─ src/
│  └─ sample/
│     ├─ pages/
│     ├─ layouts/
│     ├─ components/
│     └─ assets/
└─ dist/
   └─ sample/
```

## jskim.config.js の役割

コマンドを実行したディレクトリ（`process.cwd()`）をワークスペースルートとし、そこに置いた `jskim.config.js` がビルド動作の基準です。

- `defaults`: 全プロジェクト共通の render / templates / copy / build / watch / serve / dev
- `projects`: プロジェクトごとの `sourceDir`、`outputDir`、および任意の上書き

詳細は [docs/configuration.md](docs/configuration.md) を参照してください。

## src と dist の関係

- `sourceDir`（例: `src/sample`）に Nunjucks ソースと assets を置きます
- `outputDir`（例: `dist/sample`）にレンダリング済み HTML とコピーされた静的ファイルが生成されます
- `dist/` はビルド成果物なので手編集しないでください

## rootPath の使い方

各ページの最終出力位置を基準に `rootPath` が自動計算され、Nunjucks context に注入されます。

```njk
<link rel="stylesheet" href="{{ rootPath }}assets/css/style.css">
<a href="{{ rootPath }}index.html">Home</a>
```

| 出力ファイル | rootPath |
|-----------|----------|
| `dist/sample/index.html` | `./` |
| `dist/sample/guide/basic.html` | `../` |
| `dist/sample/guide/syntax/loop.html` | `../../` |

## sample

`src/sample` は JSKim の紹介と Nunjucks 構文例を含む技術ドキュメント型の単一ページです。

```bash
npm run build -- sample
npm run serve -- sample
# または
npm run dev -- sample
```

ビルド後、`dist/sample/index.html` または `http://127.0.0.1:3000/` で確認できます。

## リポジトリ

- Repository: https://github.com/ywal123456-collab/jskim
- Issues: https://github.com/ywal123456-collab/jskim/issues

## ライセンス

JSKim は MIT License のもとで提供されます。
自由に使用・修正・再配布・商用利用できます。著作権表示と License 文言の保持が必要であり、無保証です。
詳細は [`LICENSE`](./LICENSE) を確認してください。
