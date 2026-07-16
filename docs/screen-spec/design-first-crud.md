# 画面設計書 Screen / Item CRUD 設計（Phase 7B）

このドキュメントは、JSKim Screen Spec を **実装先行**（既存フロー）だけでなく **設計先行**（画面を先に作る）でも使えるようにするための設計方針をまとめたものです。

**現在（Phase 7B-1）で実装済みなのは** 画面一覧の union、0 画面 Viewer、設計画面の POST 作成、No Preview、DESIGN_ONLY / IMPLEMENTATION_ONLY / LINKED の派生状態、および既存 GET/PUT の対象拡張です。
JSON Schema（schemaVersion 1.0）・fixture・sample・package version は変更していません。
項目（Item）の CRUD、`itemOrder` / schemaVersion 1.1、画面の複製・削除・アーカイブ、Figma 連携は未実装です。

## 関連

- companion 全体像: [README.md](./README.md)
- companion package: [../../jskim-screen-spec/README.md](../../jskim-screen-spec/README.md)
- Description Schema: [schema/description-spec.v1.schema.json](./schema/description-spec.v1.schema.json)

---

## 1. 背景

現状の Screen Spec は次の順序を前提にしていました。

```text
実装画面 + Source JSON
→ jskim spec collect
→ Description / snapshot / resources
→ Viewer で確認
```

`loadScreenSpecProject` は **Source + Description + Snapshot の和集合（union）** で画面一覧を組み立てます。
三者が揃っていない画面（design-only / implementation-only）も含めて読み込みます。

- 実装が無くても画面設計だけ先に作れる
- Description が無くても Viewer に画面が表示される
- Preview（snapshot）が無い画面は No Preview 表示になり、Description の項目編集 API に item ID 存在チェックを追加しない（Phase 7B-2 の範囲）

この前提から、画面の作り方には次の 2 系統がある、という整理をします。

```text
A. 設計先行: 画面設計書だけを先に作ってから、実装側で collect と連携する
B. 実装先行: 実装側から collect して画面設計書側へ反映する（既存フロー）
```

---

## 2. 用語整理

### 2.1 設計先行フロー

1. Viewer から画面を新規作成する（`screenId` / 画面名 / 画面説明）
2. Preview は無い状態で表示される（**No Preview**）。項目 CRUD は Phase 7B-2
3. 実装側で HTML・`screenId` / `itemId` の attribute を付与する
4. 実装側で `screenId` / `itemId` を付与した後、HTML を実装する
5. `jskim spec collect` で snapshot を収集して実装側と連携する

### 2.2 実装先行フロー（既存フロー）

1. Source / HTML を実装する
2. collect で Description draft・snapshot を生成する
3. Viewer で確認する

### 2.3 混在

同一 project 内で `design-only` の画面と `linked` の画面が混在します。Viewer 側では **status badge** で区別のみ表示します。

---

## 3. 画面設計書ファイルの構造（既存）

### 3.1 Description JSON

場所: `spec/{project}/src/data/{screenId}.json`

現行 schema（`1.0`）の主な field:

| field | 説明 |
|-----------|------|
| `$schema` | 任意（sample では絶対 URI） |
| `schemaVersion` | `"1.0"` 固定 |
| `screen` | `{ id, name, description }` |
| `items` | **ID をキーとする object**（配列ではない） |

`items` が object である理由:

- `data-jskim-spec-item` との 1:1 対応
- collect merge 時に ID 基準で既存内容を保持し、orphan item を自動削除しない
- 表示順は DOM 順の `itemOrder[]`（manifest / ViewerScreenData 側で計算）

出力形式: `JSON.stringify(..., null, 2) + "\n"`。`$schema` を含めても不正にならないよう保存する。

### 3.2 実装側の source

```text
src/{project}/pages/**/*.spec.json   ← Source（実装側の収集手順）
spec/{project}/src/data/*.json       ← Description（説明側）
spec/{project}/src/snapshots/{id}/   ← Snapshot（収集結果）
        ↓
loadScreenSpecProject()
        ↓
createViewerManifest() → data/manifest.json
        ↓
SpecSidebar（manifest.screens）
```

