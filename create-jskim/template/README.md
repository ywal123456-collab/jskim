# JSKim プロジェクト

このディレクトリは JSKim で静的 HTML をビルドするプロジェクトです。

## 構成

- `src/sample/` — 公式の静的 UI sample（Portal / Dashboard / CRUD / Wizard）
- `src/sample/pages/` — 出力対象。`.njk` はレンダリング、平文 CSS / 画像などはコピー
- `src/sample/layouts/` / `src/sample/components/` — `extends` / `include` 用テンプレート
- `jskim.config.js` — ビルド設定（プロジェクトの基準）
- `dist/` — ビルド成果物（手編集しないでください）

`src/` を編集し、ビルドで `dist/` を生成します。

HTML は `index.html.njk` のように最終拡張子の後ろへ `.njk` を付ける命名を推奨します。sample は API や入力保存などの application 処理を含みません。

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
- `data` に secret を入れると生成ファイルへ出力される可能性があります

## 画面設計書（optional）

公式 sample には `src/sample` 配下の `*.spec.json` と `spec/sample` が含まれます。
companion `@ywal123456/jskim-screen-spec` は **自動ではインストールされません**。必要なときだけ追加してください。

npm:

```bash
npm install --save-dev @ywal123456/jskim-screen-spec
npx playwright install chromium
npx jskim spec dev sample
```

pnpm:

```bash
pnpm add -D @ywal123456/jskim-screen-spec
pnpm exec playwright install chromium
pnpm exec jskim spec dev sample
```
