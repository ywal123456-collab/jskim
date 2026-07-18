# JSKim Screen Spec v1

この文書は、JSKim の画面設計書機能（Screen Spec）の **v1 契約** を定義します。
実装の前に、attribute・JSON・validation・folder 構造を固定することが目的です。

## 1. 目的

Screen Spec Generator は、次を行う **deterministic tool** です。

1. 実装画面に付けた識別 attribute を読む
2. Source JSON に書かれた収集手順に従い状態別 DOM を収集する
3. Description JSON の説明と突き合わせて、同じ形式の画面設計書データを作る

次は **行いません**。

- AI による画面推測
- screenshot / OCR 解析
- source code の意味推論
- backend / API 業務規則の解析

ルールの主体は AI ではなく **Screen Spec Generator** です。人または AI が書く場合でも、同じ Schema と validation を通す必要があります。

## 2. core と companion module

| package | 役割 |
|---------|------|
| `@ywal123456/jskim` | 静的 HTML build / watch / serve / dev / `spec collect` / `spec build` / `spec dev`（0.6.0） |
| `@ywal123456/jskim-screen-spec` | 画面設計書 collect / viewer build（optional published companion） |

原則:

```text
別 first-party module
+
利用者には jskim 機能のように見せる
```

companion package の場所:

```text
jskim-screen-spec/
```

想定 CLI:

```bash
jskim spec dev sample
# または手動:
jskim spec collect sample
jskim spec build sample
jskim dev sample
# /  → 実装画面
# /spec/ → 画面設計書 SPA
```

`jskim spec collect` は preserve ビルド → 一時サーバー → companion collector の順で実行します。
`jskim spec dev` は初期 collect / viewer build のあと、同一 port の開発 server と変更監視を開始します。
`jskim dev` は Screen Spec を自動 collect / build しません（companion 未インストールでも動作します）。

## 3. multi-project folder 構造

```text
project-root/
├─ src/{projectName}/
├─ dist/{projectName}/
└─ spec/{projectName}/
```

例:

```text
src/sample
dist/sample
spec/sample
```

開発 server（phase 4B）:

```text
jskim spec dev sample

/       → sample の実装画面
/spec/  → sample の画面設計書 SPA（初期 collect/build 済み）
```

手動手順（phase 4A 互換）:

```text
jskim spec collect sample
jskim spec build sample
jskim dev sample
```

同一 port を使い、project 単位で `/spec/` を切り替える契約です。
`serve` でも同じ `/spec/` mount を提供します（自動 build はしません）。

## 4. Attribute v1

初期は次の 3 つに限定します。

| attribute | 役割 |
|-----------|------|
| `data-jskim-spec-screen` | 収集する画面 root。Source JSON の `screen.id` と一致 |
| `data-jskim-spec-item` | 番号と説明を結ぶ表示項目。Description JSON の `items[<id>]` と一致 |
| `data-jskim-spec-action` | collector が操作する対象。Source JSON action の `target` と一致 |

例:

```html
<main data-jskim-spec-screen="crud-create">
  <div data-jskim-spec-item="product-name">...</div>
  <a
    data-jskim-spec-item="submit-create"
    data-jskim-spec-action="submit-create"
    href="complete.html"
  >登録する</a>
</main>
```

同一 element に `item` と `action` を併記できます。

### ID 規則

lowercase kebab-case:

```text
^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$
```

許可例: `crud-create`, `product-name`, `wizard-step-1`
禁止例: `CustomerName`, `customer_name`, `customer name`, `1st-item`

## 5. Source JSON（収集用）

場所:

```text
src/{projectName}/pages/**/{pageName}.spec.json
```

例:

```text
src/sample/pages/crud/create.html.njk
src/sample/pages/crud/create.spec.json
```

機械向けです。項目の業務説明や文書文は書きません。

トップレベル:

```json
{
  "schemaVersion": "1.0",
  "screen": { "id": "crud-create", "path": "/crud/create.html" },
  "states": [],
  "interactions": []
}
```

Schema:

- `docs/screen-spec/schema/source-spec.v1.schema.json`

