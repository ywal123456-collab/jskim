# Screen Spec v1.3 項目編集移行設計

> **Phase 7F-1C-4A — 調査・設計**
> **Phase 7F-1D-2 — Viewer Item 編集 v1.3 接続 実装済み**（本書後半の HTTP / Viewer 契約は実装反映済み。Group 編集 UI は 7F-1D-3）

関連:

- Item Group 階層: [item-group-hierarchy.md](./item-group-hierarchy.md)
- 収集項目除外: [collected-item-exclusion.md](./collected-item-exclusion.md)
- 現行 Description 契約: [README.md](./README.md) §9
- Item Tree GET / Group mutation HTTP（実装済み）: [item-group-hierarchy.md](./item-group-hierarchy.md) §11

---

## 1. 背景

Phase 7F-1D-1 により Viewer は `GET /_jskim/spec/description-tree/:screenId` で **読み取り専用 Item Tree** を表示できます。

一方、Item 編集 UI は **Phase 7F-1D-2** により Description Tree mutation API に接続済みです（legacy 全体 PUT は Viewer 編集経路では使用しません）。

本設計は、tree-aware な **Item 単位 mutation** を定義し、Viewer を legacy PUT から段階的に移行するための契約です。

---

## 2. 現行 Item 編集機能の調査結果

### 2.1 前提

| 条件 | 編集 UI |
|------|---------|
| `jskim spec dev` + bootstrap `__JSKIM_SPEC_EDIT__.enabled` | 有効 |
| `jskim serve` / 静的 Viewer | **無効**（参照のみ） |

編集 state は `useDescriptionEditor`（`jskim-screen-spec/src/viewer/editing/useDescriptionEditor.ts`）が draft を保持します。
保存は **画面単位の legacy PUT 1 回** のみです（Item 単位 PATCH なし）。

### 2.2 機能一覧表

| ユーザー機能 | 現在 UI | 現在 HTTP | 現在 domain/store | v1.3 で動作 |
|---|---|---|---|---|
| Item 名前（name）修正 | `ItemDescriptionTable` インライン入力 → `updateItemField` | legacy **PUT** 全体 | draft `items[id].name` | **不可**（PUT fail-closed） |
| Item type 修正 | 同上 | legacy PUT | draft `items[id].type` | **不可** |
| description 修正 | 同上 | legacy PUT | draft `items[id].description` | **不可** |
| note 修正 | 同上 | legacy PUT | draft `items[id].note` | **不可** |
| 画面名・画面説明修正 | `ScreenSpecPage` 基本情報 | legacy PUT | draft `screen.name` / `screen.description` | **不可**（screen も同一 PUT） |
| manual-only Item 作成 | `CreateItemDialog` → `addItem` | legacy PUT | `itemOrder` 末尾 + `items` 追加 | **不可** |
| manual-only Item 削除 | `DeleteItemDialog` → `removeItem` | legacy PUT | `items` / `itemOrder` から除去 | **不可** |
| collected Item 除外 | `ExcludeItemDialog` → `excludeItem` | legacy PUT | `excludeDescriptionItem()` | **不可** |
| excluded Item 復元 | `ExcludedItemsPanel` → `restoreItem` | legacy PUT | `restoreDescriptionItem()` → `itemOrder` 末尾 | **不可** |
| Item 複製 | `DuplicateItemDialog` → `duplicateItem` | legacy PUT | 新 ID を source 直後に挿入 | **不可** |
| Item 表示順変更（↑/↓） | `ItemDescriptionTable` | legacy PUT | `moveItemUp` / `moveItemDown` | **不可**（v1.3 では `moveNode` / `reorderChildren` が正） |
| Item 選択 | 表行 / Preview / Item Tree | なし（client state） | `selectedItemId` | **可**（読み取り） |
| 編集キャンセル | 「キャンセル」→ `cancel()` | なし | draft を loaded に復元 | **可**（未保存 draft のみ） |
| 保存 | 「保存」→ `save()` | legacy PUT + `expectedRevision` | `file-description-store.write()` | **不可** |
| revision conflict | 409 banner + 「最新内容を読み込む」 | PUT 409 | CAS 不一致 | **不可**（PUT 自体が拒否） |
| Preview ハイライト連動 | `DomPreview` | なし | `selectedItemId` + `itemOrder` | **可** |

**現時点で未提供の機能（存在しないもの）:**

- Item 単位の保存 / 自動保存
- excluded Item の直接削除（復元後に manual delete が必要）
- v1.3 tree 上での Group 編集 UI
- Item Tree からの move / reorder UI

---

## 3. legacy PUT 契約（調査）

### 3.1 保存単位

legacy PUT は **EditableDescriptionDocument 全体** を 1 回で置換します。

**Request body:**

```json
{
  "expectedRevision": "sha256:…",
  "document": {
    "schemaVersion": "1.2",
    "screen": { "id", "name", "description" },
    "itemOrder": ["…"],
    "items": { "…": { "name", "type", "description", "note" } },
    "excludedItems": { "…": { … } }
  }
}
```

