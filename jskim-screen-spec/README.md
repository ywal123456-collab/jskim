# JSKim Screen Spec（companion package）

`@ywal123456/jskim-screen-spec` は、JSKim 本体とは独立した **画面設計書 companion package** です（現時点では `"private": true`）。

## 役割

- Source JSON / Description JSON / 手動 snapshot を読み込む
- Vue 3 SPA の画面設計書 viewer を `spec/{project}/dist` にビルドする
- 未登録の `screen-transition` 先は **build を失敗させず**、ボタンを無効化して「画面設計書未登録」と表示する

## 前提

- リポジトリルートで JSKim engine（`@ywal123456/jskim`）が利用できること
- パイロット対象: `crud-create` / `wizard-input` / `wizard-confirm` / `wizard-complete`

## 使い方

```bash
# 依存インストール（パッケージ配下）
npm --prefix jskim-screen-spec install

# 手動 snapshot 生成（preserve ビルド → outerHTML 抽出）
npm --prefix jskim-screen-spec run generate:snapshots

# sample viewer ビルド → spec/sample/dist
npm --prefix jskim-screen-spec run build:sample

# テスト
npm --prefix jskim-screen-spec test

# プレビュー（ビルド後）
npm --prefix jskim-screen-spec run preview:sample
```

## API

```ts
import { buildScreenSpecViewer } from '@ywal123456/jskim-screen-spec';

await buildScreenSpecViewer({
  rootDir: process.cwd(),
  projectName: 'sample',
  base: '/spec/',
});
```

既定の `outDir` は `spec/{projectName}/dist` です。

## snapshot

場所:

```text
spec/{project}/src/snapshots/{screenId}/{stateId}.html
```

パイロットでは preserve モードの HTML から `[data-jskim-spec-screen]` の outerHTML を抽出し、`default.html` としてコミットします（source 扱い）。

## preview CSS

`spec/{project}/src/theme/preview.css` を DomPreview の Shadow DOM に注入します。  
元 CSS の自動収集は **将来対応** です。

## 出力構成

```text
spec/sample/dist/
├─ index.html
├─ assets/
└─ data/
   ├─ manifest.json
   ├─ screens/*.json
   ├─ snapshots/**/*.html
   └─ theme/preview.css
```
