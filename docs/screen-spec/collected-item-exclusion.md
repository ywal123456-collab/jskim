# 収集項目の設計対象除外方針（Phase 7B-2C-0）

このドキュメントは、Screen Spec で **実装上は存在するが画面設計書の管理対象からは外したい項目** を扱うための調査結果と詳細設計です。

**本 Phase（7B-2C-0）は調査・設計のみです。** Schema / Viewer / API / Collector / production code の実装は含みません。

**保存モデル（実装前精緻化）:** 調査段階では ID 配列と説明 map の二重保管も検討したが、実装前に **keys(excludedItems) を除外 ID 集合とする単一 map** に統一する。

関連:

- 設計先行 CRUD 全体: [design-first-crud.md](./design-first-crud.md)
- companion 概要: [README.md](./README.md)
- Description Schema 1.1: [schema/description-spec.v1.1.schema.json](./schema/description-spec.v1.1.schema.json)

---

## 1. 背景

現在、実装（snapshot DOM）から見つかった `data-jskim-spec-item` は Collector または編集 API 経由で Description の `items` / `itemOrder` に入り、Viewer の項目一覧に表示されます。

Phase 7B-2B では、**現在 collected されている itemId の削除を拒否**しています。削除しても次の collect で placeholder として再追加されるためです。

しかし製品上は「実装を消す」のではなく、次の操作が必要になります。

```text
実装には存在する
画面設計書の通常管理対象からは外す
必要なら後で設計対象へ戻す
```

例:

- レイアウト用 wrapper
- 装飾のみの element
- 設計書に載せる必要のない補助要素
- 重複収集された意味の薄い要素
- 一時的なテスト表示

本ドキュメントは、その **設計対象除外（exclude）と復元（restore）** の保存モデル・Collector・Viewer・PUT 契約を定義します。

---

## 2. 用語

| 用語 | 意味 | 現状 |
|------|------|------|
| **削除（delete）** | Description の **manual-only** 項目を `items` / `itemOrder` から除去する | Phase 7B-2B 実装済み |
| **設計対象除外（exclude）** | 実装項目は存在するが、画面設計書の通常項目としては管理しない | **本設計の対象（未実装）** |
| **除外解除 / 復元（restore）** | 除外した実装項目を再び設計対象へ戻す | **本設計の対象（未実装）** |
| **接続解除（unlink）** | Description 項目と collected 項目の対応関係を切る | 現構造は itemId 同一性のみ。**本設計では扱わない** |
| **ORPHAN** | 過去に実装と繋がっていたが、現在の実装には無い設計項目 | 過去接続の履歴が無いため **現状は判定不可。対象外** |

除外と削除を同じ操作にしない。  
除外と接続解除を同じ機能にしない。  
除外を ORPHAN / MISMATCH として扱わない。

---

## 3. 現行構造（コード調査）

### 3.1 Description Schema 1.1（永続フィールド）

永続 Description JSON（`schemaVersion: "1.1"`）の top-level は次のみです（`additionalProperties: false`）。

```text
$schema? / schemaVersion / screen / itemOrder / items
```

- `itemOrder` と `items` のキー集合は PUT 時に **完全 bijection**
- item フィールド: `name` / `type` / `description` / `note`
- **exclusion / suppression / policy フィールドは無い**

### 3.2 collected ID の取得

`FileDescriptionStore.collectImplementationItemIds(screenId)`  
（`jskim-screen-spec/src/editing/file-description-store.ts`）:

1. `spec/{project}/src/snapshots/{screenId}/*.html` をソート
2. 各 HTML から `extractItemIdsInDomOrder`（`data-jskim-spec-item` の first-seen）
3. 画面横断で first-seen 結合

GET 応答の `collectedItemIds` はこの結果のコピーです。**ファイルには書きません。**

### 3.3 Description への永続化タイミング