**Description が無い画面** でも Source / snapshot があれば Viewer に表示されます。

表示名の優先順位: Description があれば `screen.name`、無ければ Source（実装側の識別子）を使う。
実装 path: Source の `screen.path`。

### 3.3 Preview と collect の境界

`ScreenSpecPage` は次を fetch します。

- `data/screens/{id}.json`（states / itemOrder / interactions）
- `data/{snapshotFile}`（state ごとの HTML）
- 任意で theme CSS / resources stylesheets / documentContext

collect 前提の情報が無い画面（snapshot 無し）は **No Preview** を表示します。
snapshot 読込失敗や loadError は既存の viewer build エラー扱いのままです。

### 3.4 編集 API（Phase 7A-1）

```http
GET  /_jskim/spec/descriptions/{screenId}
PUT  /_jskim/spec/descriptions/{screenId}
```

- `jskim spec dev` 専用。same-origin / JSON / 256KB 制限
- `FileDescriptionStore`: revision = 内容の SHA-256
- 未作成 screen: empty document を返す（GET）
- PUT: `expectedRevision` 不一致は **保存せず既存内容を保全**
- `listScreenIds()` = `loadScreenSpecProject().screens`（実装側のみでも含む）
  → **画面が未収集でも Description API は 404 にしない**

保存後: Description watcher（BUILD_ONLY）が viewer build 1回・reload `target=spec` 1回。API 自身は build を呼ばない。

### 3.5 監視対象の watcher

`spec/.../src/data` の add/change/unlink は BUILD_ONLY。
Description 変更は sidebar 表示に反映しますが、**snapshot / resources の再収集は行いません**（IGNORE 対象外）。

### 3.6 用語まとめ

| 項目 | 状態 |
|------|------|
| Description の読み書き | 実装済み |
| Preview 表示・編集 | 実装済み（実装が無ければ表示しない） |
| Viewer 表示のみのフィールド | 未実装 JSON に無いフィールド（ID 対応のみ） |
| 表示順の計算 | 実装済み（DOM `itemOrder` 経由） |
| 画面新規作成 API | 実装済み |
| 画面変更 API | 実装済み |

---

## 4. 画面設計の原則

1. **画面の唯一の真実は Description / Source の JSON である**
2. **Collector は人が書いた文章を書き換えない**（上書き禁止。空欄追加のみ）
3. **人が書く文章は最小限にする**（name / description / note のみ）
4. **画面の識別子は実装側（HTML / Nunjucks）と一致させる**（勝手に変換しない）
5. **`screenId` / `itemId` は変更不能な stable ID**
6. **Preview が無い画面でも画面設計自体は編集できる**
7. 収集済み / 記述済みの状態を突き合わせて表示するが、その突き合わせ結果を Description ファイルへ書き込むことはしない（判定は毎回計算する）

---

## 5. 画面 CRUD

### 5.1 画面作成（Phase 7B-1・実装済み）

入力 field（必須）:

| field | 必須 | 補足 |
|-----------|------|------|
| `screenId` | 必須 | kebab-case・変更不能・不変 |
| `name` | 必須 | 画面名 |
| `description` | 任意（未入力可） | 画面説明 |

**`plannedPath` / `route` / URL は Phase 7B の Schema に含めません。**
補足: 画面作成時点では実際の route（actual route）や計画中の route（planned route）を紐付ける情報が無く、viewport / Figma / design source metadata も含めないため、Schema はこの Phase では拡張しません（将来 Phase の検討事項、16 章参照）。

保存先（実装済み）:

```text
spec/{project}/src/data/{screenId}.json
```

作成される内容（**schemaVersion 1.0、itemOrder 無し** ← Phase 7B-1）:

```json
{
  "$schema": "https://github.com/ywal123456-collab/jskim/raw/main/docs/screen-spec/schema/description-spec.v1.schema.json",
  "schemaVersion": "1.0",
  "screen": {
    "id": "inquiry-input",
    "name": "お問い合わせ入力",
    "description": "設計段階のメモ（未実装）"
  },
  "items": {}
}
```