### `$schema` URI 方針

公式 sample の sidecar / Description JSON では次の絶対 URI を使います。

```text
https://github.com/ywal123456-collab/jskim/raw/main/docs/screen-spec/schema/source-spec.v1.schema.json
https://github.com/ywal123456-collab/jskim/raw/main/docs/screen-spec/schema/description-spec.v1.schema.json
```

`docs/screen-spec/examples/` では相対 path も使えます。
相対 path / 絶対 URI のどちらでも、`$id` と整合する限り許容します。

## 6. State

1 画面で収集する DOM 状態です。

```json
{
  "id": "default",
  "name": "初期表示",
  "viewer": { "visible": true, "order": 10 },
  "collect": { "actions": [] }
}
```

`viewer.visible: true` の state は、画面設計書 SPA で状態ボタンの source になります。
v1 に別の `controls` 配列は置きません。

## 7. Collect action

許可 type:

| type | 必須 |
|------|------|
| `click` | `target` |
| `check` | `target` |
| `uncheck` | `target` |
| `fill` | `target`, `value` |
| `select` | `target`, `value` |
| `wait` | `milliseconds` |

規則:

- 任意 JavaScript 実行は禁止
- CSS selector を JSON に直接書かない
- `target` は `data-jskim-spec-action` の ID
- collector 内部でのみ `[data-jskim-spec-action="<id>"]` に変換

## 8. Interaction

許可 type:

| type | 必須 | 禁止 |
|------|------|------|
| `state-transition` | `targetStateId` | `targetScreenId`, `url` |
| `screen-transition` | `targetScreenId` | `targetStateId`, `url` |
| `external-link` | `url` | `targetStateId`, `targetScreenId` |

任意 `category`:

```text
modal | tab | accordion | validation | navigation
```

`state-transition` は同一 screen 内の snapshot 切替です。
`screen-transition` は Vue Router などで **同じ SPA 内** の他画面設計書へ切替します（新しい HTML document を開かない）。

## 9. Description JSON（説明用）

場所:

```text
spec/{projectName}/src/data/{screenId}.json
```

人向けの画面名・項目名・説明・備考のみを持ちます。

禁止:

- Playwright action
- selector
- URL path
- target state / screen
- Vue / framework 依存情報

空文字は **schema 上許可**（draft / 再収集時）。
未記入は content warning（`SPEC_DESCRIPTION_EMPTY`）です。

### schemaVersion / `itemOrder` / `excludedItems`

- `schemaVersion: "1.0"` は `docs/screen-spec/schema/description-spec.v1.schema.json`。`itemOrder` / `excludedItems` を持ちません
- `schemaVersion: "1.1"` は `docs/screen-spec/schema/description-spec.v1.1.schema.json`。`itemOrder: string[]`（`items` のキー集合と完全一致・重複禁止・最大 500 件）が必須です
- `schemaVersion: "1.2"` は `docs/screen-spec/schema/description-spec.v1.2.schema.json`。`itemOrder` に加え `excludedItems`（キーが除外 ID 集合。値は `items` と同形）が必須です
- 読込は `1.0` / `1.1` / `1.2` に対応します。新規作成（POST）と Viewer での保存（PUT）は常に `1.2` を書き出します
- 既存の `1.0` / `1.1` ファイルは、保存操作（Viewer PUT または Collector による実際の Description 変更）が起きるまで自動で書き換えません（lazy migration）
- Viewer（`jskim spec dev`）では collected / linked 項目に「設計対象から除外」、除外一覧に「設計対象に戻す」を提供します（確認ダイアログ付き。実装 element は削除しません）

## 10. 再収集 merge 政策

Viewer 編集（phase 7A-1）で保存した `name` / `type` / `description` / `note` は、collect 再実行時も現行 merge 政策どおり保持されます（orphan の自動削除は行いません）。collected / documented の完全分離は未実装です。

```text
実装の item ID 収集
→ 既存 Description JSON 読込
→ ID 基準 merge
```

