# JSKim Screen Spec（companion package）

## ローカル版管理 core

Node public API は snapshot / status / stage に加え、commit / log / branch / annotated tag / checkout / revert / **merge** / fsck / recovery を提供します。
root CLI は `jskim spec version …`、`jskim spec dev` の read-only Revision API / Viewer 「改訂履歴」まで接続済みです。
**mutation（commit / checkout / revert / merge 等）は CLI のみ**です。Remote / Excel は未提供です。

### 実装済み（Phase 7E-1〜7E-6 / 7E-4B）

- author config（`config.json`）と `resolveVersionAuthor`（explicit → env → config）
- `commitVersion` / `getVersionLog` / `getVersionCommit`
- branch / annotated tag（Screen Spec 内部 tag。source Git tag とは非連携）
- symbolic / detached HEAD、revision resolve
- `checkoutVersion`（dirty 拒否、logical tree → 物理 source materialization）
- `revertVersionCommit`（新 commit として逆変更）
- **`mergeVersion` / `inspectMergeVersion` / `continueMergeVersion` / `abortMergeVersion`**（3-way、Feature domain merge、`MERGE_STATE`）
- `fsckVersionRepository` / `inspectVersionRecovery` / `recoverVersionRepository`
- transaction: **ref/HEAD が commit point**（old → rollback、new → forward）。未完了 journal 中は mutation を `SPEC_VERSION_RECOVERY_REQUIRED` で拒否
- journal path は `operationId` のみから固定導出（traversal / symlink 拒否）。`cleanup_pending` は core 一致後の derived cleanup 再試行
- `project.json.screenOrder`、Feature/Ungrouped 順序契約、PNG signature、index reachable integrity
- root CLI: `jskim spec version init|config|status|diff|add|commit|log|branch|tag|checkout|revert|merge|fsck|recover`
- revision-query（browser-safe）+ `jskim spec dev` Revision API + Viewer 「改訂履歴」（read-only、merge badge / parentCount）
- browser-safe: author email / Figma fileKey・nodeId / token / signed URL 非露出。commit・Feature・item 文字列は HTML 解釈しない
- spec dev bootstrap（`__JSKIM_SPEC_VERSION__`）は capability + API ベース URL のみ（HTML-safe inline JSON）

### 未実装

- Viewer mutation UI、Excel Export、Remote Provider
- **Item Group 編集 UI / mutation API**（Phase 7F-1A 設計: [item-group-hierarchy.md](../docs/screen-spec/item-group-hierarchy.md)）
- **Phase 7F-1B 実装済み**: Description v1.3 schema / read-only normalize / semantic validator / flat projection（`readDescriptionDocument` 等）
- **Phase 7F-1C-1 実装済み**: v1.3 canonical writer / lazy migration / `createDescriptionGroup` / `updateDescriptionGroup`（domain mutation API のみ。HTTP / Viewer UI 未接続）
- **Item Group 編集 UI / HTTP API** — 未実装

### CLI 最小 workflow

```powershell
npx jskim spec collect sample
npx jskim spec version init sample
npx jskim spec version config sample --name "Taro Yamada" --email "taro@example.com"
npx jskim spec version add sample --all
npx jskim spec version commit sample -m "初回登録"
npx jskim spec version status sample
npx jskim spec version log sample
npx jskim spec dev sample
# Viewer で「改訂履歴」を開き、画面 / 機能 / プロジェクト scope の履歴を閲覧
```

- collect は自動実行しません
- commit は stage 済み Screen Spec のみ（implementation の source Git とは別系統）
- Remote はありません。Screen Spec 内部 tag と source Git tag は別です
- checkout は仕様 source を切り替え、実装 Nunjucks は変更しません

詳細契約: [docs/screen-spec/local-version-control.md](../docs/screen-spec/local-version-control.md)

`@ywal123456/jskim-screen-spec` は、JSKim 本体とは独立した **画面設計書 companion package** です（optional / 公開 npm package）。

## インストール

```bash
npm install --save-dev @ywal123456/jskim @ywal123456/jskim-screen-spec
npx playwright install chromium
npx jskim spec dev sample
```

peer dependency: `@ywal123456/jskim` **^0.7.0** が必要です。
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