作成 API の挙動（実装済み）:

- 既存 `screenId` への再作成は 409 エラー
- path traversal / 不正な ID は 400 エラー
- revision = 内容の SHA-256
- 作成後の Viewer route: `/spec/screens/{screenId}`
- Preview: **No Preview**（snapshot が無いため build 前後どちらでも変わらない）
- watcher: file write 1回 → BUILD_ONLY 1回 → reload(spec) 1回（collect 0回）

### 5.2 screenId の命名規則

**Phase 7B の画面作成時点では screenId の命名規則を追加していません。**
補足: 保存後は Viewer route や interaction の `targetScreenId`、将来の Figma / source binding、history 等が依存するため、後から変更する仕組みは設けていません。
画面名は `screen.name` であり、命名規則の対象ではありません。

### 5.3 画面内容の編集

既存の GET/PUT は `screen.name` / `screen.description` を編集できます（7A-1 と同一）。
画面が未収集でも編集 API を呼べるように、`listScreenIds` は **union で計算**するようにしています（Phase 7B-1）。

### 5.4 画面の複製（Phase 7B-3・将来）

想定: 既存の `screenId` から名前だけ変えた新規画面を作る。

| 複製する内容 | 複製しない内容 |
|----------|------------|
| `screen.name` / `description`（新しい値で上書き） | Source / snapshot / resources |
| `items`（Phase 7B-2 導入の `itemOrder` 含む） | collected の DOM 依存情報 |
| Description 内の画面固有 field | Figma binding（実装後にひも付ける） |

実装案: `POST` create に `copyFromScreenId` を追加する案（7B-1 の POST には含めない）。

### 5.5 画面のアーカイブ（archive）

**Phase 7B の範囲では実装しません**（将来検討・別枠）。

### 5.6 画面の削除（Phase 7B-3・将来）

削除の影響範囲は、状態によって異なります。

| 状態 | 影響 |
|--------|------|
| 設計のみ（Description のみ、Source/snapshot 無し） | Description ファイルの削除だけで完結（`expectedRevision` 必須） |
| 設計＋実装（LINKED） | Description を削除しても **実装側は消さない**。次の collect で IMPLEMENTATION_ONLY に戻り、その旨を UI へ表示する |
| 実装側の削除 | Description は残す（実装側の削除は Screen Spec の範囲外） |

注意:

- HTML / Nunjucks / `.spec.json` は削除しない
- snapshot / resources は既存の再収集ルールに従う（本 Phase では変更しない）

削除された画面は BUILD_ONLY で reload しますが、collect（Playwright）は呼ばない前提です（Phase 7B-1 時点で build は影響を受けません）。

---

## 6. 項目 CRUD（未実装・Phase 7B-2）

### 6.1 項目の新規作成

入力 field: `itemId`, `name`, `type`, `description`, `note`。

JSON（本文中の一例）:

```json
"items": {
  "inquiry-type": {
    "name": "お問い合わせ種別",
    "type": "セレクトボックス",
    "description": "",
    "note": ""
  }
}
```

`itemOrder` を追加するまでは表示順は DOM 順（見出し 6.4）。

Preview badge は manual item（未収集の item）を preview 側の枠外にリスト表示する想定（詳細は将来 Phase）。

### 6.2 itemId の命名規則

**既存の item ID 命名規則は変更しません（7A-1 の方針を継続）。**
複製時も ID は複製せず、rename は将来検討。

### 6.3 項目 API の設計方針

**方針: Viewer の local state で item CRUD を行い、送信は常に whole-document PUT。**

| 論点 | 結論 |
|------|------|
| revision / atomic write の単位 | document 単位（画面全体を1つの単位として扱う。項目単位ではない） |
| API 呼び出し回数 | item 個別ではなく document 一括で送信して conflict を避ける |
| 画面＋項目の同時編集 | validation は document 単位で行う |