| 状況 | 動作 |
|------|------|
| 既存 item | 説明を保持（上書きしない） |
| 新規 item | 空 entry を追加 |
| 実装から消えた item | **自動削除しない**。validation で orphan warning |
| key 順序 | 不要な全面再整列をしない |
| `itemOrder`（phase 7B-2A） | 人が並べた既存の順序を維持し、新規に見つかった ID は DOM 出現順で末尾に追加する |
| `excludedItems`（phase 7B-2C-1） | keys にある ID は items / itemOrder へ再追加しない。除外説明は保持する |
| item の追加が無い `1.0` / `1.1` ファイル | そのまま維持（不要な rewrite をしない）。追加がある場合は `1.2` へ upgrade |

`status: "missing"` を Description JSON に自動記録しません。missing は validation report 側で計算します。

## 11. Spec project 構造

```text
spec/{projectName}/
├─ src/
│  ├─ snapshots/{screenId}/{stateId}.html
│  ├─ data/{screenId}.json
│  ├─ resources/
│  │  ├─ manifest.json
│  │  ├─ screens/{screenId}.json
│  │  └─ files/{hash12}.{ext}
│  └─ theme/preview.css
└─ dist/
   ├─ index.html
   ├─ assets/
   └─ data/
```

| 領域 | 扱い |
|------|------|
| `src/data` | 人が管理。削除可能 artifact ではない |
| `src/snapshots` | 手動 / collector 生成物（source としてコミット可） |
| `src/resources` | collector が CSS / 画像などを自動収集（コマンド単位で全置換） |
| `src/theme/preview.css` | DomPreview の viewer 上書きのみ（本体 CSS は resources） |
| `dist` | viewer build の再生成可能成果物（`spec/*/dist/` は gitignore） |

## 12. Vue SPA viewer（phase 3 companion）

技術:

```text
Vue 3 / Vite / TypeScript / Vue Router / Shadow DOM preview
```

実装場所: `jskim-screen-spec/`（`buildScreenSpecViewer`）。

責任分割:

| 機構 | 役割 |
|------|------|
| Vue Router | どの画面設計書を表示するか |
| `selectedStateId` | 同一画面のどの state snapshot を表示するか |

構成:

```text
/spec/
├─ Header
├─ Sidebar（画面一覧）
└─ Screen detail
   ├─ 画面名
   ├─ state button
   ├─ DOM snapshot（画像ではなく DOM node）
   ├─ 自動番号
   ├─ 説明表
   └─ interaction button
```

未登録の `screen-transition` 先（例: `crud-list` / `portal`）は build を失敗させず、ボタンを無効化して「画面設計書未登録」と表示します。

## 13. Production / Spec collection build

| mode | attribute | 状態 |
|------|-----------|------|
| 通常 build | Nunjucks render 後に `data-jskim-spec-*` を **output から除去** | **実装済み**（`transformScreenSpecAttributes`） |
| Spec collection | attribute を **保持** | **実装済み**（`jskim spec collect`。preserve build は一時 `outputDir` へ書き、本番 `dist` は変更しない） |

Source ファイル自体からは削除しません。
attribute 除去は HTML を不用意に再整形しません（既存 output 安定性の維持）。

## 14. Validation / error code

### Schema 水準（構造）

- 必須 field / type / enum
- ID pattern
- action / interaction の type 別必須 field
- `additionalProperties: false`
- `schemaVersion: "1.0"`

### Cross-reference 水準

- screen root と `screen.id`
- item / action / state ID の重複
- action target の存在
- interaction の itemId / targetStateId / targetScreenId
- Description の screen ID 一致
- 実装と説明の item 過不足

### Error / Warning

| 水準 | 扱い |
|------|------|
| Schema / 必須整合 | **ERROR** |
| 説明未記入 / orphan item | **WARNING**（既定） |

代表 code と日本語 message 例:

| code | 例 |
|------|----|
| `SPEC_SCHEMA_INVALID` | Source JSON の形式が不正です。 |
| `SPEC_SCREEN_ID_INVALID` | 画面 ID「…」が kebab-case 規則に合いません。 |
| `SPEC_SCREEN_ROOT_NOT_FOUND` | `data-jskim-spec-screen` の root が見つかりません。 |
| `SPEC_SCREEN_ID_MISMATCH` | Source JSON の画面 ID と attribute が一致しません。 |
| `SPEC_ITEM_ID_INVALID` | 項目 ID「…」が不正です。 |
| `SPEC_ITEM_ID_DUPLICATE` | 項目 ID「…」が重複しています。 |
| `SPEC_ACTION_ID_INVALID` | action ID「…」が不正です。 |
| `SPEC_ACTION_ID_DUPLICATE` | action ID「…」が重複しています。 |
| `SPEC_ACTION_TARGET_NOT_FOUND` | action target「…」に対応する element がありません。 |
| `SPEC_STATE_ID_DUPLICATE` | state ID「…」が重複しています。 |
| `SPEC_TARGET_STATE_NOT_FOUND` | targetStateId「…」が同一 Source JSON にありません。 |
| `SPEC_TARGET_SCREEN_NOT_FOUND` | targetScreenId「…」が project 内にありません。 |
| `SPEC_INTERACTION_ITEM_NOT_FOUND` | interaction の itemId「…」がありません。 |
| `SPEC_DESCRIPTION_SCREEN_MISMATCH` | Description JSON の画面 ID が一致しません。 |
| `SPEC_DESCRIPTION_ITEM_MISSING` | 実装にある項目「…」が Description JSON にありません。 |
| `SPEC_DESCRIPTION_ITEM_ORPHAN` | Description JSON の項目「…」が実装にありません。 |
| `SPEC_DESCRIPTION_EMPTY` | 画面「…」の項目「…」に説明が入力されていません。 |

## 15. 実装済み / 未実装

### 実装済み（phase 2）

- production build での `data-jskim-spec-*` 除去
- 内部 `preserveScreenSpecAttributes` による attribute 保持
- 公式 sample パイロット: `crud-create` + Wizard 3 画面の attribute
- sidecar `*.spec.json`（`src/sample/pages/**`）
- Description JSON（`spec/sample/src/data/`）
- `layouts/base.njk` の `jskimSpecScreen` 変数
- repository と `create-jskim/template` の sample / spec mirror

### 実装済み（phase 3 companion）

- `@ywal123456/jskim-screen-spec`（published companion）パッケージ骨格
- 手動 snapshot 生成（preserve ビルド → `[data-jskim-spec-screen]` outerHTML）
- `buildScreenSpecViewer` による Vue SPA + `spec/{project}/dist` 出力
- DomPreview（Shadow DOM）/ 状態切替 / 項目表 / 未登録遷移先の無効化
- 合成 fixture による `state-transition` / item 順序の Vitest
- `spec/{project}/src/theme/preview.css`（viewer 上書き。本体 CSS は resources 自動収集）

### 実装済み（phase 4A core integration）

- public `jskim spec build <project>`
- optional companion resolution（`@ywal123456/jskim-screen-spec`）
- companion Node runtime entry（`dist/index.js`）
- `jskim dev` / `jskim serve` 同一 port の `/spec/` 静的 mount
- SPA history fallback（拡張子なし route → index.html）
- asset / data 欠落時は 404（fallback しない）
- Vue component mount test（DomPreview / StateSelector / ItemDescriptionTable / router）

### 実装済み（phase 5A Playwright collector）

- public `jskim spec collect <project>`
- core: preserve build → OS TEMP → `127.0.0.1` 一時サーバー → companion `collectScreenSpecProject`
- `viewer.visible` に関係なく **全 state** を収集する
- state は `viewer.order` 昇順（同値は Source JSON 出現順）
- **state ごとに新しい page**（`baseUrl + screen.path` → actions → capture → page close）
- **コマンド単位の原子書き込み**: 全 state 成功後にだけ snapshot / description を書く。失敗時はどちらも更新しない
- Description merge（orphan item / orphan snapshot は警告のみ。未作成時は draft を作成）
- collector は生の outerHTML（ランタイム状態反映）を保存し、viewer build 側の `sanitizeSnapshot` で script / `on*` を除去する境界

### 実装済み（phase 5B CSS / asset auto-collection）