| 項目 | 保存 |
|------|------|
| 単位 | **Document 全体**（Item 単位 PATCH なし） |
| `itemOrder` | **はい** — `items` キー集合と bijection 必須 |
| `excludedItems` | **はい** — 全 entry 含む |
| `rootNodes` / `groups` | **いいえ** — v1.3 tree は書き込まない |
| 出力 schema | 常に **`1.2` flat JSON**（lazy upgrade 対象外） |
| `expectedRevision` | body 必須。ファイル bytes の `sha256:` と一致 |
| unchanged 判定 | **なし** — body 全体を検証して上書き |
| collected 検証 | PUT 直前に snapshot から **再収集**（`collectImplementationItemIds`） |

**実装:** `create-description-edit-api.js` → `file-description-store.write()`

### 3.2 v1.3 fail-closed 経路

```text
PUT /_jskim/spec/descriptions/:screenId
  → file-description-store.write()
    → readRawFile() で on-disk schemaVersion を確認
    → assertLegacyDescriptionMutationSupported()
         schemaVersion === "1.3" の場合
         throw DescriptionDocumentError
           code: SPEC_DESCRIPTION_UNSUPPORTED_SCHEMA
           message: 項目グループ（schemaVersion "1.3"）の画面設計書は、現バージョンでは変更できません。
    → storeError(409, …) → HTTP 409
```

**同じ guard が適用される経路:**

- Collector `mergeDescription()` / `writeCollectedDescription()`
- legacy PUT 全体

**fail-closed にならない経路:**

- `/_jskim/spec/description-tree/...` の Group / tree mutation（別 API）
- legacy **GET**（v1.3 → flat projection で返却）

### 3.3 典型 dead-end フロー（コードベース）

```text
1. v1.2 画面を Viewer で開く
   GET /descriptions/:id → flat EditableDocument + revision R1

2. （API または将来 UI で）Group 作成
   POST /description-tree/:id/groups
   → on-disk lazy migration → schemaVersion 1.3, revision R2

3. ユーザーは Item editor で description を修正（draft のみ）

4. 「保存」
   PUT /descriptions/:id
   expectedRevision: R1 または R2

5a. expectedRevision が R1 の場合
    → 409 SPEC_DESCRIPTION_REVISION_CONFLICT（先に revision 不一致）

5b. 最新を読み込み（GET）後に再保存
    expectedRevision: R2, document: flat v1.2 投影
    → on-disk が 1.3 のため
    → 409 SPEC_DESCRIPTION_UNSUPPORTED_SCHEMA（legacy PUT fail-closed）
```

**Viewer の表示（`useDescriptionEditor.save`）:**

- HTTP **409** はすべて `status = 'conflict'`
- banner に API `message` を表示
- 「最新内容を読み込む」「編集中の内容をコピー」ボタン
- `SPEC_DESCRIPTION_UNSUPPORTED_SCHEMA` も **conflict UI** として表示（専用文言なし）

HTTP **400** 等は `status = 'error'`。`SPEC_DESCRIPTION_MANUAL_ITEM_EXCLUDE_NOT_ALLOWED` のみ追加の日本語メッセージあり。

### 3.4 schema 別 Item mutation 契約（実装前に確定）

既存 **Group tree mutation**（`mutateDescriptionTree` / `create-description-tree-api.js`）と **同一パイプライン** を Item mutation に適用します。

#### 3.4.1 schema 別一覧

| 入力 schema（on-disk） | GET Tree | Item mutation | 保存結果 |
|---|---|---|---|
| v1.0 | flat normalize（`computeEffectiveItemOrder`） | **許可** | 変更があれば **canonical v1.3** |
| v1.1 | `itemOrder` normalize | **許可** | 同上 |
| v1.2 | flat normalize | **許可** | 同上 |
| v1.3 | tree-aware | **許可** | **canonical v1.3** |
| 未サポートの将来 schema | fail-closed | **拒否** | 変更なし |

#### 3.4.2 lazy migration 最終契約

```text
新 Item mutation API は v1.0–v1.2 の on-disk document も mutation 入力として受け付ける
load/normalize はメモリ上のみ（GET Tree と同様、単独 read ではファイル rewrite しない）
最初の「実際の変更」を伴う Item mutation で lazy migration し canonical v1.3 として persist する
mutation が unchanged の場合は schema migration も発生させない（on-disk v1.2 のまま）
```

**既存 Group mutation との整合（コード調査）:**

| 経路 | 挙動 |
|------|------|
| GET `description-tree` | v1.0–v1.2 を normalize して返却。**bytes / mtime 不変**（`description-tree-api.test.js`） |
| POST `createGroup` 等 mutation | `loadNormalizedFromFile` → `apply` → `persistNormalizedTree`。**初回 mutation で v1.3 永続化** |
| `apply` が `unchanged` | **`persistNormalizedTree` を呼ばない**。revision 不変・ファイル不変（`updateGroup` テスト） |

Item mutation も **`mutateDescriptionTree` 経由** とし、上記と矛盾しないこと。

#### 3.4.3 legacy PUT の維持範囲