| 経路 | ディスクへ書くか | 内容 |
|------|------------------|------|
| IMPLEMENTATION_ONLY **初回 GET**（ファイル無し） | **書かない** | snapshot から draft を合成（`exists: false`） |
| **Collector** `writeCollectedDescription` | 条件付きで書く | `mergeDescription` 後、バイト同一なら `unchanged` skip |
| **PUT** `store.write` | 書く（revision 一致時） | 常に 1.1 + `$schema` |
| **POST create** | 書く | DESIGN_ONLY は空、既知 IMPLEMENTATION_ONLY は placeholder seed |

重要な事実:

```text
collected item は「常に Description ファイルに存在する」わけではない。
IMPLEMENTATION_ONLY の初回 GET では placeholder が合成されるだけである。
成功した collect / 初回 PUT / create（seed）のいずれかで初めて永続化される。
```

### 3.4 Collector write の条件

`jskim-screen-spec/src/collector/write-collected-description.ts`:

1. 既存 Description を読む（無ければ null）
2. `mergeDescription({ existing, screenId, foundItemIds })`
3. 整形 JSON を `writeFileAtomic`
4. 既存バイト列と完全一致 → `status: 'unchanged'`（mtime 維持、実質 no-op）
5. revision conflict → 再読込して最大 3 回再試行。失敗時は上書きしない

`mergeDescription`（`merge-description.ts`）:

- 新規: `schemaVersion: "1.1"`、空 placeholder、`itemOrder = foundItemIds`（DOM 順）
- 既存: 既存テキスト保持。未所持 ID だけ空 entry 追加。orphan は削除しない
- `itemOrder`: `mergeItemOrder` で人手の順序を維持し、**新規 ID のみ末尾追加**
- 1.0 で追加が無い場合は 1.0 のまま（不要な 1.1 rewrite を避ける）

### 3.5 itemOrder merge の位置

新規 collected ID の追記は次で行われる。

```text
mergeDescription
  → mergeItemOrder({ existingOrder, existingItemIds, foundItemIds })
    （jskim-screen-spec/src/builder/item-order.ts）
```

アルゴリズム要約:

1. 既存 `itemOrder`（無ければ既存 keys）を維持
2. order に無い既存 ID を補完
3. 未出現の `foundItemIds` を末尾に追加
4. orphan は落とさない

### 3.6 Viewer / manifest での items と itemOrder

`create-viewer-manifest.ts` + `computeEffectiveItemOrder`:

| status | items の出所 | itemOrder |
|--------|--------------|-----------|
| design-only | Description | Description.itemOrder（無ければ items 挿入順） |
| implementation-only | snapshot placeholder（ビルド成果物） | DOM 順 |
| linked | **Description のみ**（欠落 ID を snapshot から埋めない） | Description.itemOrder を優先し、必要なら collectedOrder で repair |

編集 GET の `toEditableDocument` も `computeEffectiveItemOrder` を使い、表示用に 1.1 相当へ正規化する（読込だけでファイル rewrite はしない）。

### 3.7 PUT validation（現行）

```text
currentCollectedItemIds ⊆ newItemIds
```

- write 直前に snapshot を再読込（GET 時点の集合を信じない）
- 欠落時: `SPEC_DESCRIPTION_COLLECTED_ITEM_DELETE_NOT_ALLOWED`
- 許可: manual-only 削除、新規 ID 追加
- `itemOrder` ↔ `items` bijection 必須

### 3.8 Preview Badge と選択

- `ScreenSpecPage` の `selectedItemId` を DomPreview と ItemDescriptionTable が共有
- Badge 番号 = Viewer/draft の `itemOrder` における 1-based index
- `itemOrder` に無い DOM item は Badge を付けない（番号 0）
- 選択 ID が DOM に無くてもエラーにしない（manual-only / No Preview と同様）

### 3.9 LINKED と「全 collected ID がファイルにあるか」

成功した collect のあと、その回の `foundItemIds` は Description `items` に含まれる（超集合になりうる: orphan / manual）。

ただし次では欠落しうる。

- collect 未実行 / conflict 失敗
- LINKED Viewer は Description に無い collected ID を items へ合成しない