読み取り専用: `screenId`。`itemId` は既存の変更・削除は拒否されるが、新規追加は許可される（phase 7B-2A、後述）

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
- 画面の rename / archive は未実装
- 画面設計書の削除 API（phase 7B-3B-2）: `DELETE /_jskim/spec/descriptions/:screenId`（`expectedRevision` 必須）
  - `FileDescriptionStore.delete` は Description JSON のみ unlink（source / snapshot / resources は触らない）
  - DESIGN_ONLY → 一覧から除去。LINKED → IMPLEMENTATION_ONLY（Collector は再作成しない）
  - `withDescriptionScreenLock`（project + screenId、in-process queue + `spec/{project}/.jskim/description-mutation/{screenId}.lock`）で Group mutation / PUT / create / DELETE / Collector merge-write を直列化
  - API は build を呼ばない。unlink を watcher が検知して build-only + `reload(target=spec)`
  - 外部 editor との TOCTOU は保証外
- Viewer 画面設計削除（phase 7B-3B-3）: 「画面設計を削除」→ 確認 Dialog → `DELETE` + `expectedRevision`
  - DESIGN_ONLY: Dialog 後に一覧から消え、次 / 前 / empty へ pending navigation
  - LINKED: 同じ route のまま「実装のみ」。source / Preview は残る。stale draft / excludedItems / 手動説明は GET 正規化でリセット
  - dirty / 保存中 / 削除中は操作不可。読み取り専用 Viewer では削除 UI なし
  - watcher build のみ（UI から build endpoint を呼ばない）。409 / 404 は route を変えず再読込を促す
- 画面複製（phase 7B-3A）: Viewer「画面を複製」→ `POST` + `copyFromScreenId`
  - 複製元は **保存済み** Description（または IMPLEMENTATION_ONLY の normalized GET draft）。dirty draft は使わない
  - active `items` / `itemOrder` を deep copy。`excludedItems` は常に `{}`
  - `createFileAtomic` + pending navigation（新規作成と同じ）。結果は `design-only` / No Preview

### 項目の追加・並び替え / `itemOrder`（phase 7B-2A）と除外（phase 7B-2C-1 / 7B-2C-2）

Description Schema は `1.1`（`itemOrder`）と `1.2`（`excludedItems`）を追加しました。`1.0` schema は変更していません。保存モデル / PUT / Collector は phase 7B-2C-1、Viewer UI は 7B-2C-2 です。

```text
Vue Viewer（除外確認 → excludeDescriptionItem / 復元 → restoreDescriptionItem）
  → draft の items / itemOrder / excludedItems を更新（ローカルのみ・未保存）
  → Preview Badge は draft itemOrder（active items）だけで再描画
  → 保存時に same-origin PUT /_jskim/spec/descriptions/:screenId
  → FileDescriptionStore.write()（schemaVersion "1.2" + itemOrder + excludedItems）
```

- 読込は `1.0` / `1.1` / `1.2` に対応（lazy migration。保存操作が起きるまで既存 `1.0`/`1.1` ファイルを書き換えない）
- GET 正規化は常に `schemaVersion "1.2"` + `excludedItems`（欠落時は `{}`）を返す
- 新規作成（POST）は `schemaVersion "1.2"` + `itemOrder: []` + `excludedItems: {}`
- PUT: **最新 collected ⊆ keys(items) ∪ keys(excludedItems)**。新規除外は collected のみ（manual-only 除外は拒否）。既存除外の直接削除は拒否（復元してから削除）。`itemOrder` ↔ `items` bijection、`items ∩ excludedItems = ∅`
- GET は `collectedItemIds` を返し、削除可否・除外可否・「実装あり / 実装なし」表示に使う。PUT では snapshot を再読込して検証する
- Viewer: 上下並び替え、複製、manual-only 削除、collected の「設計対象から除外」、除外一覧の「設計対象に戻す」（復元は `itemOrder` 末尾）
- Preview Badge は active collected のみ。除外 DOM をクリックしても選択しない。読み取り専用では除外 UI を出さない
- 保存エラー（例: `SPEC_DESCRIPTION_MANUAL_ITEM_EXCLUDE_NOT_ALLOWED` / revision conflict）では draft / dirty を保持する
- `jskim spec collect` は `keys(excludedItems)` を items / itemOrder へ再追加せず、人が並べた `itemOrder` を維持する。実際の Description 変更があるときだけ `1.2` へ upgrade。変更が無い `1.0`/`1.1` は rewrite しない

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
- **Description ファイルが無い画面では Description を新規作成しない**（IMPLEMENTATION_ONLY を維持）。observation / snapshot / resources / Viewer manifest は更新する
- 既存 Description がある画面だけ merge / write する（手動 field・itemOrder・excludedItems・revision retry は従来どおり）
- Description JSON の初回作成は Viewer の初回保存（PUT）または画面作成 / 複製（POST）が行う

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