```text
v1.0–v1.2 on-disk: legacy PUT 継続（flat v1.2 として保存）
v1.3 on-disk: legacy PUT fail-closed（SPEC_DESCRIPTION_UNSUPPORTED_SCHEMA）
Collector merge / write: v1.3 fail-closed（現行維持）
```

#### 3.4.4 Viewer 移行後の API 混在禁止（推奨）

Viewer が Item API に接続された Screen では、**legacy PUT と Item tree mutation API を混在させない**。

| 対象 schema | Item 編集経路 |
|-------------|---------------|
| v1.0–v1.2（Item API 接続前） | legacy PUT（現行） |
| v1.0–v1.3（Item API 接続後） | **Item tree mutation API のみ**（metadata / 作成 / 削除 / 除外 / 復元） |
| v1.3 | legacy PUT **使用不可** |

画面名・説明（`screen.*`）は Item API スコープ外。v1.3 では interim read-only または将来 `updateScreen` を別途設計。

---

## 4. v1.3 Item mutation 設計（後続実装対象）

既存 Group / tree mutation と同じ **Description mutation lock + revision CAS + semantic validator + canonical v1.3 persist + atomic write** を適用します。

### 4.1 共通不変条件

| 項目 | 契約 |
|------|------|
| `expectedRevision` | 全 mutation で **必須** |
| lock | `withDescriptionScreenLock`（既存 Group mutation と同一） |
| revision 再検証 | write 前に raw bytes hash を再読込 |
| apply | pure function（入力 doc → 出力 doc、副作用なし） |
| validate | mutation 後 **全体** semantic validator |
| persist | canonical v1.3 JSON（lazy migration 済み tree を維持） |
| ID | kebab-case、`groups[].groupId` / active `items` / `excludedItems` で namespace 衝突禁止 |
| tree | active Item は **正確に 1 箇所**。excluded Item は tree に **0 回** |
| collected 判定 | **server-side のみ**。client から `isCollected` を受け付けない |

### 4.2 共通 mutation 処理順序（Group API と同一）

すべての Item mutation は `mutateDescriptionTree`（または同等の単一 entry）で次の順序を **固定** します。

```text
1. HTTP request validation（method / Content-Type / body size / unknown field / screenId・itemId decode）
2. Description mutation lock（withDescriptionScreenLock）
3. persisted raw bytes から revision 計算（readDescriptionRevision）
4. expectedRevision 比較 → 不一致は REVISION_CONFLICT（この時点で終了）
5. document load + normalize（loadNormalizedFromFile、collectedOrder 注入）
6. deleteItem / excludeItem のみ: collectCollectedItemIdsForScreen（server-side）
   → 失敗時は destructive 処理に進まない
7. pure domain apply（副作用なし）
8. 全体 v1.3 semantic validation（validateMutatedTree）
9. unchanged 判定 → unchanged なら persist せず早期 return
10. canonical v1.3 atomic persist（formatDescriptionDocumentV13 + writeFileAtomic）
11. 新 revision を response に返却（computeContentRevision — client 計算禁止）
12. lock 解放
```

**重要契約:**

```text
stale expectedRevision は collected 判定より先に拒否する（手順 4 が 6 より前）
persist 失敗時は既存 on-disk document を維持する
revision conflict で自動 retry / overwrite しない
unchanged 時は lazy migration も発生しない
```

### 4.3 unchanged / revision 契約

#### Response envelope

mutation 成功時（HTTP 200 または create 時 201）:

```json
{ "status": "updated", "revision": "sha256:…" }
```

または:

```json
{ "status": "unchanged", "revision": "sha256:…" }
```

| 項目 | 契約 |
|------|------|
| `revision` | **persisted file bytes** の `sha256:`。client 計算・推測禁止 |
| unchanged 時 | **ファイル rewrite なし**。`revision` は現行 bytes と一致（= 要求時の valid `expectedRevision`） |
| updated 時 | canonical v1.3 書き込み後の新 hash |

#### Operation 別 unchanged 可否

| Operation | unchanged | 備考 |
|-----------|-----------|------|
| **updateItem** | **可** | 4 フィールドすべて既存値と同一 → `status: unchanged` |
| **createItem** | **不可** | 同一 `itemId` 既存 → `SPEC_DESCRIPTION_NODE_ID_CONFLICT`（unchanged 扱いしない） |
| **deleteItem** | **不可** | 対象なし → `SPEC_DESCRIPTION_NODE_NOT_FOUND` |
| **excludeItem** | **不可** | 対象なし → `NODE_NOT_FOUND`。既に excluded → `NODE_NOT_FOUND` または専用 message（unchanged 扱いしない） |
| **restoreItem** | **不可** | excluded に無い → `NODE_NOT_FOUND` / conflict |

create の HTTP status は既存 Group `createGroup` に合わせ **201**。body の `status` は実際の結果（通常 `updated`）。

---

## 5. Operation 定義

### 5.1 updateItem

**目的:** active Item の metadata のみ更新。

| 変更可 | 変更不可 |
|--------|----------|
| `name`, `type`, `description`, `note` | `itemId`, parent, tree 位置 |