**理由:** 現状の Description 編集 API はすでに画面単位の whole-document PUT を採用しているため、item 個別の REST エンドポイントは追加せず一貫性を保つ。

編集 API 自体の item ID 存在チェックは、この **Phase 7B-2 の対象**とし、現時点では追加しません。

- PUT で item を追加・削除・並び替えすると `itemOrder` の命名規則を適用する
- collect 実行時に既存 ID と突き合わせて union で merge する（**既存 ID が優先**。無ければ Description 側へ追加する既存 merge）

### 6.4 項目の並び順（Phase 7B-2 の想定）

**保存する情報を `itemOrder: string[]` として追加します。** Schema はこの追加により **`schemaVersion: "1.1"`**（13章）になります。

```json
{
  "schemaVersion": "1.1",
  "itemOrder": ["inquiry-type", "inquiry-content", "confirm-button"],
  "items": {
    "inquiry-type": { "name": "...", "type": "...", "description": "", "note": "" },
    "inquiry-content": { "name": "...", "type": "...", "description": "", "note": "" },
    "confirm-button": { "name": "...", "type": "...", "description": "", "note": "" }
  }
}
```

| 案 | 特徴 |
|----|------|
| `itemOrder[]` + `items{}` | stable ID・reorder・diff が明確に扱える（**採用**） |
| 各 item に `order: number` | 欠番や重複が発生しやすい |
| object のキー順に依存 | JSON 実装によって re-serialize 順が変わる可能性がある（採用しない） |

#### itemOrder が無い場合の並び順（design-only 画面）

1. `itemOrder` が無ければ、`items` に登場する ID の順（`itemOrder` 導入前）
2. `items` に無い ID は追加された順の末尾
3. collect 実行時は実装側で検出した ID 順（collected DOM の順）を優先する

#### itemOrder の互換性（1.0 との compatibility order）

1. collected manifest 側で並び順が分かる item
2. それ以外の manual-only item（既存 JSON の **object のキー順** を compatibility fallback として使う）

既存 ID と新規 ID の突き合わせは **collect 実行時の validation** で行う想定です（Spec Check の対象）。

Collector merge（7B-2 導入時点の方針）:

- 実装から見つかった ID が `items` に無い場合は空 entry を追加する（既存 merge 政策の継続）
- Description にのみ存在する item を **自動削除しない**（orphan として警告のみ）
- Viewer 側の badge で ORPHAN を明示する（将来 Phase の課題）

### 6.5 項目の複製

- `itemId` は複製せず新規発行する（source binding があれば手動で紐付ける）
- 画面の複製と合わせて、実装との紐付けは複製後に手動で行う

### 6.6 項目の削除

| 論点 | 現時点の方針 |
|--------|----------|
| Description 側のみの項目削除 | whole-document PUT で反映する |
| 実装側に残っている ID の削除 | 削除しても、次の collect で placeholder として **再追加**される（既存 merge の継続） |
| 削除に伴う validation | 特別な追加チェックは行わない |

**補足:** 上記の設計は、item の削除が実装側の DOM 変更と独立していないことを前提にしています（5.2 章と同様）。実際の Phase では、item の状態を `DESIGN_ONLY`（実装側に collected 情報が無い状態）として扱う想定です。

---

## 7. Schema / manifest の変更

### 7.1 Description（Phase による差分）

**Phase 7B-1（現行 1.0 のまま・実装済み）:**

```text
DescriptionDocument
  $schema?
  schemaVersion: "1.0"
  screen: { id, name, description }
  items: Record<itemId, Item>
```

**Phase 7B-2（1.1 導入時点の想定）:**

```text
DescriptionDocument
  $schema?
  schemaVersion: "1.1"
  screen: { id, name, description }
  itemOrder: string[]
  items: Record<itemId, Item>
```

`plannedPath` / `designSources` / `archived` などは **現時点で追加しません**（Phase 7B-1 の範囲外）。

npm package version（現行: companion `0.1.0`）と Description の `schemaVersion`（`1.0` / `1.1`）は **独立**に管理します。

