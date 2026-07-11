# JSKim プロジェクト

このディレクトリは JSKim で静的 HTML をビルドするプロジェクトです。

## 構成

- `src/sample/` — files pipeline の標準 sample
- `src/sample/pages/` — 出力対象。`.njk` はレンダリング、画像などはコピー
- `src/sample/layouts/` / `src/sample/components/` — `extends` / `include` 用テンプレート
- `jskim.config.js` — ビルド設定（プロジェクトの基準）
- `dist/` — ビルド成果物（手編集しないでください）

`src/` を編集し、ビルドで `dist/` を生成します。

`index.html.njk`、`style.css.njk`、`main.js.njk` のように、最終的な拡張子の後ろへ `.njk` を付ける命名を推奨します。

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