| 項目 | 内容 |
|------|------|
| collected 判定 | **不要**（tree 上 active であれば更新可） |
| tree | 変更しない |
| excluded | 対象外（`items` に存在する ID のみ） |

**PATCH validation（`validate-description-structure.ts` と整合）:**

| 規則 | 契約 |
|------|------|
| 対象 | `items` に存在する active Item のみ。excluded / 存在しない ID → `SPEC_DESCRIPTION_NODE_NOT_FOUND` |
| Group ID を itemId に指定 | `NODE_NOT_FOUND` |
| 許可フィールド | `expectedRevision`, `name`, `type`, `description`, `note` のみ |
| unknown field | `400 SPEC_DESCRIPTION_INVALID` |
| 空 body | `name`/`type`/`description`/`note` が **すべて省略** → `400`（`updateGroup` と同様） |
| 部分更新 | 省略フィールドは **既存値維持** |
| 明示的 `null` | Item 4 フィールドは **すべて string 必須**。`null` → `400`（Group の optional `description: null` とは異なる） |
| 型 | 各 field は string。長さ上限は既存 `description-field-limits` |
| unchanged | 4 フィールドすべて送信値 = 既存値 → `status: unchanged` |

**Domain 関数名（案）:** `updateDescriptionItem`

---

### 5.2 createItem

**目的:** manual-only Item を **定義 + tree 配置を同時** に作成。

**Request 入力（案）:**

```json
{
  "expectedRevision": "sha256:…",
  "itemId": "new-field",
  "name": "",
  "type": "",
  "description": "",
  "note": "",
  "parentGroupId": null,
  "insertIndex": 3
}
```

| フィールド | 意味 |
|------------|------|
| `parentGroupId` | `null` / 省略 → `rootNodes` へ追加 |
| `insertIndex` | 省略 → 対象 children の **末尾** |

**`insertIndex` / `parentGroupId` 契約:**

| 項目 | 契約 |
|------|------|
| `insertIndex` | **0-based 整数**。`0 <= insertIndex <= children.length` |
| 省略 | 対象 children の **tail** |
| 拒否 | 負数 / 小数 / 文字列 / 範囲外 → `400`（`SPEC_DESCRIPTION_ITEM_INSERT_INDEX_INVALID` または `SPEC_DESCRIPTION_INVALID`） |
| `parentGroupId` | `null` または省略 → **root** |
| 文字列 | 存在する **Group** の `groupId` のみ |
| Item ID を parent に指定 | **拒否**（`GROUP_NOT_FOUND` / `INVALID`） |

**禁止:** Item 定義だけ作成し、tree 配置を別 mutation に分離すること（orphan 中間状態禁止）。

| 検証 | |
|------|--|
| `itemId` 形式 | kebab-case |
| ID 衝突 | active / excluded / groupId と衝突 → `SPEC_DESCRIPTION_NODE_ID_CONFLICT`（既存再利用） |
| parent | 存在する Group ID |
| `insertIndex` | `0 … children.length` |

| collected 判定 | **不要** |

**Domain 関数名（案）:** `createDescriptionItem`

---

### 5.3 deleteItem

**目的:** **manual-only** active Item の定義と tree 参照を削除。

| 操作 | |
|------|--|
| tree | node ref 除去 |
| `items` | entry 削除 |
| `excludedItems` | 触らない |

| collected 判定 | **必要** — collected ID は **拒否** |
| 推奨 code | `SPEC_DESCRIPTION_COLLECTED_ITEM_DELETE_NOT_ALLOWED`（legacy PUT と同一意味・再利用） |

manual-only Item を `excludeItem` させない方針と整合（§7）。

**Domain 関数名（案）:** `deleteDescriptionItem`

---

### 5.4 excludeItem

**目的:** **collected** active Item を設計対象から除外。

| 操作 | |
|------|--|
| tree | node ref 除去 |
| `items` | entry 削除 |
| `excludedItems` | 同一 ID で定義を **移動**（field 値保持） |
| 親 Group | 維持（空 Group 可） |

| collected 判定 | **必要** — collected **のみ** 許可 |
| manual-only | **拒否** — `SPEC_DESCRIPTION_MANUAL_ITEM_EXCLUDE_NOT_ALLOWED`（legacy 再利用） |

**Domain 関数名（案）:** `excludeDescriptionItem`（v1.3 tree-aware 版。既存 flat helper とは別 layer）

---

### 5.5 restoreItem

**目的:** excluded Item を active に戻す。

| 操作 | |
|------|--|
| `excludedItems` | entry 削除 |
| `items` | 定義を復元 |
| tree | **`rootNodes` 末尾** に `{ type: "item", id }` を追加 |
| 以前の Group 位置 | **復元しない**（metadata なし） |

| 衝突 | 同一 ID の active Item / Group が存在 → 拒否 |
| 推奨 code | `SPEC_DESCRIPTION_NODE_ID_CONFLICT` または `SPEC_DESCRIPTION_ITEM_RESTORE_CONFLICT`（後者は restore 専用意味が必要な場合のみ新設） |
| snapshot に無い Item | **許可**（active manual 相当。Collector orphan warning は将来検討） |
| collected 判定 | **不要** |