### 7.2 Viewer Manifest（実装済み）

現行 `ManifestScreen`: `{ id, name, path, dataFile, status, hasDescription, hasImplementation, hasPreview }`

```ts
{
  id: string
  name: string              // 表示用（3.2 章の優先順位に従う）
  path: string               // Source が無ければ ""
  dataFile: string
  hasDescription: boolean
  hasImplementation: boolean
  hasPreview: boolean
  status: "design-only" | "implementation-only" | "linked"
}
```

build 時点で **Description 単独** でも **Source 単独** でも union に含めます。
Snapshot が無い画面は `hasPreview: false`（Phase 7B-1 時点では state 一覧も渡さない。DOM 依存の項目順は 6.4 章の Phase 7B-2 で扱う）。

### 7.3 JSON の例

#### 画面設計のみ（Phase 7B-1 / schemaVersion 1.0）

```json
{
  "$schema": "https://github.com/ywal123456-collab/jskim/raw/main/docs/screen-spec/schema/description-spec.v1.schema.json",
  "schemaVersion": "1.0",
  "screen": {
    "id": "inquiry-confirm",
    "name": "お問い合わせ内容確認",
    "description": "確認内容を表示する画面（実装未着手）"
  },
  "items": {}
}
```

#### 画面設計 + 実装（連携済み・LINKED）

Description の schema は変わりません（7B-1 の時点では 1.0）。
`hasDescription && hasImplementation && hasPreview` のとき Viewer 側で `linked` と表示します。

#### manual + collected の混在（Phase 7B-2 / schemaVersion 1.1 想定）

```json
{
  "$schema": "https://github.com/ywal123456-collab/jskim/raw/main/docs/screen-spec/schema/description-spec.v1.schema.json",
  "schemaVersion": "1.1",
  "screen": {
    "id": "inquiry-input",
    "name": "お問い合わせ入力",
    "description": ""
  },
  "itemOrder": [
    "inquiry-type",
    "inquiry-content",
    "future-attachment",
    "confirm-button"
  ],
  "items": {
    "inquiry-type": {
      "name": "種別",
      "type": "セレクトボックス",
      "description": "実装済みの項目",
      "note": ""
    },
    "inquiry-content": {
      "name": "内容",
      "type": "テキストエリア",
      "description": "実装済みの項目",
      "note": ""
    },
    "future-attachment": {
      "name": "添付ファイル（予定）",
      "type": "未実装",
      "description": "先に DOM に無い項目を設計しておく例",
      "note": "実装側で同じ ID を付与すること"
    },
    "confirm-button": {
      "name": "確認する",
      "type": "ボタン",
      "description": "",
      "note": ""
    }
  }
}
```

`future-attachment` は badge が付く想定です（将来 Phase）。実装 collect 時点で `status` が `design-only`（Description のみで collected の情報が無い）と判定される item として扱う想定です。

#### itemOrder の破損時（互換・1.1）

読込に失敗した場合、`itemOrder` を無視して既存の互換表示（8章）にフォールバックします。

---

## 8. 状態の派生

### 8.1 ORPHAN の扱いは将来 Phase で決める

次の 2 種類の「取り残された」状態が想定されます。

```text
A. Description に追加したが、実装側にまだ紐付いていない項目
B. 過去は実装にあったが、今の実装からは消えた項目
```

現時点で追加する情報は次の 2 つだけです。

```text
Description の存在
Source / Collected の存在
```

ORPHAN（削除済みだが Description に残っている状態）を厳密に判定するには **persisted metadata** を別途持つ必要があり、現時点では実装しません。想定される情報:

```text
sourceBinding
lastCollectedAt
previouslyLinked
（または collected registry / history）
```

項目レベルの **manual-only item** と **過去に実装があった item** の区別は将来 Phase の課題です。

### 8.2 Phase 7B 実装時点の画面 status（derived）

現時点で計算する status は **3 種類**です。

