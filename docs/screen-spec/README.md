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
| `@ywal123456/jskim` | 静的 HTML build / watch / serve / dev |
| `@ywal123456/jskim-screen-spec` | 画面設計書 viewer build（companion / 現時点 private） |

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
jskim spec build sample
jskim dev sample
# /  → 実装画面
# /spec/ → 画面設計書 SPA（先に spec build が必要）

jskim spec collect sample   # 未実装
```

`jskim dev` は Screen Spec を自動 build しません。先に `jskim spec build` を実行してください。

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

開発 server（phase 4A）:

```text
jskim spec build sample
jskim dev sample

/       → sample の実装画面
/spec/  → sample の画面設計書 SPA（build 済みの場合）
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

## 10. 再収集 merge 政策

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

`status: "missing"` を Description JSON に自動記録しません。missing は validation report 側で計算します。

## 11. Spec project 構造

```text
spec/{projectName}/
├─ src/
│  ├─ snapshots/{screenId}/{stateId}.html
│  ├─ data/{screenId}.json
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
| `src/theme/preview.css` | DomPreview 用。元 CSS 自動収集は将来 |
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
| Spec collection | attribute を **保持** | **内部 API のみ**（`preserveScreenSpecAttributes: true`）。公開 CLI / 別 outputDir は未実装 |

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

- `@ywal123456/jskim-screen-spec`（private）パッケージ骨格
- 手動 snapshot 生成（preserve ビルド → `[data-jskim-spec-screen]` outerHTML）
- `buildScreenSpecViewer` による Vue SPA + `spec/{project}/dist` 出力
- DomPreview（Shadow DOM）/ 状態切替 / 項目表 / 未登録遷移先の無効化
- 合成 fixture による `state-transition` / item 順序の Vitest
- `spec/{project}/src/theme/preview.css`（元 CSS 自動収集は将来）

### 実装済み（phase 4A core integration）

- public `jskim spec build <project>`
- optional companion resolution（`@ywal123456/jskim-screen-spec`）
- companion Node runtime entry（`dist/index.js`）
- `jskim dev` / `jskim serve` 同一 port の `/spec/` 静的 mount
- SPA history fallback（拡張子なし route → index.html）
- asset / data 欠落時は 404（fallback しない）
- Vue component mount test（DomPreview / StateSelector / ItemDescriptionTable / router）

### 未実装（v1 非範囲を含む）

- AI / screenshot / OCR / 意味推論
- Playwright collector（自動状態収集）
- Screen Spec file watch / Vite middleware / HMR
- `jskim dev` 開始時の Screen Spec 自動 build
- JSON 編集 UI / PDF・Excel 出力
- iframe / 任意 JavaScript 実行
- official sample **全体**への attribute 適用（パイロット以外）
- companion package の npm publish（現時点 private）
- 元 CSS の自動収集

## 16. 今後の開発段階（予定）

1. ~~production output からの attribute 除去~~
2. ~~spec collection 向け内部 preserve~~
3. ~~CRUD 代表画面と Wizard への attribute 適用（パイロット）~~
4. ~~sidecar Source JSON / `spec/sample/src/data` 配置~~
5. ~~repository と `create-jskim/template` の mirror~~
6. ~~Vue viewer / companion package（private）~~
7. ~~`jskim spec build` / `/spec/` same-port 提供~~
8. Vite middleware / Screen Spec watch（phase 4B）
9. Playwright collector / automatic snapshot refresh
10. companion public publish 準備

詳細 mapping は [sample-mapping.md](./sample-mapping.md) を参照してください。

## 17. このディレクトリの内容

| path | 内容 |
|------|------|
| `schema/` | Source / Description JSON Schema |
| `examples/` | 公式 sample 由来 + 合成 fixture |
| `sample-mapping.md` | 公式 sample 調査と ID 提案 |
| `README.md` | 本契約文書 |