## Device Capture（Phase 7C-1A-1 / 7C-1A-2 / 7C-1A-3）

PC/SP の実 viewport 静止画を保存する core・`jskim spec dev` 専用 HTTP API・Viewer の Live/PC/SP タブです。既存 `collect` からは自動呼び出ししません。

### Viewer（Phase 7C-1A-3）

- Preview タブ: **Live**（既存 DomPreview） / **PC** / **SP**（Capture 画像）
- LINKED / IMPLEMENTATION_ONLY でタブ表示。DESIGN_ONLY は従来の No Preview（タブなし）
- preferred provider は project 単位の `sessionStorage`（`jskim-spec-preview-provider:<project>`）
- persisted: 最新 / 更新が必要 / 未収集 / データ破損。runtime collecting/failed は editable のみ
- 再収集は現在 screen/state/viewport のみ（`spec dev`）。POST 後は expected `imageRevision` の manifest 反映を待つ（`unchanged` は待たない）
- read-only Viewer はタブと画像のみ（再収集・runtime GET なし）

### 内部 core

```ts
import {
  collectDeviceCapture,
  getDeviceCaptureStatus,
} from '@ywal123456/jskim-screen-spec';

const result = await collectDeviceCapture({
  rootDir: process.cwd(),
  projectName: 'sample',
  baseUrl: 'http://127.0.0.1:4173',
  screenId: 'inquiry-input',
  stateId: 'default',
  viewport: 'sp', // or 'pc'
});
```

### HTTP API（spec dev のみ）

```http
POST /_jskim/spec/device-captures:collect
Content-Type: application/json

{ "screenId": "...", "stateId": "...", "viewport": "pc"|"sp" }

GET /_jskim/spec/device-captures/status?screenId=...&stateId=...&viewport=sp
```

- 同一 key 収集中は `409 SPEC_DEVICE_CAPTURE_IN_PROGRESS`（追加の Playwright 起動なし）
- project 直列化は core の queue を再利用（API 層に二重 queue なし）
- runtime `collecting` / `failed` は in-memory（manifest には含めない）
- 成功時 API は build/reload を直接呼ばない。`meta.json` commit → watcher BUILD_ONLY
- generation PNG / TEMP の watcher イベントは IGNORE。`meta.json` のみ BUILD_ONLY
- no-op（`unchanged`）と失敗時は watcher build/reload なし

保存先 / Viewer 出力:

```text
spec/{project}/src/captures/{screenId}/{stateId}/{viewportId}/
├─ capture-<sha256hex>.png
└─ meta.json

spec/{project}/dist/data/device-captures/.../capture-<sha256hex>.png
（参照中の current/stale のみ。invalid/orphan/TEMP はコピーしない）
```

## Reference Image（Phase 7C-2A-1 / 7C-2A-2 / 7C-2A-3）

デザイン基準画像（実装結果ではない）を保存する **内部 core** と、`jskim spec dev` HTTP API・Viewer 参照タブ（追加/置き換え/削除）です。

```ts
import {
  putReferenceImage,
  deleteReferenceImage,
  getReferenceImageStatus,
} from '@ywal123456/jskim-screen-spec';

await putReferenceImage({
  rootDir: process.cwd(),
  projectName: 'sample',
  screenId: 'inquiry-input',
  viewport: 'pc', // or 'sp'
  imageBytes: pngBuffer,
  // 初回: expectedImageRevision 省略 / null
  // 置換: expectedImageRevision: 'sha256:...'
});
```