| Status | 判定（derived） | 意味 |
|--------|-----------------|------------|
| `design-only` | Description あり ／ Source・snapshot 無し | 画面設計のみ |
| `implementation-only` | Source＋snapshot あり ／ Description 無し | 実装のみ |
| `linked` | Description ＋ Source ＋ snapshot | 両方連携済み |

JSON 側に `status` を保存することはしません（毎回 derived で計算）。

### 8.3 Phase 7B 実装時点の項目 status（derived・将来）

| Status | 判定 | 意味 |
|--------|------|------------|
| `design-only` | items にあるが collected DOM に無い | 画面設計のみ |
| `implementation-only` | collected にあるが items に無い | 実装のみ |
| `linked` | 両方にある | 連携済み |

この項目レベルの判定は ORPHAN 検討（8.1 章）と合わせて将来 Phase の課題です。

### 8.4 将来 Phase の候補

| Status | 概要（案） |
|--------|----------|
| `MISMATCH` | collected / documented の不整合を検出 |
| `ORPHAN`（画面 / 項目） | 過去に実装があったことを persisted metadata で判定 |
| `ARCHIVED` | アーカイブ済み（persisted `archived` フラグ） |

現時点では次を **追加しません**。

```text
ORPHAN
ORPHAN_IMPL
実装済みの削除
MISMATCH
ARCHIVED
```

---

## 9. Preview の画面設計

### 9.1 Preview の種類（将来含む）

| 種類 | Phase |
|--------|-------|
| Live Preview（snapshot） | 実装済み |
| No Preview | **7B-1** |
| Reference Image | 7C |
| Figma Frame | 7D |

### 9.2 No Preview UI（実装済み）

実装が無い画面の Preview 領域は、次の文言で案内します。

```text
この画面はまだ実装画面と連携されていません。

基本情報は先に編集できます。
実装後に jskim spec collect を実行すると Preview が表示されます。
```

案内しない内容:

- Figma の埋め込み
- 参考画像の表示
- 実装の設計案（コード生成など）

### 9.3 No Preview 実装範囲（Phase 7B-1）

- 画面情報（名前・説明）の編集は継続してできる
- section navigation（route 遷移・dirty / beforeunload / route guard）は既存の仕組みをそのまま使う
- badge の表示だけで、DOM に依存しない情報のみを表示する

項目 CRUD が加わるのは Phase 7B-2 です。

---

## 10. Viewer の画面一覧（実装済み）

```text
screens = DescriptionDocuments ∪ SourceScreens（snapshot 有無で status を derive）
```

例:

| screenId | Description | Source+Snap | status |
|----------|-------------|-------------|--------|
| inquiry-input | あり | あり | linked |
| inquiry-confirm | あり | 無し | design-only |
| inquiry-complete | 無し | あり | implementation-only |

### 表示名の優先順位

表示名は次の順で決まります。

```text
1. Description の screen.name
2. Source 側から得られる collected metadata の表示名
3. screenId
```

補足:

- implementation-only では Description が無いため表示名を作れない場合がある
- Description が作成された時点で表示名が確定する
- 実装側にしか無い画面でも stable ID を使う

現行の `screenId` は **Description が無くても画面設計の一部**として扱うため、一覧に含めます。

並び順: `screenId` の localeCompare（Phase 7B-1 時点）。将来 `viewer.order` を優先することも検討可能です。
archive: 将来 Phase の対象で現時点では実装しません。

### Manifest / build

- 画面が無いプロジェクトでも SPA は build を成功させる（empty state）
- Description のみの画面も **BUILD_ONLY** の対象に含める
- implementation-only: 画面情報の GET は空 document を返し、PUT で新規作成できる（Phase 7B-1）

---

## 11. Local API 一覧（現行・実装先行が前提だった時期の設計含む）

### 11.1 Phase 7B-1 で追加された API

```http
GET  /_jskim/spec/descriptions/{screenId}
PUT  /_jskim/spec/descriptions/{screenId}
POST /_jskim/spec/descriptions
```

`POST` の役割: **画面設計のみを新規作成**する。

```json
{
  "screenId": "inquiry-confirm",
  "name": "お問い合わせ内容確認",
  "description": ""
}
```