---

## 4. ユースケース

1. レイアウト wrapper が collected されたが設計書に載せたくない → 除外
2. 除外したあと説明を書き直したくなった → 復元
3. 除外した ID が source から消えた → 除外意図をどう残すか
4. 除外した ID が source に戻ってきた → 自動再掲載するか
5. 除外前に `name` / `description` を書いていた → 説明を失わないか
6. 静的 Viewer（read-only）で除外項目を読者に見せるか

---

## 5. 除外と削除の違い

| | 削除（7B-2B） | 設計対象除外（本設計） |
|--|--------------|------------------------|
| 対象 | **現在 collected に無い** manual-only | **現在 collected にある**（またはあった）実装項目 |
| 目的 | Description から項目自体を消す | 実装は残し、設計書の通常管理から外す |
| collect 後 | 同 ID が実装にあれば **再追加される**（正常） | 同 ID が実装にあっても **通常 items へ再追加しない** |
| Preview DOM | もともと無いことが多い | DOM には残りうる |

---

## 6. 除外と接続解除の違い

現構造の「連携」は **itemId の同一性** だけです。明示的な `sourceBinding` はありません。

| | 設計対象除外 | 接続解除（将来） |
|--|--------------|------------------|
| 意味 | この実装 ID を設計対象にしない | ある設計項目とある実装項目の対応を切る |
| 別 ID 同士 | 対象外 | 必要になりうる |
| Figma 等 | provider 非依存の ID 除外として先に置く | provider 付き binding が必要 |

本 Phase では接続解除・手動 rebinding・ORPHAN を実装範囲に含めない。

---

## 7. 保存モデル候補

### 候補 A: `excludedItems` map（キーが除外 ID 集合）

```json
{
  "schemaVersion": "1.2",
  "itemOrder": ["customer-name", "submit-button"],
  "excludedItems": {
    "layout-wrapper": {
      "name": "レイアウト枠",
      "type": "container",
      "description": "設計書には載せない",
      "note": ""
    }
  },
  "items": {
    "customer-name": { "name": "氏名", "type": "input", "description": "", "note": "" },
    "submit-button": { "name": "送信", "type": "button", "description": "", "note": "" }
  }
}
```

| 観点 | 評価 |
|------|------|
| Schema 単純性 | 高い（1 object、キーが ID 集合） |
| JSON diff | 除外は key 追加/削除として読みやすい |
| 手動説明の保全 | **同一 map で保持できる** |
| Collector | keys(excludedItems) で再追加を抑制できる |
| itemOrder bijection | 維持しやすい（除外 ID を items から外す） |
| 拡張 | suppression 意味に近い。binding までは足りない |

### 候補 B: item 内 `excluded: true`

```json
{
  "items": {
    "layout-wrapper": {
      "excluded": true,
      "name": "...",
      "type": "",
      "description": "",
      "note": ""
    }
  }
}
```

| 観点 | 評価 |
|------|------|
| 説明保全 | 容易 |
| itemOrder | 「含めるか」で規則が分岐し、bijection 説明が難しくなる |
| 意味混在 | 通常項目と除外項目が同じ map に同居 |
| Collector | flag を見て skip は可能だが、表示/永続の境界が曖昧 |

### 候補 C: `itemPolicies` オブジェクト

```json
{
  "itemPolicies": {
    "layout-wrapper": { "included": false }
  }
}
```

| 観点 | 評価 |
|------|------|
| 将来拡張 | ignore / archive / binding を載せやすい |
| 現状 | **過設計**。7B-2C の最小要求を超える |

### 比較結論

**推奨は候補 A の単一 `excludedItems` map** とする（旧二重保管案から ID 配列を除いた形。次章）。

理由:

1. 通常の `items` / `itemOrder` bijection を壊さない
2. Collector の「再追加抑制」が keys(excludedItems) 比較で明確
3. 説明を警告なく捨てない（ユーザー資産）
4. ID 集合と説明保管を 1 フィールドに統合できる
5. まだ `itemPolicies` ほどの汎用枠は不要

