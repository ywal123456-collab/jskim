# JSKim Screen Spec（companion package）

`@ywal123456/jskim-screen-spec` は、JSKim 本体とは独立した **画面設計書 companion package** です（現時点では `"private": true`）。

公開 npm registry からはまだインストールできません。開発中の prototype です。

## 役割

- Source JSON / Description JSON / 手動 snapshot を読み込む
- Vue 3 SPA の画面設計書 viewer を `spec/{project}/dist` にビルドする
- 未登録の `screen-transition` 先は **build を失敗させず**、ボタンを無効化して「画面設計書未登録」と表示する

## core との境界

| package | 役割 |
|---------|------|
| `@ywal123456/jskim` | `jskim spec build` の委譲、`/spec/` 静的 mount、history fallback |
| `@ywal123456/jskim-screen-spec` | validation / manifest / Vue・Vite viewer build |

core は companion の実装をコピーしません。companion が未インストールでも `jskim build` / `jskim dev` は動作します。

## Node runtime entry

```bash
npm --prefix jskim-screen-spec run build
```

`dist/index.js` が Node から import 可能な public API です（TypeScript source 直実行は要求しません）。

## 使い方（JSKim CLI）

companion をプロジェクトへローカル追加したうえで:

```bash
jskim spec build sample
jskim dev sample
```

```text
/      → 実装画面（dist/sample）
/spec/ → 画面設計書 SPA（spec/sample/dist）
```

`jskim dev` は Screen Spec を自動 build しません。先に `jskim spec build` が必要です。

## 使い方（package-local）

```bash
npm --prefix jskim-screen-spec install
npm --prefix jskim-screen-spec run build
npm --prefix jskim-screen-spec run generate:snapshots
npm --prefix jskim-screen-spec run build:sample
npm --prefix jskim-screen-spec test
npm --prefix jskim-screen-spec run preview:sample
```

`preview:sample` は package-local 確認手段です。最終目標は JSkim server の `/spec/` です。

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

パイロットでは preserve モードの HTML から `[data-jskim-spec-screen]` の outerHTML を抽出します（手動。自動 collector は未実装）。

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

## 制限（現状）

- companion は private prototype（npm publish 前）
- automatic collector / snapshot 自動更新なし
- Screen Spec watch / Vite middleware / HMR なし
- original application JavaScript は実行しない
- create-jskim 生成 project へ companion dependency は自動追加しない
