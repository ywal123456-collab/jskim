# JSKim Screen Spec（companion package）

`@ywal123456/jskim-screen-spec` は、JSKim 本体とは独立した **画面設計書 companion package** です（optional / 公開 npm package）。

## インストール

```bash
npm install --save-dev @ywal123456/jskim @ywal123456/jskim-screen-spec
npx playwright install chromium
npx jskim spec dev sample
```

peer dependency: `@ywal123456/jskim` **^0.6.0** が必要です。
`npm pack` / `npm publish` 時は `prepack` が `dist` をビルドします。

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

## セットアップ（リポジトリ内開発）

```bash
npm --prefix jskim-screen-spec install
npm --prefix jskim-screen-spec run install:browsers
```

`install:browsers` は Chromium だけを明示インストールします（`postinstall` では自動ダウンロードしません）。
インストール済み package 利用者は `npx playwright install chromium` でも同じです。

## 使い方（JSKim CLI）

companion をプロジェクトへローカル追加したうえで:

```bash
# 開発用（推奨）: 初期 collect/build + 同一 port + 自動更新
jskim spec dev sample

# 手動手順
jskim spec collect sample
jskim spec build sample
jskim dev sample
```

```text
/      → 実装画面（dist/sample）
/spec/ → 画面設計書 SPA（spec/sample/dist）
```

`jskim spec collect` は preserve ビルド → 一時サーバー → companion collector の順で実行します。
`jskim spec dev` は初期 collect / atomic viewer build のあと、既存の開発 server で `/` と `/spec/` を提供し、変更に応じて collect/build と full-page reload を行います。
`jskim dev` は Screen Spec を自動 collect / build しません。

### Viewer Description 編集（phase 7A-1）

`jskim spec dev` 実行中のみ、Viewer から Description JSON を編集してローカル保存できます。

```text
Vue Viewer
  → same-origin GET/PUT /_jskim/spec/descriptions/:screenId
  → FileDescriptionStore（companion）
  → spec/{project}/src/data/{screenId}.json（安全なファイル置換）
  → 既存 Description build-only watcher
  → viewer build + reload(target=spec)
```

編集可能フィールド:

- 画面: `name` / `description`
- 項目: `name` / `type` / `description` / `note`

読み取り専用: `screenId` / `itemId`

境界:

- 書き込み API は `jskim spec dev` 専用（`jskim serve` / 通常の `jskim dev` では無効）
- same-origin・Content-Type・body サイズ・path traversal を検証
- revision（SHA-256）不一致は `409`（強制上書きなし）
- ファイル書き込みは TEMP + rename（Windows 等では backup swap）。partial JSON を残さない
- Collector も同じ revision 契約で再試行し、手動 field を保全する
- `--host 0.0.0.0` は LAN に露出するため注意
- Viewer はファイルパスを組み立てず、API のみを使う
- collected / documented 分離や Remote Store は将来拡張枠（今回は FileDescriptionStore のみ）

### 画面の新規作成（design-first / phase 7B-1）

`loadScreenSpecProject` は Source JSON（実装側）と Description JSON（設計側）の **和集合（union）** で画面一覧を組み立てます。どちらか一方しか無い画面も `design-only` / `implementation-only` として読み込まれ、両方揃った画面だけが `linked` になります。

```text
status = 'linked'               … Description あり + Source(+snapshot) あり
status = 'design-only'          … Description のみ
status = 'implementation-only'  … Source(+snapshot) のみ
```

`jskim spec dev` 実行中は、実装が無い画面でも Viewer から先に画面設計書だけを作成できます（設計先行）。

```text
Vue Viewer（「＋ 画面を作成」）
  → same-origin POST /_jskim/spec/descriptions（screenId 無し）
  → FileDescriptionStore.create()
  → createFileAtomic（同一 dir の TEMP に全文を書いてから hard link で no-replace 公開。同時作成は 1 件だけ成功し、既存は上書きしない）
  → spec/{project}/src/data/{screenId}.json（新規）
  → 既存 Description build-only watcher → viewer build + reload(target=spec)
```

- `createFileAtomic` は `COPYFILE_EXCL` による非原子的コピーを使わない。hard link 非対応のファイルシステムでは copy fallback せずエラーにする
- 新規作成は `POST`（`GET/PUT` は既存 `screenId` に対する読み書き専用のまま）
- 同じ `screenId` で 2 回目の `POST` は `409 SPEC_DESCRIPTION_ALREADY_EXISTS`
- 作成直後の画面は `design-only` かつ `hasPreview: false`。Viewer は Preview 領域に No Preview を表示し、`states` が無いため State selector も表示しない
- 実装と連携して `jskim spec collect` を実行すると snapshot が追加され、`status` は `linked` に変わる
- item（項目）の新規作成、画面の rename / archive は本 phase の対象外（未実装）

### `jskim spec dev` の監視

| 対象 | 動作 |
|------|------|
| `src/{project}/pages` / `layouts` / `components` / assets / `*.spec.json` | project rebuild 後に **collect + build** |
| `spec/{project}/src/data`（Description） | **build only**（Playwright なし） |
| `spec/{project}/src/theme` | **build only** |
| `spec/{project}/src/snapshots` / `resources` / `dist` | **監視しない**（生成物の feedback loop 防止） |

失敗時:

- 直前の正常な `spec/{project}/dist` を維持
- browser reload しない
- watcher / server は継続し、次の変更で再試行

終了（Ctrl+C）時は server・watcher・debounce timer・実行中 collect を整理します。
現状の reload は **full-page reload** です（Vite HMR ではありません）。

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
開発中の差し替えには `buildScreenSpecViewerAtomic`（TEMP build → 原子的 rename）を使います。

### Watch helpers

```ts
import {
  classifyScreenSpecWatchPath,
  mergeScreenSpecWatchKinds,
  buildScreenSpecViewerAtomic,
} from '@ywal123456/jskim-screen-spec';
```

### FileDescriptionStore（ローカル編集）

```ts
import { createFileDescriptionStore } from '@ywal123456/jskim-screen-spec';

const store = createFileDescriptionStore({
  rootDir: process.cwd(),
  projectName: 'sample',
  listScreenIds: () => ['crud-create'],
});

const current = store.read('crud-create');
store.write('crud-create', current.document, current.revision);
```

JSKim core の `jskim spec dev` がこの store を HTTP API に接続します。

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

- optional companion（engine 本体とは別 install）
- Chromium（Playwright）が必要。ローカル開発向け
- Vite middleware / Vue HMR / screen 単位 incremental collect / persistent browser なし
- reload は既存 SSE による full-page reload
- original application JavaScript は viewer では実行しない（collect 時の一時サーバーでは実行する）
- create-jskim 生成 project へ companion dependency は自動追加しない