---

## 8. 推奨データモデル

### 8.1 フィールド名

| JSON | 推奨 | 理由 |
|------|------|------|
| 除外 ID 集合と説明保管 | **`excludedItems`** | keys が除外 ID 集合。値は `items` と同形の最小フィールド |
| 不採用 | `ignoredItemIds` | Collector 自体が無視する印象 |
| 不採用 | `hiddenItemIds` | UI だけの隠匿に見える |
| 不採用 | ID 配列 + 別 map の二重保管 | 同期 invariant が増え、実装前に単一 map へ統一 |
| 許容別名 | `suppressedItems` | 技術的には正確だが UI 語彙とずれる |

### 8.2 UI 日本語（推奨）

| 操作 | 文言 |
|------|------|
| 除外アクション | **設計対象から除外** |
| 除外一覧見出し | **除外した項目** |
| 復元アクション | **設計対象に戻す** |

補助説明例:

```text
実装画面には残りますが、画面設計書の項目一覧からは外します。
```

### 8.3 Schema 構造（推奨）

```json
{
  "$schema": "https://github.com/ywal123456-collab/jskim/raw/main/docs/screen-spec/schema/description-spec.v1.2.schema.json",
  "schemaVersion": "1.2",
  "screen": {
    "id": "inquiry-input",
    "name": "お問い合わせ内容入力",
    "description": ""
  },
  "itemOrder": [
    "customer-name",
    "submit-button"
  ],
  "excludedItems": {
    "layout-wrapper": {
      "name": "レイアウト枠",
      "type": "container",
      "description": "設計書には載せない",
      "note": ""
    }
  },
  "items": {
    "customer-name": {
      "name": "氏名",
      "type": "input",
      "description": "",
      "note": ""
    },
    "submit-button": {
      "name": "送信",
      "type": "button",
      "description": "",
      "note": ""
    }
  }
}
```

意味:

```text
keys(excludedItems)
  = 現在の実装で発見されても、設計項目として自動生成・通常一覧表示しない ID 集合

excludedItems[id]
  = 除外時に退避した手動説明（name/type/description/note）
  = 実装 element の削除ではない
```

除外 ID 集合は **keys(excludedItems) のみ** で表す（空説明でも entry を持つ）。別の ID 配列フィールドは持たない。

---

## 9. Schema version

現行公開 Schema は `1.1` で `additionalProperties: false` のため、**1.1 に field を差し込まない**。

推奨:

```text
schemaVersion: "1.2"
新規 Schema ファイル: description-spec.v1.2.schema.json（実装 Phase で追加）
```

互換:

```text
読込: 1.0 / 1.1 / 1.2
書込（除外機能使用後・保存時）: 1.2
読込だけで 1.0/1.1 を rewrite しない（lazy migration）
```

1.1 → 1.2 の migration タイミング（実装時）:

- ユーザーが除外または復元を含む保存をしたとき
- または 1.2 文書として明示保存したとき

一括 migration command は作らない（既存方針の継続）。

---

## 10. items / itemOrder との関係（invariant）

推奨 invariant:

```text
1. itemOrder ↔ items は完全 bijection（現行どおり）
2. keys(items) ∩ keys(excludedItems) = ∅
```

通常一覧の表示順は引き続き `itemOrder` のみ。  
除外 ID は通常一覧に出さない。除外専用の order フィールドは持たない。Viewer が除外一覧を表示するときは itemId 順などで keys(excludedItems) をソートしてよい。

---

## 11. 説明保持ポリシー

### 候補比較

| 政策 | 内容 | 評価 |
|------|------|------|
| 1. 除外時に説明削除 | 単純、復元時は空 placeholder | **ユーザー説明を警告なしに失う → 不採用** |
| 2. 別保管（`excludedItems`） | 復元時に説明を戻せる | **採用** |
| 3. items に残し表示だけ除外 | 説明は残るが bijection / 意味が混線 | 不採用 |