**Domain 関数名（案）:** `restoreDescriptionItem`（v1.3 tree-aware 版）

---

### 5.6 moveNode / reorderChildren（既存・実装済み）

Item の **位置変更** は専用 API を **新設しない**。

| 用途 | Operation |
|------|-----------|
| 親変更 / 別 parent へ移動 | `POST …/nodes/move` |
| 同一 parent 内の並べ替え | `POST …/children/reorder` |

Viewer の ↑/↓ は v1.3 移行後 **reorderChildren**（同一 parent）または **moveNode**（parent 跨ぎが必要な場合は UI 設計で判断）に接続します。

**updateItem / createItem / deleteItem / excludeItem / restoreItem と役割が重複しないこと。**

---

## 6. collected / manual-only 判定

### 6.1 既存実装

| 関数 | 所在 | 用途 |
|------|------|------|
| `collectCollectedItemIdsForScreen` | `collect-collected-item-ids.ts` | snapshot `*.html` の `data-jskim-spec-item` を DOM 順で収集 |
| `extractItemIdsInDomOrder` | `item-order.ts` | HTML パース |
| `collectImplementationItemIds` | `file-description-store.ts` 内 private | legacy GET/PUT（**同一アルゴリズム、import 未共有**） |

**推奨:** v1.3 Item mutation でも **`collectCollectedItemIdsForScreen` を単一 SoT** として再利用し、legacy store との二重実装を解消する（実装フェーズで refactor）。

### 6.2 意味

```text
snapshot に data-jskim-spec-item として存在 → collected Item
active items にあるが collected 集合に無い → manual-only Item
excludedItems にある → 設計対象外（tree 非表示）
```

### 6.3 Operation 別 判定要否

| Operation | collected 判定 |
|-----------|----------------|
| updateItem | 不要 |
| createItem | 不要 |
| moveNode | 不要 |
| reorderChildren | 不要 |
| deleteItem | **必要**（collected → 拒否） |
| excludeItem | **必要**（collected のみ許可） |
| restoreItem | 不要 |

**安全契約:** snapshot 読込不能 → `SPEC_DESCRIPTION_COLLECTED_STATE_UNAVAILABLE`（既存）。**判定不能時に delete / exclude は fail-closed**。

### 6.4 snapshot / collected 判定不能時

| Operation | 判定不能時 |
|-----------|------------|
| updateItem | 判定不要 → **継続可** |
| createItem | 判定不要 → **継続可** |
| moveNode / reorderChildren | 判定不要 → **継続可**（既存） |
| **deleteItem** | **fail-closed** — `500 SPEC_DESCRIPTION_COLLECTED_STATE_UNAVAILABLE` |
| **excludeItem** | **fail-closed** — 同上 |
| restoreItem | 判定不要 → **継続可** |

エラーメッセージは既存 tree mutation と同じ **日本語 sanitized message**。新規 code は不要。

---

## 7. deleteItem と excludeItem の区別（最終決定）

| | deleteItem | excludeItem |
|---|------------|-------------|
| 対象 | **manual-only** のみ | **collected** のみ |
| 定義 | 物理削除 | `excludedItems` へ移動 |
| 実装 DOM | 変更なし | attribute は残る |
| 既存 UI 整合 | 「削除」ボタン（`!isCollected`） | 「設計対象から除外」（`isCollected`） |

**manual-only を exclude させない** — 既存 legacy validation（`SPEC_DESCRIPTION_MANUAL_ITEM_EXCLUDE_NOT_ALLOWED`）と同一。

**excluded を deleteItem させない** — 既存 legacy（`SPEC_DESCRIPTION_EXCLUDED_ITEM_REMOVE_NOT_ALLOWED`）と同一。先に `restoreItem`。

---

## 8. HTTP API 設計

**Phase 7F-1C-4B 実装済み:** `updateItem` / `createItem` domain + HTTP（下記 POST/PATCH items）。**Phase 7F-1C-4C 実装済み:** `deleteItem` / `excludeItem` / `restoreItem` domain + HTTP（下記 POST …/delete|exclude|restore）。**未実装:** Viewer Item editor の tree API 接続（7F-1D-2）。

既存 Tree API prefix に揃えます。

```http
POST  /_jskim/spec/description-tree/:screenId/items
PATCH /_jskim/spec/description-tree/:screenId/items/:itemId
POST  /_jskim/spec/description-tree/:screenId/items/:itemId/delete
POST  /_jskim/spec/description-tree/:screenId/items/:itemId/exclude
POST  /_jskim/spec/description-tree/:screenId/items/:itemId/restore
```

**注:** 破壊的操作も Group API と同様 **POST + 動詞 suffix**（legacy PUT との混同回避）。

### 8.1 成功 Response envelope（Group API と同一）

```json
{
  "status": "updated",
  "revision": "sha256:…"
}
```

または `status: "unchanged"`（§4.3）。

create 成功時は HTTP **201**（Group `createGroup` と一致）。body の `status` は `updated`（`created` という別 enum は使わない — Group API 実装に合わせる）。

### 8.2 HTTP method / status 一覧