### 11.2 Phase 7B-3 で検討する拡張

| API | Phase |
|-----|-------|
| `POST` に `copyFromScreenId`（複製） | 7B-3 |
| `DELETE /_jskim/spec/descriptions/{screenId}` | 7B-3 |

DELETE の設計候補（未決定）:

| 案 | 特徴 |
|----|------|
| `DELETE` + query `?expectedRevision=sha256:...` | 実装がシンプル（採用候補） |
| `POST .../delete` + JSON body | body に revision を含めやすい |
| `DELETE` + JSON body | 一部 client / proxy で body が扱いにくい |

衝突時は 409（7A-1 の方針を継続）。

### 11.3 項目（Phase 7B-2）

item CRUD 専用の endpoint は追加せず、**既存の whole-document PUT** で扱います。

### 11.4 listScreenIds / union の計算（実装済み・7B-1）

計算範囲を Description のみでなく Source（実装側）を含む union にしました。
画面設計のみの GET/PUT は既存のまま動作します。
implementation-only は空 document を返す GET から新規作成できます。

---

## 12. Validation

### 画面

- `screenId`: `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`、max 128（既存 schema）
- reserved: `_empty`、`con`、`aux` など（Windows 予約名を含む）
- 保存先: `{screenId}.json`（traversal 検証）
- 既存 screenId への再作成は拒否
- name/description: string（trim して空文字も許可。max: name 200 / description 10000）は実装側で入力を制限する
- body は 256KB 超で拒否

### 項目（将来・7B-2）

- `itemId` は画面の ID と同じ規則
- `itemOrder` と `items` のキー集合は一致させる（不一致は validation エラー / 将来の Spec Check）
- 説明は空文字許可
- collect 側の新規 ID は追加のみ（削除しない）

### 削除（7B-3）

- `expectedRevision` 必須
- 実装側で削除された場合の再収集を反映する動作を検討
- dirty な Viewer 側では別途確認（キャンセル可能）

---

## 13. 既存 JSON の互換性・schemaVersion

### Phase 7B-1

```text
既存の Description 構造をそのまま利用
schemaVersion: "1.0" を維持
itemOrder は追加しない
既存 JSON への破壊的な rewrite は行わない
```

### Phase 7B-2

`itemOrder` を Schema に追加する場合は次のようにします。

```text
schemaVersion: "1.1"
```

これは **追加のみ**です。

補足: 現行 1.0 Schema は `additionalProperties: false` のため、1.0 のままで `itemOrder` を追加すると **既存 validator でエラーになる**ため、optional 追加ではなく version を上げます。

互換性の方針（Phase 7B-2 の設計案）:

```text
1.1 reader は 1.0 も 1.1 も読める
1.0 のファイルを自動で rewrite しない
itemOrder が無い場合は 6.4 章の compatibility order を計算する
reorder を行った場合のみ保存先を 1.1 に上げる
```

npm package version と Description `schemaVersion` は別管理です。

sample の各画面は Phase 実装状況に合わせて更新します（Phase 7B-1 では規則を変更しません）。

---

## 14. Figma 連携の展望

現時点では Figma API / Plugin 連携は実装しません。

将来 CRUD に組み込む場合も、**既存の field を上書きしない**ことを前提に、独立した field で持つ想定です。

```text
previewSources?: Array<{ kind: "live" | "image" | "figma", ... }>
```

このような **将来の拡張枠**を予約しますが、現時点では `figma: {}` のような field を追加しません（画面設計のみ）。

画面作成（作成 / 複製 / collect / Figma 連携 / 参考画像）はいずれも Description を直接編集せず、API 経由で行います。

---

## 15. 実装 Phase

### Phase 7B-1（本ドキュメント範囲・実装済み）

実装済みの内容:

```text
Description と実装側（Source/snapshot）の union
0 画面での Viewer build 成功
0 画面の empty state
画面設計のみの新規作成 POST
画面設計のみの画面 route
No Preview 表示
画面情報の編集 API 継続動作
implementation-only 画面の Description 新規作成（空 document から PUT で作成）
```