### 推奨（政策 2）

除外時:

1. 確認 Dialog で「通常一覧から外す」ことを明示
2. 既存の `name` / `type` / `description` / `note` を `excludedItems[id]` へコピー
3. `items` / `itemOrder` から除去
4. `excludedItems[id]` として entry を追加（当該 key が除外 ID 集合に入る）

空欄のみの項目でも `excludedItems[id]` は空文字フィールド付きで残す（キー集合の一貫性）。

復元時に説明があればそれを戻し、無ければ空 placeholder とする。

---

## 12. Collector 動作

除外 ID が `excludedItems` に当該 key があれば、Collector が同じ ID を発見しても:

```text
items に placeholder を追加しない
itemOrder に追加しない
excludedItems は維持する
人手の itemOrder を並べ替えない
```

一方で実装観察自体は続ける。

```text
内部 observation / snapshot / GET.collectedItemIds には現れうる
設計対象（items）には入らない
```

推奨:

- `mergeDescription` が keys(excludedItems) を読んで `addedItemIds` から除外する
- Viewer GET は `collectedItemIds` を返し続け、UI が「実装にはあるが除外中」を示せるようにする

Collector は除外一覧を勝手に削除・並べ替えしない。

---

## 13. 復元ポリシー

### 13.1 現在 collected に存在する ID を復元

```text
excludedItems から当該 key を除去
items へ（保存済み説明があればそれ、無ければ空）を戻す
itemOrder の末尾に追加
dirty → 保存で 1.2 文書として確定
```

末尾追加は「人手の並びを壊さない最小動作」。除外専用 order は持たない。復元直後に上下ボタンで調整可能。

### 13.2 現在 collected に無い ID を復元

推奨（初期）:

```text
警告付きで許可し、manual-only 項目として復元する
```

理由:

- ユーザーが退避した説明を取り戻せる
- source が一時的に無いだけの可能性がある
- 完全禁止すると説明が `excludedItems` に閉じ込められたままになる

UI 警告例:

```text
現在の実装画面ではこの項目が見つかりません。
手動項目として設計対象に戻します。
```

将来 ORPHAN 導入後に「復元せず履歴へ」へ拡張可能。初期は単純化する。

---

## 14. Preview 動作（最小）

初回実装の推奨（過機能を避ける）:

| 項目 | 方針 |
|------|------|
| 除外 ID の DOM | Preview には **そのまま存在しうる** |
| Badge | **通常 Badge を付けない**（`itemOrder` に無いため現行ロジックで自然に非表示） |
| クリック | DOM クリックで ID を select しても、通常表に行が無い → 除外領域へスクロール or 短い案内（任意・後続可） |
| 除外専用 Badge | **初回は作らない** |

これで現行の Badge ↔ 行番号対応を壊さない。

---

## 15. Viewer UI（最小案）

### 15.1 通常項目一覧

- 現行どおり `itemOrder` 順
- collected / linked 行に **「設計対象から除外」**（editable のみ）
- manual-only は従来どおり **削除**（除外ボタンは出さない）

### 15.2 除外確認 Dialog（推奨: 必須）

説明がある場合は損失ではなく退避である旨を書く。

```text
この項目を設計対象から除外しますか？

項目ID: layout-wrapper
項目名: レイアウト枠

実装画面には残ります。
入力済みの名称・説明は除外一覧側に保持され、設計対象に戻すと復元できます。
保存するまでファイルには反映されません。
```

ボタン: `キャンセル` / `設計対象から除外`

### 15.3 除外した項目領域（折りたたみ）

```text
除外した項目（N）
  - itemId
  - 項目名（excludedItems）
  - 現在の実装: あり / なし（GET.collectedItemIds で判定）
  - [設計対象に戻す]
```

- 既定は **折りたたみ**
- filter / search / 高度な表は作らない
- sidebar 画面数には影響しない（画面単位の除外件数は任意表示で足りる）

### 15.4 選択状態

