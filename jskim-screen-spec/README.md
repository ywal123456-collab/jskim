# JSKim Screen Spec（companion package）

`@ywal123456/jskim-screen-spec` は、JSKim 本体とは独立した **画面設計書 companion package** です（現時点では `"private": true`）。

公開 npm registry からはまだインストールできません。開発中の prototype です。

## 役割

- Source JSON / Description JSON / snapshot を読み込む
- Playwright で状態別 DOM を収集する（`collectScreenSpecProject`）
- Vue 3 SPA の画面設計書 viewer を `spec/{project}/dist` にビルドする
- 未登録の `screen-transition` 先は **build を失敗させず**、ボタンを無効化して「画面設計書未登録」と表示する

## core との境界

| package | 役割 |
|---------|------|
| `@ywal123456/jskim` | `jskim spec build` / `jskim spec collect` の委譲、`/spec/` 静的 mount、history fallback |
| `@ywal123456/jskim-screen-spec` | validation / collect / manifest / Vue・Vite viewer build |

core は companion の実装をコピーしません。companion が未インストールでも `jskim build` / `jskim dev` は動作します。

## Node runtime entry

```bash
npm --prefix jskim-screen-spec run build
```

`dist/index.js` が Node から import 可能な public API です（TypeScript source 直実行は要求しません）。

## セットアップ

```bash
npm --prefix jskim-screen-spec install
npm --prefix jskim-screen-spec run install:browsers
```

`install:browsers` は Chromium だけを明示インストールします（`postinstall` では自動ダウンロードしません）。
インストール済み package 利用者は `npx playwright install chromium` でも同じです。

## 使い方（JSKim CLI）

companion をプロジェクトへローカル追加したうえで:

```bash
jskim spec collect sample
jskim spec build sample
jskim dev sample
```

```text
/      → 実装画面（dist/sample）
/spec/ → 画面設計書 SPA（spec/sample/dist）
```

`jskim spec collect` は preserve ビルド → 一時サーバー → companion collector の順で実行します。
`jskim dev` は Screen Spec を自動 build しません。先に `jskim spec build` が必要です。

## 使い方（package-local）

```bash
npm --prefix jskim-screen-spec install
npm --prefix jskim-screen-spec run install:browsers
npm --prefix jskim-screen-spec run build
npm --prefix jskim-screen-spec run generate:snapshots
npm --prefix jskim-screen-spec run build:sample
npm --prefix jskim-screen-spec test
npm --prefix jskim-screen-spec run test:collector
npm --prefix jskim-screen-spec run preview:sample
```

- `npm test` … 既存テスト + collector の単体テスト（ブラウザ起動なし）
- `npm run test:collector` … Chromium を使う統合テストを含む

## API

### Viewer build

```ts
import { buildScreenSpecViewer } from '@ywal123456/jskim-screen-spec';

await buildScreenSpecViewer({
  rootDir: process.cwd(),
  projectName: 'sample',
  base: '/spec/',
});
```

既定の `outDir` は `spec/{projectName}/dist` です。

### Collect（Playwright）

```ts
import { collectScreenSpecProject } from '@ywal123456/jskim-screen-spec';

const result = await collectScreenSpecProject({
  rootDir: process.cwd(),
  projectName: 'sample',
  baseUrl: 'http://127.0.0.1:4173', // core が立てたローカルサーバー
  // renderedRootDir: optional（CLI 側の一時ビルド先）
});
```

戻り値:

```ts
{
  screens: number;
  states: number;
  updated: number;
  unchanged: number;
  warnings: string[];
  browserName: string;
  browserVersion: string;
}
```

## Collect 政策

- `viewer.visible` に関係なく **全 state** を収集する
- state は `viewer.order` 昇順（同値は JSON 出現順）
- **state ごとに新しい page** → `baseUrl + screen.path` → actions → capture → page close
- `baseUrl` は `http://127.0.0.1` のみ。`screen.path` は `/` 始まりで `..` 不可
- 外部ホストへのリダイレクトは拒否（`SPEC_COLLECT_EXTERNAL_REDIRECT`）
- 読み込みは `waitUntil: 'load'`（`networkidle` は使わない）
- `wait` action は最大 30000ms（超過は検証エラー）
- **コマンド単位の原子性**: 全 state をメモリに集めてから書き込む。失敗時は snapshot / description を一切書かない
- Description の orphan item / orphan snapshot は警告のみ（削除しない）
- Description が無い場合は draft（空の name/description + 見つかった item）を作成する

## Collect action

| type | 必須 |
|------|------|
| `click` | `target` |
| `check` | `target` |
| `uncheck` | `target` |
| `fill` | `target`, `value` |
| `select` | `target`, `value` |
| `wait` | `milliseconds` |

`target` は `data-jskim-spec-action` の ID です。collector 内部でのみ `[data-jskim-spec-action="…"]` に変換します。

## snapshot

場所:

```text
spec/{project}/src/snapshots/{screenId}/{stateId}.html
```

収集時は `[data-jskim-spec-screen]` の outerHTML を、input / textarea / select / checkbox / details / dialog のランタイム状態を attribute へ反映したうえで保存します（クローン上で処理し、ライブ DOM は壊しません）。

## CSS / アセット自動収集（Phase 5B）

`jskim spec collect` は各 state で stylesheet（`link` / `style`）と HTML 内リソース（`img` / `srcset` / `style` url など）を収集し、次へ書き込みます。

```text
spec/{project}/src/resources/
├─ manifest.json
├─ screens/{screenId}.json
└─ files/{contentHash12}.{ext}
```

- ローカル / 同一 origin のみ収集。外部 URL は除去して warning
- CSS の `@import` / `url()` を再帰解決し、`jskim-spec-resource://{id}` token に置換
- Shadow DOM 互換セレクタ（`postcss-selector-parser`）: `:root`/`html` → `:host`、`body` → `.preview-root`（`body.app-body` → `.preview-root.app-body`）。`:is()` / `:not()` 内も対象。クラス名・属性値・`@keyframes` 名・宣言値は変更しない
- collect 時に state ごとの `documentContext`（html/body の class と安全属性）を `resources/screens/{id}.json` へ保存し、DomPreview が wrapper / host に反映
- `spec build` で token を `{base}data/resources/files/{id}` に展開（最終 dist に token は残さない）

## preview CSS

`spec/{project}/src/theme/preview.css` は DomPreview の **viewer 上書き**（badge 視認性など）専用です。
画面本体の見た目は resources の自動収集 CSS が担当します。

## 出力構成

```text
spec/sample/dist/
├─ index.html
├─ assets/
└─ data/
   ├─ manifest.json
   ├─ screens/*.json
   ├─ snapshots/**/*.html
   ├─ resources/files/*
   └─ theme/preview.css
```

## 制限（現状）

- companion は private prototype（npm publish 前）
- Screen Spec watch / Vite middleware / HMR なし
- original application JavaScript は viewer では実行しない（collect 時の一時サーバーでは実行する）
- create-jskim 生成 project へ companion dependency は自動追加しない