未実装:

```text
項目追加 / 削除 / reorder
画面複製
画面削除
archive
Figma
Reference Image
PC/SP viewport
ORPHAN 判定
MISMATCH 判定
```

### Phase 7B-2（将来）

- `schemaVersion: "1.1"` と `itemOrder`
- Viewer 側の項目追加・削除・複製・削除
- PUT での item 集合変更検証（revision 制御）
- 6.4 章の互換 order と collect merge

### Phase 7B-3（実装先行と設計先行を統合する検討）

- 画面複製（POST + `copyFromScreenId`）
- 画面削除（DELETE + revision）と LINKED 画面への影響
- アーカイブ（archive）等の将来検討事項の切り出し
- 削除時の snapshot 扱いの検討

### Phase 7C

- Reference Image、PC/SP viewport

### Phase 7D

- Figma Frame import

### 未解決事項（継続検討）

実装が無い画面の No Preview 表示は現在の文言のままで良いか、将来 CRUD が増えたときに再検討する。
項目の whole-document PUT 方式は ID 数が増えたときの payload 増加を future Phase で再検討する。
削除の実装が進んだ段階で、項目側の削除方針も合わせて見直す。

---

## 16. 今後の検討事項

1. `plannedPath` / planned route を Schema に含めるかどうかは、7B より後の Phase で判断する
2. implementation-only の画面設計未作成表示に関する UI 詳細
3. LINKED 画面で Description を削除したとき、snapshot の扱いを継続表示するか削除するか
4. archive は 7B-3 の対象に含めるかどうか
5. DELETE を query revision にするか POST command にするか
6. ORPHAN の persisted metadata の項目（`sourceBinding` / `lastCollectedAt` 等）
7. MISMATCH の検出方式（Spec Check）の詳細

---

## 17. 決定済み方針（サマリー）

1. **画面の唯一の真実 = Description ＋ Source**（両方あって初めて完全。status は `design-only` / `implementation-only` / `linked` の3種類）
2. **ORPHAN / MISMATCH / ARCHIVED は本 Phase の対象外**。現時点で ORPHAN 判定は追加しない
3. **表示名の優先順位:** Description.name → Source/collected の名前 → screenId
4. **screenId / itemId は変更不能な stable ID**。変更する仕組みは追加しない
5. **7B-1 は schema 1.0 のまま。** `itemOrder` は 7B-2 で **1.1** に上げる
6. **項目 CRUD は whole-document PUT のみ（7B-2）**
7. **7B-1 の API は GET / PUT / POST（画面作成含む）。** 複製・DELETE は 7B-3
8. **No Preview 表示は文言のみ。** Figma / 参考画像 / ボタンは表示しない
9. **画面設計のみの編集は実装連携を必須にしない**
10. **既存 JSON への破壊的な rewrite は行わない**
11. **実装順: 7B-1 → 7B-2 → 7B-3 → 7C → 7D**

---

## 付録. 実装ファイルの対応（現状のみ記載）

| 機能 | 主な実装ファイル |
|------|----------------|
| union の読込 | `jskim-screen-spec/src/builder/load-screen-spec-project.ts` |
| Manifest | `jskim-screen-spec/src/builder/create-viewer-manifest.ts` |
| Merge | `jskim-screen-spec/src/collector/merge-description.ts` |
| 並び順 | `jskim-screen-spec/src/builder/item-order.ts` |
| Store（読み書き・新規作成） | `jskim-screen-spec/src/editing/file-description-store.ts` |
| API（GET/PUT/POST） | `scripts/lib/create-description-edit-api.js` |
| Watch | `jskim-screen-spec/src/watch/classify-watch-path.ts` |
| Schema | `docs/screen-spec/schema/description-spec.v1.schema.json` |
| Viewer（Sidebar / 画面作成 dialog / No Preview） | `jskim-screen-spec/src/viewer/` |

---

*Phase 7B-1（画面の新規作成・union・No Preview）は実装済みです。version は変更していません。*