- 除外実行時に当該行が選択中なら、通常一覧の選択復帰規則（次→前→解除）を流用
- 復元後は復元 ID を選択し行へ scroll

---

## 16. PUT validation 変更案

現行:

```text
currentCollectedItemIds ⊆ newItemIds
```

推奨（1.2）:

```text
currentCollectedItemIds ⊆ (newItemIds ∪ keys(newExcludedItems))

keys(items) ∩ keys(excludedItems) = ∅
itemOrder ↔ items bijection
excludedItems の各 key は itemId 規則
```

安全性:

| ケース | 結果 |
|--------|------|
| collected ID を除外へ移す | 許可（∪ 側で充足） |
| collected ID をどちらからも消す | 拒否（現行と同様の保護） |
| manual-only 削除 | 従来どおり許可（collected に無い） |
| 除外 ID を items に残したまま | 拒否（重複禁止） |
| 新規 manual 追加 | 許可 |

エラー code 案（実装時）:

- collected がどちらにも無い: 既存 `SPEC_DESCRIPTION_COLLECTED_ITEM_DELETE_NOT_ALLOWED` を拡張するか、メッセージを「削除も除外一覧にも無い」へ明確化
- excluded / items 重複: `SPEC_DESCRIPTION_INVALID`

GET の `collectedItemIds` は引き続き **権威ではない**。PUT は snapshot 再読込。

---

## 17. revision / race

既存の **document 単位 revision（SHA-256）** をそのまま使う。除外・復元も whole-document PUT。

| race | 推奨挙動 |
|------|----------|
| 除外直前に source から ID 消失 | PUT 時 collected 再読込。除外自体は許可（collected に無くても excluded へ退避可）。通常 items から除去済みなら問題なし |
| 除外直前に ID が別 ID へ変更 | 旧 ID の除外は「もう collected に無い ID の除外」として許可。新 ID は未除外なら従来どおり items 必須 |
| 復元直前に source 消失 | 警告付き manual-only 復元（§13.2） |
| A が除外、B が同項目を編集 | revision conflict（409）。再読込後にやり直し |
| Viewer 除外保存成功後に collect | merge が excluded を尊重し再追加しない |
| Viewer 除外前に collect が items へ追加 | 通常の revision / 内容 merge。除外 PUT が勝つのは revision が新しい側 |

除外専用の新 conflict code は必須ではない。必要ならメッセージで状況を補足する。

---

## 18. read-only Viewer

推奨:

```text
通常項目一覧: 除外済み ID を出さない
除外領域: 既定は非表示（読者向け設計書として自然）
```

デバッグが必要になった将来 Phase で、ビルドオプションや「詳細表示」を検討する。  
初回は **静的 Viewer に除外一覧を載せない** 方が製品として分かりやすい。

editable（`spec dev`）では折りたたみ除外領域を表示する。

---

## 19. Spec Check 拡張（将来・非実装）

除外は **不整合ではない**。

| 状態 | Spec Check 上の扱い（将来案） |
|------|-------------------------------|
| 実装あり + 設計対象 | 正常 |
| 実装あり + 除外 | **正常（除外）**。MISMATCH にしない |
| 実装なし + 設計項目 | 将来 ORPHAN / missing-impl 候補 |
| 実装あり + Description なし | IMPLEMENTATION_ONLY / 未保存 |
| 除外 ID が実装から消失 | stale excluded（警告候補、自動削除はしない） |

今回のモデルは Spec Check を前提にロックしない。

---

## 20. Figma 拡張への影響

現 metadata は provider（DOM / Figma）を区別しない。

推奨:

```text
keys(excludedItems) は「設計対象にしない itemId」の汎用集合とする
source kind を埋め込まない
```

将来 Figma item が増えても:

- 同じ ID 規則なら同じ除外一覧を再利用できる
- provider 別除外が必要になったら `itemPolicies` や binding レイヤを **後続 Phase** で足す

DOM 専用フラグ名（例: provider 別の除外 ID 配列）は避ける。

---

## 21. 実装 Phase