| Route | Method | 成功 status | body `status` | 備考 |
|-------|--------|-------------|---------------|------|
| `…/items` | POST | **201** | `updated` | createItem |
| `…/items/:itemId` | PATCH | **200** | `updated` / `unchanged` | updateItem |
| `…/items/:itemId/delete` | POST | **200** | `updated` | deleteItem |
| `…/items/:itemId/exclude` | POST | **200** | `updated` | excludeItem |
| `…/items/:itemId/restore` | POST | **200** | `updated` | restoreItem |

### 8.3 共通 HTTP 契約（既存 Tree API 踏襲）

| 項目 | 契約 |
|------|------|
| `expectedRevision` | 全 mutation body で **必須** |
| `Content-Type` | `application/json` |
| body size | **256 KiB** 上限（`MAX_BODY_BYTES`） |
| same-origin | mutation は cross-origin **403** |
| `screenId` / `itemId` | URL path segment を **1 回だけ** `decodeURIComponent` |
| unknown field | **400** `SPEC_DESCRIPTION_INVALID` |
| 405 | `Allow` header 付き |
| 成功 / エラー JSON | `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` |

**レスポンスに含めない:** 絶対 path、snapshot path、stack / cause、raw document、Figma fileKey / nodeId、token。

### 8.4 Route 別 body / 代表エラー

| Route | Body 主要フィールド | 代表エラー |
|-------|---------------------|------------|
| POST items | `expectedRevision`, `itemId`, `name`, `type`, `description`, `note`, `parentGroupId?`, `insertIndex?` | 400 invalid / index, 409 id conflict |
| PATCH items/:id | `expectedRevision`, `name?`, `type?`, `description?`, `note?` | 404 not found, 409 revision conflict |
| POST …/delete | `expectedRevision` | 404, 409 collected delete forbidden |
| POST …/exclude | `expectedRevision` | 404, 400 manual exclude forbidden, 500 collected unavailable |
| POST …/restore | `expectedRevision` | 404, 409 id conflict |

**Domain error → HTTP** は既存 `mapDescriptionTreeStatus` を拡張（実装フェーズ）。

---

## 9. legacy PUT 拡張 vs Item mutation API（比較）

### 9.1 案 A — legacy PUT を v1.3 対応に拡張

| 長所 | 短所 |
|------|------|
| Viewer save フロー変更が小さい | **Document 全体 mutation** — tree / Group を draft 誤上書きリスク |
| | v1.3 canonical と flat projection の **二重 SoT** |
| | CAS conflict 範囲が画面全体 |
| | Item Tree GET revision と PUT 結果の整合が複雑 |

### 9.2 案 B — Item 別 mutation API へ移行（**推奨**）

| 長所 | 短所 |
|------|------|
| mutation 範囲が明確 | editor save フローの **再設計** が必要 |
| Group / tree 情報を保持 | 画面名変更など **screen フィールド** は別 operation が必要 |
| Group API と revision モデル統一 | 複数 Item 編集後の「一括保存」UX を再定義 |
| 409 の意味が operation 単位で明確 | |

### 9.3 最終推奨: **案 B**

理由:

1. v1.3 の SoT は **tree document** であり、flat PUT は構造的に tree を破壊しやすい
2. Group mutation API が既に **revision CAS + partial mutation** で確立済み
3. Item Tree panel が既に `treeResponse.revision` を保持 — **同一 revision 系統** に乗せやすい
4. legacy PUT を v1.3 対応すると Collector / migration / validator の責務が再肥大化する

**screen.name / screen.description** は Item mutation とは別途 `updateScreen`（将来）または Phase 7F-1C-4B スコープ外として **v1.3 画面では read-only 表示** を interim とする案もあるが、**Item 編集 parity を最優先** とする。

---

## 10. Viewer 移行戦略

### 10.1 推奨順序

```text
1. Item mutation domain（updateItem / createItem）
2. Item mutation HTTP API
3. deleteItem / excludeItem / restoreItem domain + HTTP
4. Viewer Item editor を tree API に接続（7F-1D-2）
5. revision 共有・409 UI・Tree 再 GET
6. v1.3 Item 編集 regression テスト
7. Group 作成・編集 UI 公開（7F-1D-3 以降）
```

### 10.2 Group UI を先に公開した場合のリスク

```text
lazy migration → v1.3
→ legacy Item 保存 dead-end
→ 「Tree は見えるが Item を編集できない」状態
```

**暫定安全策（実装任意・最終目標は非推奨）:**

- v1.3 検知時に legacy「保存」を disabled
- 日本語: 「項目グループ構成の画面では、項目の保存方法が変更されています。次のバージョンで対応予定です。」

**最終目標:** 保存 disabled ではなく **新 Item API への接続**。

### 10.4 Group 作成・編集 UI 公開 gate（必須）

次を **すべて満たすまで** Group 作成・編集 Viewer UI（7F-1D-3）を **公開しない**。