- 単位: `screenId` + `viewport`（PC/SP 各 0..1）。state 非依存
- format: PNG のみ。最大 20 MiB / 16384×65536
- generation `reference-<sha256>.png` + `meta.json`（commit point）
- persisted: `missing` / `current` / `invalid`（stale なし）
- 同一 key（project+screen+viewport）は lock で直列。optimistic `expectedImageRevision`
- 同一画像再 upload は `unchanged`（meta 非更新）
- watcher: `references/**/meta.json` のみ BUILD_ONLY。generation / TEMP は IGNORE
- manifest: screen の `referenceImages` / `hasReferenceImage` / `hasAnyPreview`（`hasPreview` 意味は維持）
- output: `data/reference-images/{screenId}/{viewport}/reference-<sha>.png`（current のみ）
- Description 削除・画面複製では Reference を自動削除/複製しない

HTTP API（Phase 7C-2A-2、`jskim spec dev` のみ。engine `scripts/lib`）:

```text
PUT    /_jskim/spec/reference-images/{screenId}/{viewport}   multipart/form-data
DELETE /_jskim/spec/reference-images/{screenId}/{viewport}   application/json
GET    /_jskim/spec/reference-images/status?screenId=&viewport=
```

- 保存は companion core（`putReferenceImage` / `deleteReferenceImage`）に委譲。API 層に第 2 queue は持たない
- multipart: binary-safe 最小 parser（外部依存なし）。全体 body 上限 21 MiB、PNG 本体 20 MiB
- field 契約: `image` ファイル 1 件必須、`expectedImageRevision` テキスト 0..1。unknown / 重複 field は 400
- same-origin / Content-Type / JSON body 制限は Description・Device Capture write API と同方針
- runtime registry（in-memory）: `idle` / `uploading` / `deleting` / `failed`。同一 key 進行中は 409
- API 成功後の build/reload は watcher の meta.json BUILD_ONLY に委譲（API は直接呼び出さない）
Viewer（Phase 7C-2A-3）:

- Preview provider: `live` / `pc` / `sp` / `reference`（preferred は project-scope sessionStorage）
- 参照タブ内 viewport: `pc` / `sp`（`jskim-spec-reference-viewport:<project>`。Device Capture の PC/SP とは独立）
- DESIGN_ONLY editable は参照タブのみ。StateSelector は参照中に非表示
- Upload / Replace / Delete Dialog → FormData PUT / JSON DELETE
- pending: `jskim-spec-pending-reference-image:<project>`（created/updated は result revision 待ち、delete は missing 待ち。固定 timeout 成功なし）
- runtime status GET は参照タブ・editable のみ。uploading/deleting のときだけ polling
- 共通画像表示: `PreviewImage`（fit-to-width・拡大なし・revision URL・timestamp query なし）
- read-only は画像/invalid 案内のみ（write / status / Dialog なし）

保存先:

```text
spec/{project}/src/references/{screenId}/{viewport}/
├─ reference-<sha256hex>.png
└─ meta.json
```

## Figma Frame Import / Reimport（Phase 7D）

Figma 上の **Frame** を PNG として取得し、既存の Reference Image として保存・再取得できます。専用の画像ストアは作りません（Device Capture とも別パスです）。

利用可能なモード:

| モード | Import / Reimport |
|--------|-------------------|
| `jskim spec dev` | 可（参照タブ） |
| `jskim serve` / 通常の `jskim dev`（読み取り専用 Viewer） | **不可**（ボタン非表示・API なし） |

### 準備

1. Figma で Personal Access Token（PAT）を発行する
2. 必要な scope: **`file_content:read`**
3. サーバー側の環境変数だけに設定する（名前: **`JSKIM_FIGMA_TOKEN`**）

注意:

- トークンを `jskim.config.js` / Description / meta.json / manifest / HTTP リクエスト body に書かない
- Viewer やログに token / `fileKey` / `nodeId` を表示しない
- OAuth は未対応（PAT のみ）
- PAT は期限切れ・撤回後に再発行し、環境変数を更新する

PowerShell（現在の process にだけ設定。平文をコマンド履歴へ残さない）:

```powershell
$secure = Read-Host -AsSecureString "JSKIM_FIGMA_TOKEN"
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:JSKIM_FIGMA_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
# 終了後:
Remove-Item Env:JSKIM_FIGMA_TOKEN -ErrorAction SilentlyContinue
```

POSIX 系では、実際のトークン値をシェル履歴に残さない方法で `JSKIM_FIGMA_TOKEN` を設定してください（例: 対話入力や secret manager。ドキュメントに実トークンを貼らない）。

### Viewer での Import

1. `jskim spec dev <project>` を起動する
2. `/spec/` で対象画面を開き、Preview の **参照** タブを選ぶ
3. 参照タブ内で viewport（**PC** / **SP**）を選ぶ（自動判定しない）
4. **Figmaから取込** を開き、`node-id` 付きの Figma Frame URL を入力する
5. **取り込む** を実行する

URL 例（形式のみ。実ファイルの URL は各自の Figma を使う）:

```text
https://www.figma.com/design/<fileKey>/<name>?node-id=1-2
```

対象は **FRAME** のみです。幅が選択中 viewport（PC=1440 / SP=375）と異なる場合は確認ダイアログが出ます。内容を理解したうえで取り込めます。同じ画像なら `unchanged` となりメタ更新しません。

### Viewer での Reimport

1. 参照画像のソースが **Figma** のとき **Figmaから再取込** が表示される
2. 再取込は browser が `fileKey` / `nodeId` を送らず、サーバーが保存済み source から再 export する
3. Figma 側で Frame 内容を更新したあと再取込すると、画像と `imageRevision` が更新される

手動 upload で置き換えると source は upload に戻り、Figma 再取込はできなくなります。

### エラーと制限

- `JSKIM_FIGMA_TOKEN` 未設定: 設定案内のエラー（外部 Figma へは送らない）
- 429 / rate limit: 利用上限メッセージ（Retry-After がある場合は待機目安を含む）
- read-only Viewer / `serve`: Import・Reimport UI なし
- 実 Figma の手動確認は開発時に **1 Frame / 1 viewport** で実施済み。全 plan の網羅検証ではない

契約の詳細は [docs/screen-spec/figma-frame-import.md](../docs/screen-spec/figma-frame-import.md) と [docs/screen-spec/reference-image.md](../docs/screen-spec/reference-image.md) を参照してください。

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

## Feature Group / ローカル版管理（Phase 7E-1〜7E-5）

`spec dev` では Feature Group の **閲覧・編集**（`機能管理` dialog）と、static build では **hierarchy 表示のみ** を提供します。Feature 変更は working tree のみで、`jskim spec version add --features` / `commit` が必要です。

| API | 役割 |
|-----|------|
| `loadScreenFeatures` / `persistScreenFeatures` / `validateScreenFeatureFile` | `spec/{project}/src/features.json` |
| `getScreenFeatureWorkingState` / `createScreenFeature` / … | mutation domain（revision + lock） |
| `GET/POST/PATCH/DELETE /_jskim/spec/features` | spec dev mutation API |
| `initVersionRepository` | `spec/{project}/.jskim/version/` の metadata 初期化（commit なし） |
| object / snapshot / status / stage | 7E-1 / 7E-2 |
| author / commit / log / branch / tag / checkout / revert / fsck / recovery | 7E-3 |
| read-only Revision API / Viewer 改訂履歴 modal | 7E-4B |

未実装: Viewer 版 mutation UI、Excel Export、Remote。Screen Spec 内部 tag は source Git tag と自動連携しません。
author email / Figma `fileKey` / `nodeId` は Revision/Feature API・Viewer に露出しません（CLI/repository には保持）。
Feature mutation lock は `spec/{project}/.jskim/features.lock`（gitignore 対象）。

詳細契約は `docs/screen-spec/local-version-control.md` を参照してください。

## 制限（現状）

- optional companion（engine 本体とは別 install）
- Chromium（Playwright）が必要。ローカル開発向け
- Vite middleware / Vue HMR / screen 単位 incremental collect / persistent browser なし
- reload は既存 SSE による full-page reload
- original application JavaScript は viewer では実行しない（collect 時の一時サーバーでは実行する）
- create-jskim 生成 project へ companion dependency は自動追加しない