- collect 時に `link[rel=stylesheet]` / `style` と HTML リソース（img / srcset / style url 等）を収集
- `spec/{project}/src/resources/`（manifest / screens / files）へコマンド単位で原子置換
- CSS `@import` / `url()` 再帰、Shadow 互換セレクタ（`postcss-selector-parser`: `:root`/`html`→`:host`、`body`→`.preview-root`。複合・`:is()`/`:not()` 対応）
- collect の `documentContext`（html/body class・安全属性）を viewer の DomPreview へ渡し、`.preview-root.app-body` 等を再現
- 論理 token `jskim-spec-resource://{id}` → build 時に `{base}data/resources/files/{id}` へ展開
- DomPreview が state ごとの stylesheets を注入（theme `preview.css` は最後）
- 外部 URL は収集せず warning（viewer から live network しない）

### 実装済み（phase 4B spec dev watch）

- public `jskim spec dev <project>`
- 初期: collect → atomic viewer build → 既存 `jskim` 同一 port の開発 server
- 実装画面 / Source sidecar 変更 → project rebuild 後に collect + build
- Description / theme 変更 → Playwright なしで viewer build のみ
- snapshots / resources / dist は監視対象外（無限 loop 防止）
- debounce + 直列 queue（実行中変更は最新 batch で 1 回 rerun）
- 失敗時は直前の正常 viewer を保持し、reload せず次の変更で再試行
- 成功後に `/spec/`（deep route 含む）へ live reload（既存 SSE。full-page reload）
- `jskim dev` は Playwright / Screen Spec 自動更新を行わない

### 実装済み（phase 7B-1 設計先行の画面作成 / union / No Preview）

- `loadScreenSpecProject` は Source（実装）と Description（設計）の union で画面一覧を組み立て、各画面に `status`（`design-only` / `implementation-only` / `linked`）と `hasDescription` / `hasImplementation` / `hasPreview` を付与する
- Viewer manifest / 画面詳細ページの Sidebar・header に status badge を表示する（色だけでなく文言でも判別できる日本語表示）
- `jskim spec dev` の編集モードでは、実装が無い画面でも Sidebar の「＋ 画面を作成」から先に画面設計書だけを作成できる（設計先行）
  - `POST /_jskim/spec/descriptions`（`screenId` 無し）で新規作成し、成功時は `201` + 作成した画面の `Location`
  - client 側で `screenId`（kebab-case・最大長）/ `name`（必須・最大長）/ `description`（最大長）を検証してから送信する
  - 作成後は当該画面の route（`/spec/screens/{screenId}`）へ遷移する
- `hasPreview: false` または state が無い画面では Preview 領域に **No Preview** 表示を出し、存在しない state を推測しない（State selector も非表示）
- 画面が 0 件の project でも viewer build は成功し、空の manifest / empty state 表示になる
- 本 phase の対象外（未実装）: item（項目）CRUD、画面の rename / archive / delete、Figma・Reference Image 連携

### 実装済み（phase 7B-2A 項目の追加・並び替え / `itemOrder` / schemaVersion 1.1）

- Description Schema に `description-spec.v1.1.schema.json` を追加（`itemOrder: string[]` が必須。1.0 の schema は変更なし）
- Viewer に「＋ 項目を追加」、上下並び替え、複製、manual-only 削除（確認ダイアログ付き）を追加（drag-drop は未実装）
- GET は `collectedItemIds` を返す。PUT では snapshot を再読込して削除可否を再検証する
- 複製本は原項目の直後に挿入され、常に manual-only として開始する
- `itemOrder` と `items` のキー集合は一致必須（bijection）。不一致は 400

### 実装済み（phase 7B-2C-1 / 7B-2C-2 収集項目の設計対象除外）

詳細方針: [collected-item-exclusion.md](./collected-item-exclusion.md)