```text
☑ updateItem / createItem domain + HTTP 実装済み（Phase 7F-1C-4B）
☑ deleteItem / excludeItem / restoreItem domain + HTTP 実装済み（Phase 7F-1C-4C）
☑ Viewer Item editor の v1.3 Item API 接続（7F-1D-2）
☑ shared descriptionRevision + mutation / GET race 防御 + 409 conflict UI 検証
☑ v1.2 → v1.3 lazy migration（Item mutation 経由）の regression テスト
☐ Group 作成・編集 Viewer UI（7F-1D-3 — 次 Phase）
```

未達時に Group UI のみ公開すると lazy migration → legacy PUT dead-end が再発する。

### 10.5 保存 UX（案 B 移行後）

| 現行 | 移行後（案） |
|------|--------------|
| draft 全体を 1 PUT | field 変更ごと、または「保存」1 回で **dirty Item ごとに PATCH** |
| `useDescriptionEditor.revision` | **Screen 単位 shared revision**（Tree GET と editor で共有） |
| 保存成功 | `revision` 更新 + **Item Tree GET 再取得**（tree 表示と editor の整合） |
| 409 | 自動上書き禁止。日本語案内 + 「最新を読み込む」 |

**実装フェーズ:** `useDescriptionEditor` と `useDescriptionTreePanel` の revision を `ScreenSpecPage` で統合する composable を検討（本 Phase では変更しない）。

---

## 11. revision state 共有（設計）

| 状態 | 現状 | 移行後 SoT |
|------|------|------------|
| Tree panel | `treeResponse.revision` | 共有 `descriptionRevision` |
| Item editor | `useDescriptionEditor.revision`（legacy GET） | 同上 |
| Group mutation 後 | Tree reload で更新 | editor も reload 必須 |
| Item mutation 後 | （未実装） | mutation response `revision` → shared state → Tree GET |

**409 SPEC_DESCRIPTION_REVISION_CONFLICT:**

- draft の自動マージ **禁止**
- ユーザーに再読込を促す（現行 conflict banner を拡張）

**GET 再取得タイミング:**

- Item / Group mutation **成功直後**（推奨）
- Screen 切替時（既存）

### 11.1 mutation 成功 / 409 後の Viewer 同期（7F-1D-2 実装契約）

**mutation 成功時（同一 Screen）:**

```text
1. response.revision を shared descriptionRevision に反映
2. Item Tree GET を再実行（最新 tree + revision）
3. Description editor データも同一 revision 基準で再取得 / 再構成（legacy GET または tree 投影）
4. draft を clean 状態に同期（Tree のみ更新して editor draft が旧 document のまま、を禁止）
5. response の screenId ≠ 現在 Screen → stale として UI 更新しない（mutation race 防御）
```

**409 SPEC_DESCRIPTION_REVISION_CONFLICT / stale revision:**

```text
自動 overwrite 禁止
ユーザーへ最新内容の再読込を案内（現行 conflict banner 拡張）
draft コピー機能は維持可
再読込時は Tree / editor / shared revision を同一 Screen の snapshot として一括更新
```

Tree GET だけ更新し Item editor が旧 flat draft を保持する状態は **許可しない**。

---

## 12. Screen 切替・mutation race（将来 UI 契約）

Item Tree GET race（Phase 7F-1D-1）とは **別問題**。

| シナリオ | 契約 |
|----------|------|
| 保存中に Screen 切替 | mutation は **切替前 screenId** にのみ適用。応答は現 Screen と不一致なら **破棄** |
| 遅延 mutation 応答 | `activeScreenId` / `mutationSeq` で無視 |
| 成功通知 | 現 Screen のみ toast / banner |
| 409 | 現 Screen の shared revision を stale とみなし再 GET |

---

## 13. エラーコード（推奨一覧）

### 13.1 既存再利用

| Code | 用途 |
|------|------|
| `SPEC_DESCRIPTION_REVISION_REQUIRED` | expectedRevision 欠落 |
| `SPEC_DESCRIPTION_REVISION_CONFLICT` | CAS 不一致 |
| `SPEC_DESCRIPTION_INVALID` | body / field 不正 |
| `SPEC_DESCRIPTION_NOT_FOUND` | Description ファイルなし |
| `SPEC_DESCRIPTION_NODE_NOT_FOUND` | Item ID が active に無い |
| `SPEC_DESCRIPTION_NODE_ID_CONFLICT` | ID 衝突（create / restore） |
| `SPEC_DESCRIPTION_COLLECTED_ITEM_DELETE_NOT_ALLOWED` | collected の deleteItem |
| `SPEC_DESCRIPTION_MANUAL_ITEM_EXCLUDE_NOT_ALLOWED` | manual の excludeItem |
| `SPEC_DESCRIPTION_EXCLUDED_ITEM_REMOVE_NOT_ALLOWED` | excluded への誤 delete |
| `SPEC_DESCRIPTION_COLLECTED_STATE_UNAVAILABLE` | snapshot 判定不能 |
| `SPEC_DESCRIPTION_UNSUPPORTED_SCHEMA` | legacy PUT / Collector（**Item API では使わない**） |

### 13.2 新設が必要な場合のみ

| Code | 用途 |
|------|------|
| `SPEC_DESCRIPTION_ITEM_INSERT_INDEX_INVALID` | createItem insertIndex 範囲外 |

