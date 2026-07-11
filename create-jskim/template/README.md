# JSKim プロジェクト

このディレクトリは JSKim で静的 HTML をビルドするプロジェクトです。

## 構成

- `src/sample/` — 標準 sample（Nunjucks ページ・layout・components・assets）
- `jskim.config.js` — ビルド設定（プロジェクトの基準）
- `dist/` — ビルド成果物（手編集しないでください）

`src/` を編集し、ビルドで `dist/` を生成します。

## セットアップ

```bash
npm install
```

## 開発サーバー

```bash
npm run dev
```

## ビルド

```bash
npm run build
```

## ウォッチ

```bash
npm run watch
```

## 静的サーバー

先にビルドしてから:

```bash
npm run serve
```

## 補足

- コマンドは実行ディレクトリ（`process.cwd()`）の `jskim.config.js` を使います
- 既定のプロジェクト名は `sample` です（`package.json` の scripts を参照）