- Description Schema `description-spec.v1.2.schema.json`（`excludedItems`。キーが除外 ID 集合）
- 読込は `1.0` / `1.1` / `1.2`。GET 正規化と POST/PUT 書き出しは常に `1.2` + `excludedItems`（読込だけでは 1.0/1.1 を rewrite しない）
- PUT: `currentCollected ⊆ keys(items) ∪ keys(excludedItems)`。新規除外は collected のみ。既存除外の直接削除は拒否。manual-only 削除は従来どおり許可
- Collector は `keys(excludedItems)` を items / itemOrder へ再追加しない
- Viewer（`spec dev`）: 「設計対象から除外」確認ダイアログ、折りたたみ「除外した項目（N）」（`itemId` ソート、実装あり / 実装なし）、「設計対象に戻す」（復元は `itemOrder` 末尾）
- Preview Badge は active `items`（= draft `itemOrder`）に含まれる collected 項目だけ表示。除外項目の Badge は隠す
- 読み取り専用 Viewer（`serve` / 静的 build）では除外ボタン・除外領域を出さず、通常項目（`items`）のみ表示する

### 実装済み（phase 7A-1 Viewer Description 編集）

- `jskim spec dev` 専用の same-origin 編集 API（`GET/PUT /_jskim/spec/descriptions/:screenId`）
- Viewer から次のフィールドを編集し、ローカル Description JSON へ安全に保存する
  - 画面: `name` / `description`
  - 項目: `name` / `type` / `description` / `note`
- `screenId` は読み取り専用。`itemId` の集合は collected 項目の削除を拒否し、manual-only 削除と新規追加を許可する（詳細は phase 7B-2B）
- revision（内容 SHA-256）による楽観的同時更新制御。衝突時は `409 SPEC_DESCRIPTION_REVISION_CONFLICT`
- 書き込みは same-directory TEMP + rename（必要時は backup swap）。partial JSON を残さない。失敗時は既存内容を保全する
- Collector の Description 更新も revision-aware（衝突時は再読込して最大 3 回再試行）。手動 field を上書きしない
- dirty 表示 / 保存 / キャンセル / route leave・`beforeunload` 警告
- 保存後は既存の Description build-only watcher が viewer build → `target=spec` reload を行う（API 自身は build を直接呼ばない）
- `jskim serve` / 通常の `jskim dev` では書き込み API を有効にしない（読み取り専用）
- `--host 0.0.0.0` 利用時は LAN 露出に注意
- collected / documented ファイル分離、入力チェック / API / 処理設計の編集は未実装

### 未実装（v1 非範囲を含む）

- AI / screenshot / OCR / 意味推論
- Vite middleware / Vue component 単位 HMR
- screen 単位の高度な incremental collect / persistent browser
- collected / documented 分離、入力チェック / API / 処理設計 / 画面遷移の編集 UI
- PDF・Excel 出力
- iframe / 任意 JavaScript 実行
- official sample **全体**への attribute 適用（パイロット以外）

## 16. 今後の開発段階（予定）

1. ~~production output からの attribute 除去~~
2. ~~spec collection 向け内部 preserve~~
3. ~~CRUD 代表画面と Wizard への attribute 適用（パイロット）~~
4. ~~sidecar Source JSON / `spec/sample/src/data` 配置~~
5. ~~repository と `create-jskim/template` の mirror~~
6. ~~Vue viewer / companion package（published companion / initial release）~~
7. ~~`jskim spec build` / `/spec/` same-port 提供~~
8. ~~Playwright collector / public `jskim spec collect`~~
9. ~~CSS / asset auto-collection（phase 5B）~~
10. ~~`jskim spec dev` watch / viewer auto reload（phase 4B）~~
11. ~~companion public publish（initial release）~~
12. 必要になった場合のみ Vite HMR / incremental collect

詳細 mapping は [sample-mapping.md](./sample-mapping.md) を参照してください。

## 17. このディレクトリの内容

| path | 内容 |
|------|------|
| `schema/` | Source / Description JSON Schema |
| `examples/` | 公式 sample 由来 + 合成 fixture |
| `sample-mapping.md` | 公式 sample 調査と ID 提案 |
| `README.md` | 本契約文書 |
| `release-0.1.0.md` | companion v0.1.0 / JSkim 0.6.0 公開準備チェックリスト |