**新設しない候補（既存で足りる）:**

- `SPEC_DESCRIPTION_ITEM_ALREADY_EXISTS` → `NODE_ID_CONFLICT`
- `SPEC_DESCRIPTION_ITEM_NOT_FOUND` → `NODE_NOT_FOUND`
- `SPEC_DESCRIPTION_ITEM_RESTORE_CONFLICT` → `NODE_ID_CONFLICT` + message 差別化で十分なら新設不要

---

## 14. セキュリティ

- Item `name` / `type` / `description` / `note` は **テキスト** として保存・表示（`v-html` / `innerHTML` 禁止 — 現行 Viewer も text binding）
- 任意 HTML 保存を validator で拒否しない（現行 flat と同様）が、**表示側で escape 前提**
- `itemId` を filesystem path として直接使用しない（既存 `descriptionPath(screenId)` は screenId のみ）
- client が `isCollected` / `manualOnly` を指定 **不可**
- エラー応答に absolute path / snapshot path / stack / cause を **含めない**（既存 API hygiene）

---

## 15. 機能 parity 表（移行目標）

| 既存 Viewer 機能 | v1.2 legacy PUT | v1.3 目標 operation | 優先度 |
|---|---|---|---|
| Item metadata 修正 | 全体 PUT | `updateItem` | **必須** |
| manual Item 作成 | 全体 PUT（itemOrder 末尾） | `createItem`（parent + index） | **必須** |
| manual Item 削除 | 全体 PUT | `deleteItem` | **必須** |
| collected Item 除外 | 全体 PUT | `excludeItem` | **必須** |
| excluded Item 復元 | 全体 PUT（itemOrder 末尾） | `restoreItem`（rootNodes 末尾） | **必須** |
| Item 複製 | 全体 PUT | `createItem`（source 直後 insert）+ metadata copy | **必須**（createItem の UX ラッパ） |
| Item 順序変更（↑/↓） | itemOrder swap | `reorderChildren` / `moveNode` | **実装済み API**（Viewer 接続は 7F-1D-4） |
| 画面名・説明 | 全体 PUT | **別途設計**（本書スコープ外） | 後続 |
| 編集キャンセル | client draft | client draft（変更なし） | — |
| revision conflict | PUT CAS | mutation CAS + Tree GET | **必須** |

---

## 16. 後続実装フェーズ（提案）

| Phase | 内容 |
|-------|------|
| **7F-1C-4B** | `updateDescriptionItem` / `createDescriptionItem` domain + HTTP — **実装済み** |
| **7F-1C-4C** | `deleteDescriptionItem` / `excludeDescriptionItem` / `restoreDescriptionItem` domain + HTTP |
| **7F-1D-2** | Viewer Item editor → tree Item API 接続、revision 共有、409 UI — **実装済み** |
| **7F-1D-3** | Group 作成・編集 UI |
| **7F-1D-4** | move / reorder UI |
| **7F-1D-5** | Group 解除・subtree 削除 UI |

**Group 作成 UI（7F-1D-3）は Item 編集 API 接続（7F-1D-2）より後** — v1.3 dead-end 回避。

---

## 17. 調査メモ（file index）

| 領域 | パス |
|------|------|
| Viewer 編集 orchestration | `jskim-screen-spec/src/viewer/pages/ScreenSpecPage.vue` |
| Editor composable | `jskim-screen-spec/src/viewer/editing/useDescriptionEditor.ts` |
| Item 表 UI | `jskim-screen-spec/src/viewer/components/ItemDescriptionTable.vue` |
| legacy HTTP | `scripts/lib/create-description-edit-api.js` |
| Store | `jskim-screen-spec/src/editing/file-description-store.ts` |
| Validation | `jskim-screen-spec/src/editing/validate-description-document.ts` |
| Exclude helpers | `jskim-screen-spec/src/editing/exclude-description-item.ts` |
| v1.3 guard | `jskim-screen-spec/src/editing/description-document/mutation-support.ts` |
| Tree HTTP | `scripts/lib/create-description-tree-api.js` |
| Collected IDs | `jskim-screen-spec/src/editing/collect-collected-item-ids.ts` |

---

## 18. 本 Phase のスコープ外（明示）

- Item mutation domain / HTTP の **実装**
- Viewer editor / save フローの **変更**
- legacy PUT の v1.3 対応
- Collector v1.3 Item 書き込み
- Group 作成・編集 Viewer UI

---

## 19. Phase 7F-1D-2 検証（push 前）

- Viewer Item 編集は Description Tree mutation API のみ（`PUT /_jskim/spec/descriptions/:screenId` は **0 回**）。legacy server / 回帰テストは維持
- 選択 Item 単位 draft / save（`saveItemMetadata` → PATCH 1 item）。未選択行は read-only 入力
- shared revision / 409 conflict / reload-failed 契約は composable + `test/viewer-item-edit-e2e.test.js`（TEMP workspace + `jskim spec dev`）で検証
- Group 作成・編集 Viewer UI は **未公開**（7F-1D-3 gate）

---

*Phase 7F-1C-4A — 2026-07-21（Item API 契約最終補足）*