### Phase 7B-2C-1（保存・Collector・PUT・local editing）

```text
Schema 1.2（excludedItems）
読込互換（1.0/1.1/1.2）と lazy write
mergeDescription の再追加抑制
PUT validation 変更
Viewer local: 除外 / 復元（Dialog・draft・dirty）
単体 / store / collector / same-port API テスト
```

### Phase 7B-2C-2（Viewer 表示仕上げ）

```text
除外した項目の折りたたみ領域
「実装: あり/なし」表示
Preview との選択整合の確認
read-only では除外領域非表示
ドキュメント（README 等）更新
sample smoke
```

分割理由: 保存契約と Collector 安全性を先に固め、UI は続けて載せられる。  
同一 checkpoint に押し込む場合でも、**テスト境界は 2C-1 → 2C-2 の順**を推奨する。

### 後続（本機能と混ぜない）

```text
明示的 sourceBinding
別 ID 同士の手動接続
接続解除
ORPHAN / MISMATCH
suppression 以外の policy
drag-and-drop
```

---

## 22. 未決事項

実装 Phase で最終確定してよい項目:

1. 除外確認 Dialog の文言最終版
2. 復元時の `itemOrder` 挿入位置を「末尾」以外にするか（初期は末尾でよい）
3. stale excluded（実装消失）を Viewer でどうラベルするか（初期は「実装: なし」で足りる）
4. PUT エラー code を既存 code の拡張にするか新規にするか
5. 静的 Viewer で将来「除外を注記として出す」需要が出たか

未決のまま実装に進んではいけない項目:

- ~~説明を捨てるか残すか~~ → **残す（決定）**
- ~~1.1 に差し込むか 1.2 か~~ → **1.2（決定）**
- ~~除外と接続解除の同一視~~ → **しない（決定）**

---

## 23. 推奨案（要約）

1. **Schema 1.2** で `excludedItems: Record<itemId, {name,type,description,note}>` を追加する（keys が除外 ID 集合）  
2. 通常の `items` / `itemOrder` bijection は維持し、`keys(items) ∩ keys(excludedItems) = ∅` とする  
3. 除外は削除ではない。Collector は keys(excludedItems) にある ID を items へ再追加しないが、実装観察（collectedItemIds）は続ける  
4. 手動説明は `excludedItems` に退避し、復元時に戻す  
5. 除外後に source から消えても **excludedItems の entry は自動掃除しない**（意図の保持）。再登場しても除外中なら設計対象に戻さない  
6. Preview は初回、通常 Badge 非表示で足りる  
7. Viewer は折りたたみ「除外した項目」＋確認 Dialog。read-only は通常一覧のみ。除外一覧の表示順は itemId ソート等でよい  
8. PUT 契約は `currentCollectedItemIds ⊆ keys(items) ∪ keys(excludedItems)`  
9. API は whole-document PUT のまま。新 endpoint 不要  
10. 実装は **7B-2C-1（契約）→ 7B-2C-2（UI）**。binding / ORPHAN は別 Phase  

---

## 付録 A. JSON 例

### A.1 正常な一般項目のみ（除外なし）

```json
{
  "schemaVersion": "1.2",
  "screen": { "id": "inquiry-input", "name": "入力", "description": "" },
  "itemOrder": ["customer-name", "submit-button"],
  "excludedItems": {},
  "items": {
    "customer-name": {
      "name": "氏名",
      "type": "input",
      "description": "",
      "note": ""
    },
    "submit-button": {
      "name": "送信",
      "type": "button",
      "description": "",
      "note": ""
    }
  }
}
```

（実装時、空の `excludedItems` を省略するか必須にするかは Schema 詳細で決める。推奨は **必須キーとして空 object** とし、読込側は欠落を空とみなす互換を持たせる。）

### A.2 collected 項目を除外した直後（説明あり）

除外前:

```json
{
  "itemOrder": ["layout-wrapper", "customer-name"],
  "items": {
    "layout-wrapper": {
      "name": "レイアウト枠",
      "type": "container",
      "description": "設計書には載せない",
      "note": ""
    },
    "customer-name": {
      "name": "氏名",
      "type": "input",
      "description": "",
      "note": ""
    }
  }
}
```

除外後:

```json
{
  "schemaVersion": "1.2",
  "itemOrder": ["customer-name"],
  "excludedItems": {
    "layout-wrapper": {
      "name": "レイアウト枠",
      "type": "container",
      "description": "設計書には載せない",
      "note": ""
    }
  },
  "items": {
    "customer-name": {
      "name": "氏名",
      "type": "input",
      "description": "",
      "note": ""
    }
  }
}
```

このとき snapshot には `layout-wrapper` が残っていてもよい。  
`GET.collectedItemIds` に含まれていても PUT は `keys(items) ∪ keys(excludedItems)` で充足する。

### A.3 除外項目を復元した直後

```json
{
  "schemaVersion": "1.2",
  "itemOrder": ["customer-name", "layout-wrapper"],
  "excludedItems": {},
  "items": {
    "customer-name": {
      "name": "氏名",
      "type": "input",
      "description": "",
      "note": ""
    },
    "layout-wrapper": {
      "name": "レイアウト枠",
      "type": "container",
      "description": "設計書には載せない",
      "note": ""
    }
  }
}
```

（復元挿入位置は末尾。その後ユーザーが上下で調整可能。）

### A.4 除外後に source から消えた状態

Description:

```json
{
  "itemOrder": ["customer-name"],
  "excludedItems": {
    "layout-wrapper": {
      "name": "レイアウト枠",
      "type": "container",
      "description": "設計書には載せない",
      "note": ""
    }
  },
  "items": {
    "customer-name": {
      "name": "氏名",
      "type": "input",
      "description": "",
      "note": ""
    }
  }
}
```

- `collectedItemIds` に `layout-wrapper` は無い  
- **excluded は自動削除しない**  
- UI は「実装: なし」  
- 後で同じ ID が実装に戻っても、除外中なら設計対象へ自動復帰しない  

### A.5 既存説明を持つ項目の除外（政策確認）

除外操作は `items` からの除去と `excludedItems` へのコピーであり、説明テキストを破棄しない（§11）。

---

## 付録 B. 主要コード位置（現行）

| 関心 | パス |
|------|------|
| Schema 1.1 | `docs/screen-spec/schema/description-spec.v1.1.schema.json` |
| collected ID 抽出 / GET・PUT | `jskim-screen-spec/src/editing/file-description-store.ts` |
| PUT 部分集合検証 | `jskim-screen-spec/src/editing/validate-description-document.ts` |
| collect merge | `jskim-screen-spec/src/collector/merge-description.ts` |
| collect write / unchanged | `jskim-screen-spec/src/collector/write-collected-description.ts` |
| itemOrder merge / effective order | `jskim-screen-spec/src/builder/item-order.ts` |
| Viewer manifest | `jskim-screen-spec/src/builder/create-viewer-manifest.ts` |
| 編集 API GET | `scripts/lib/create-description-edit-api.js` |
| Preview Badge | `jskim-screen-spec/src/viewer/components/DomPreview.vue` |
| 項目表 | `jskim-screen-spec/src/viewer/components/ItemDescriptionTable.vue` |

---

## 付録 C. 主要リスク

1. **説明損失** — 配列だけの除外だと起きやすい → `excludedItems` で回避  
2. **Collector が除外を無視して再追加** — merge の必須変更点  
3. **PUT 契約の緩和しすぎ** — `keys(items) ∪ keys(excludedItems)` のどちらにも無い collected ID は引き続き拒否  
4. **stale excluded の肥大** — 自動削除しない方針のトレードオフ（意図保持を優先）  
5. **LINKED Viewer が Description 欠落 ID を合成しない** — 除外後も「実装にある」表示は `collectedItemIds` 側で行う必要がある  
6. **binding / ORPHAN との混同** — 用語を分け、同じ UI に載せない  

以上。
