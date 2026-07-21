# Screen Spec 項目グループ階層（Item Group Hierarchy）設計

> **Phase 7F-1A — 設計のみ**
> 本書は Description JSON に **再帰 Item Group** を導入するための契約案です。
> **JSON Schema / validator / collector / API / Viewer / migration / Version Control の実装は含みません。**

関連:

- 現行 Description 契約: [README.md](./README.md) §9
- 収集項目除外: [collected-item-exclusion.md](./collected-item-exclusion.md)
- Feature Group（別概念）: [local-version-control.md](./local-version-control.md) §4
- Excel Export（未実装）: [excel-export.md](./excel-export.md)

---

## 1. 背景と目的

現行 Screen Spec の Description は **平面リスト** です。

```text
itemOrder: [ "product-name", "product-price", ... ]
items: { "<itemId>": { name, type, description, note } }
```

Viewer は `itemOrder` を上から順に項目表へ並べます。大規模画面では「論理領域」「カード」「操作群」など **設計上のまとまり** を表現できません。

本設計は、1 画面（将来は Modal も）の中で次の **論理ツリー** を表現することを目的とします。

```text
Screen
└─ Root Nodes
   ├─ Group
   │  ├─ Group
   │  │  ├─ Group
   │  │  └─ Item
   │  └─ Item
   └─ Item
```

HTML DOM の wrapper や `<section>` の入れ子をそのまま設計階層に **しない** こと。Group は **明示的な設計オブジェクト** です。

---

## 2. 現行実装の調査（read-only）

### 2.1 Description schemaVersion

| version | schema | 永続フィールド |
|---------|--------|----------------|
| `1.0` | `description-spec.v1.schema.json` | `screen`, `items` のみ（`itemOrder` / `excludedItems` なし） |
| `1.1` | `description-spec.v1.1.schema.json` | + `itemOrder: string[]`（`items` キー集合と bijection 必須） |
| `1.2` | `description-spec.v1.2.schema.json` | + `excludedItems`（除外 ID 集合。値は `items` と同形） |

- 読込: `1.0` / `1.1` / `1.2` 対応（`validate-description-document.ts`）
- 新規 POST / Viewer PUT 書き出し: 常に **`1.2`**
- lazy migration: 読込だけでは `1.0`/`1.1` を rewrite しない

### 2.2 item ID と attribute

- ID pattern: `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`（kebab-case、最大 128 文字）
- 実装 attribute: `data-jskim-spec-item="<itemId>"`（[README.md](./README.md) §4）
- `items[<itemId>]` と DOM attribute は **同一 ID** で結ばれる

### 2.3 itemOrder の SoT（現行）

| 経路 | 挙動 |
|------|------|
| Collector merge | 既存 `itemOrder` を維持。新規 collected ID は DOM 出現順で **末尾追加**（`mergeItemOrder`） |
| Viewer 編集 | `moveItemUp` / `moveItemDown` で **配列順のみ** 変更 |
| 除外 / 復元 | exclude → `itemOrder` から除去。restore → **末尾追加** |
| 表示 | `computeEffectiveItemOrder` が bijection を検証。不一致時は collected 順 + key 順で repair |

### 2.4 collected / manual-only / excluded

| 区分 | 判定 | 削除 |
|------|------|------|
| **collected** | 実装 snapshot に `data-jskim-spec-item` が存在 | PUT で **削除拒否**（collect で再出現） |
| **manual-only** | `items` にあるが collected に無い | Viewer から **削除可** |
| **excluded** | `excludedItems` の key | 実装は残る。Collector は items / itemOrder へ **再追加しない** |

Group は現行 schema に **存在しない**。

### 2.5 Screen 状態（DESIGN_ONLY / LINKED 等）

`loadScreenSpecProject` の union status（`design-only` / `implementation-only` / `linked`）は **画面単位** の metadata です。Item Group とは無関係。

### 2.6 Viewer 項目編集（現行）

- 項目表は **フラット `itemOrder` 順**
- 操作: 追加 / 複製 / 上下移動 / manual-only 削除 / collected 除外・復元
- drag-drop 未実装
- Group UI 未実装

### 2.7 Version Control snapshot 境界（現行）

`local-version-control.md` §5.1 より:

- Description / items は logical snapshot **含む**（`screens/{id}/description.json`）
- Feature Group は `features.json` として **別ファイル**
- Item 文字列は HTML 解釈しない（browser-safe 方針と同型）

---

## 3. 用語と命名（Feature Group との区別）

| 日本語 | 推奨 code 名 | スコープ | 現状 |
|--------|--------------|----------|------|
| **Feature Group** | `Feature` / `featureId` | project 全体の **画面分類** | 実装済み（`features.json`） |
| **Item Group** | `ItemGroup` / `groupId` | **1 Screen（将来 Modal）内** の項目階層 | **未実装** |
| **Node 参照** | `SpecNode` / `SpecNodeRef` | Group / Item を tree 上で共通参照 | **未実装** |

文書・コードコメントでは **「Feature Group」と「Item Group（項目グループ）」を混同しない** こと。

---

## 4. コアオブジェクト

### 4.1 Item（項目）

- 画面に表示・操作される **末端** の設計オブジェクト
- **子 node を持てない**（leaf）
- ツリー内で **正確に 1 箇所** のみ存在
- 既存 **`itemId` を維持**（kebab-case 規則は現行どおり）
- collected 項目も manual-only 項目も **同じ Item** 型
- 内容フィールド: 現行 `items[itemId]` と同形（`name` / `type` / `description` / `note`）

### 4.2 Group（項目グループ）

- 論理的な画面領域・項目のまとまり
- 子に **Group または Item** を持てる（再帰）
- **Item ではない**（DOM wrapper でもない）
- 識別子: **`groupId`**（kebab-case。`itemId` と **同一 namespace**）
- metadata: `name`、任意 `description`、**`kind`**（§7）

### 4.3 SpecNodeRef（node 参照）

Group と Item を tree 上で共通表現する参照形式。

```json
{ "type": "group", "id": "contract-section" }
```

```json
{ "type": "item", "id": "product-name" }
```

| field | 型 | 意味 |
|-------|-----|------|
| `type` | `"group"` \| `"item"` | node 種別 |
| `id` | kebab-case string | `groupId` または `itemId` |

**採用理由:** JSON 内で短く、Viewer / API / diff 表示で判別しやすい。`nodeType` 等の別名は **採用しない**（既存 `items` / interaction `type` と文脈が異なるため、path 上で区別する）。

---

## 5. 再帰ツリー契約

### 5.1 構造規則

| 規則 | 内容 |
|------|------|
| root | `rootNodes` に Group と Item を **混在可** |
| Group.children | Group と Item を **混在可** |
| Item | **leaf**。children 禁止 |
| 親の数 | 各 Group / Item は **親を最大 1 つ** |
| Item の位置 | ツリー全体で **1 回だけ** 出現 |
| Group の位置 | ツリー全体で **1 回だけ** 出現 |
| 循環 | **禁止**（祖先 Group を子にできない） |
| 自己参照 | Group の children に **自分自身** を置けない |
| 存在 | 参照先 id は `groups[]` または `items` に **必ず存在** |
| Screen 間 | **node 共有禁止**（別 Screen / Modal へ id 借用不可） |

### 5.2 ID namespace（同一 Screen 内）

**決定: `groupId` と `itemId` は同一 Screen 内で衝突禁止**

```text
∀ id: (groups に groupId=id) XOR (items に itemId=id) — 同時には存在しない
SpecNodeRef.id は、その Screen 内で group または item のどちらか一方を指す
```

**理由:**

1. **node 参照の単純化** — `id` だけで種別を解決できる（`type` と二重チェックは validation で一致を強制）
2. **検索・移動・削除 validation の単純化** — Map 1 本で存在確認できる
3. **Viewer route / 内部参照の曖昧性防止** — 「`product-name` が item か group か」混乱を排除
4. **既存 itemId との衝突** — 新規 `groupId` 作成時、既存 `items` / `excludedItems` の key と衝突したら **error**

`excludedItems` の key も itemId namespace に属するため、**groupId としても使用禁止**。

### 5.3 深さ制限

| 区分 | 値 | 意味 |
|------|-----|------|
| **推奨** | Group **4 段階以内** | UI / 設計レビュー向け guideline（warning 可） |
| **検証最大** | Group **8 段階** | これを超える create / move / load は **validation error** |

**深さの数え方:**

```text
root 直下の Group     → depth 1
その子 Group          → depth 2
…
Item                  → depth 計算に含めない（親 Group の子としてのみ存在）
```

例:

```text
root → section (d1) → card (d2) → fieldset (d3) → item  ✓ 推奨内
root → g1→g2→g3→g4→g5→g6→g7→g8→item                  ✓ 最大許容
root → g1→…→g9→item                                   ✗ error
```

### 5.4 ツリー到達可能性と bijection（不変条件）

v1.3 以降、検証成功時に **常に満たす不変条件** です。いずれか違反は **validation error**（load / save / mutation 前チェック）。

#### 5.4.1 不変条件一覧

| # | 不変条件 |
|---|----------|
| I1 | `groups[]` に定義された **すべての Group** は、`rootNodes` から **正確に 1 回** 到達可能 |
| I2 | **同一 Group** を 2 箇所以上（二重 parent / 二重配置）に置けない |
| I3 | `groups[]` にあり tree から **到達不能** な Group 定義（**orphan definition**）を禁止 |
| I4 | `items` に存在し `excludedItems` に **無い** すべての Item は、tree 上で **正確に 1 回** 参照される |
| I5 | `excludedItems` に存在する Item は tree 上 **一度も** 参照できない |
| I6 | **同一 Item** の duplicate placement 禁止 |
| I7 | `rootNodes` / 各 `children` が参照する node は、`groups[]` または `items` に **定義が存在**（**dangling reference** 禁止） |
| I8 | `items` / `groups[]` に定義があるのに tree から到達不能な **active Item / Group**（orphan definition）禁止 |

**集合関係（v1.2 互換）:**

```text
items の key 集合 ∩ excludedItems の key 集合 = ∅
tree 上の item 参照 id 集合 = items の key 集合（完全一致・1:1）
excludedItems の key は tree に出現しない
groups[].groupId 集合 = tree 上の group 参照 id 集合（完全一致・1:1）
```

#### 5.4.2 エラー種別（3 分類）

| 用語 | 定義 | 例 |
|------|------|-----|
| **dangling reference** | 存在しない定義への参照 | `children` が未知 `groupId` / `itemId` を指す |
| **orphan definition** | 定義はあるが `rootNodes` から到達不能 | `groups[]` にだけ存在しどこからも参照されない Group |
| **duplicate placement** | 同一 node が 2 箇所以上で参照される | 同一 `itemId` が 2 つの `children` に存在 |

**いずれも validation error。** warning にはしない。

#### 5.4.3 到達可能性の定義

```text
1. rootNodes を順に走査し、type=group なら groups[groupId].children へ、type=item なら items へ解決
2. 走査で触れた Group / Item 参照を「配置済み」として記録
3. 走査終了時:
   - groups[] の全 groupId が「配置済み Group」と一致
   - items の全 key（excluded 除く）が「配置済み Item」と一致
   - 「配置済み」参照数 = 各 id の出現回数 = 1
```

循環は走査中に ancestor 集合で検出する（§5.1 循環禁止と同等）。

---

## 6. Group kind（表示・意味 metadata）

Group kind は **レイアウトエンジンではない**。設計意味と Viewer 表現（見出し・アイコン・折りたたみ等）の **metadata** です。子 Item の DOM 配置を自動決定しない。

### 6.1 表記慣例の調査

| 既存 enum 例 | 表記 |
|--------------|------|
| interaction `category` | 小文字単語（`modal`, `tab`, …） |
| merge conflict `kind` | kebab-case（`add-add`, `delete-modify`） |
| viewport | 大文字略語（`PC`, `SP`） |
| Feature | id は kebab-case。kind enum なし |

Item Group kind は **閉じた設計語彙** で diff / Excel / Viewer badge に載るため、**`UPPER_SNAKE_CASE` 文字列** を保存値とする（本設計の採用案）。

### 6.2 kind 一覧

| kind | 意味（日本語） |
|------|----------------|
| `SECTION` | 画面内の大きな論理領域 |
| `FIELDSET` | 関連する入力・表示項目のまとまり |
| `CARD` | 1 つのカード形式の情報領域 |
| `REPEATABLE` | 一覧・カードリストなど **繰り返し構造** を表す論理グループ |
| `ACTIONS` | ボタンや操作項目のまとまり |
| `CONTENT` | 一般的な表示内容のまとまり |
| `CUSTOM` | 上記に該当しない論理グループ |

未知 kind は **validation error**（Writer は既知 kind のみ出力）。

---

## 7. 保存形式

### 7.1 正規化モデル（推奨）

**決定: 正規化 + 参照 tree（A 案）**

ネスト JSON だけにすると Group 再利用・部分更新・merge diff が難しくなるため、`groups` コレクション + `rootNodes` / `children` 参照で保存する。

#### 7.1.1 将来 schema 例（`schemaVersion` 候補: **`1.3`** — 本 phase では未変更）

既存 `items` エントリ形状を維持した例:

```json
{
  "schemaVersion": "1.3",
  "screen": {
    "id": "form-sample",
    "name": "入力フォーム",
    "description": "汎用フォーム画面の設計例です。"
  },
  "rootNodes": [
    { "type": "group", "id": "contract-section" },
    { "type": "item", "id": "page-title" }
  ],
  "groups": [
    {
      "groupId": "contract-section",
      "name": "契約情報",
      "description": "",
      "kind": "SECTION",
      "children": [
        { "type": "group", "id": "contract-card" }
      ]
    },
    {
      "groupId": "contract-card",
      "name": "契約カード",
      "description": "",
      "kind": "CARD",
      "children": [
        { "type": "item", "id": "product-name" },
        { "type": "item", "id": "detail-button" }
      ]
    }
  ],
  "items": {
    "page-title": {
      "name": "ページタイトル",
      "type": "見出し",
      "description": "画面タイトル表示です。",
      "note": ""
    },
    "product-name": {
      "name": "商品名",
      "type": "テキスト入力",
      "description": "商品名入力欄です。",
      "note": ""
    },
    "detail-button": {
      "name": "詳細を見る",
      "type": "ボタン",
      "description": "詳細画面へ進む操作です。",
      "note": ""
    }
  },
  "excludedItems": {}
}
```

`items` の値は現行 `description-spec.v1.2.schema.json` の `itemDescription` と **同一**。

#### 7.1.2 ネストのみ案（参考・不採用）

```json
{
  "tree": {
    "children": [
      {
        "groupId": "contract-section",
        "kind": "SECTION",
        "children": [ { "itemId": "product-name" } ]
      }
    ]
  }
}
```

| 観点 | 正規化（採用） | ネストのみ |
|------|----------------|------------|
| 部分更新 | group 単位で容易 |  subtree 丸ごと差し替えになりやすい |
| merge diff | groupId / itemId 単位 | 深い JSON diff が読みにくい |
| ID 衝突検査 | `groups[]` + `items` で単純 | tree 走査が必要 |
| canonical 順序 | `groupId` ソート可能 | tree 順のみ |

### 7.2 順序の SoT

| 決定 | 内容 |
|------|------|
| **表示順 SoT** | `rootNodes` および各 Group の `children` 配列順 |
| **`groups[]` 配列順** | **semantic ではない** |
| **canonical writer** | 検証成功後、`groups` を **`groupId` 昇順** で並べ替えて書き戻す（Feature `features.json` と同型） |
| **空 Group** | **許可**（children `[]`） |
| **空 root** | **許可**（0 Item 画面は現行どおり。Group のみの画面も可） |

`children` 内の **重複参照禁止**。`rootNodes` も同様。

### 7.3 `excludedItems` との関係

- 除外 Item は **`rootNodes` / いかなる `children` にも出現しない**
- 除外 Item の定義は **`excludedItems[<itemId>]` のみ**（`items` には存在しない — 現行 v1.2 と同型）
- 復元時: **`rootNodes` 末尾** に `{ "type": "item", "id": "..." }` を追加（Group 内へは自動で入れない）

#### 7.3.1 exclude / restore operation（将来）

**Item 除外（`excludeItem`）— tree 更新を含む atomic mutation:**

```text
1. tree から当該 Item の node reference を除去
2. items[itemId] を excludedItems[itemId] へ移動（内容は保持）
3. Group 自体は維持（空 Group 許可）
4. expectedRevision CAS。失敗時ファイル不変
```

**Item 復元（`restoreItem`）:**

```text
1. excludedItems[itemId] を items[itemId] へ戻す
2. rootNodes 末尾に { type: "item", id: itemId } を追加
3. 同一 id が Group / active Item と衝突する場合は拒否
4. v1 では「除外前の tree 位置」metadata は保存しない
```

**将来選択肢（本 scope 外）:** `previousParent` / `previousIndex` 等で復元位置を記録する方式。v1.3 では **採用しない**。

### 7.4 canonical writer 契約（将来）

検証成功後の **永続化書き込み** で適用する規則。読込専用パスでは適用しない（§8.4）。

| 対象 | semantic / canonical |
|------|----------------------|
| **`rootNodes` 配列順** | **semantic**（変更 = tree 順序変更） |
| **各 Group の `children` 配列順** | **semantic** |
| **`groups[]` 配列順** | **non-semantic**。canonical writer は **`groupId` ASCII 昇順** で並べ替え |
| **`items` object key 順** | 現行 canonical 規則を **維持**（実装既存の key ソート方針に従う） |
| **`excludedItems` key 順** | 現行 canonical 規則を **維持** |
| **`SpecNodeRef` field 順** | 固定: `type` → `id` |
| **Group object field 順** | 固定: `groupId` → `name` → `description` → `kind` → `children` |
| **改行** | ファイル末尾 **trailing LF** を維持 |

**semantic change の分離:**

```text
updateGroup（name / description / kind のみ）
  → Group metadata 変更。tree 位置・順序は不変

moveNode / reorderChildren / deleteGroup / createGroup
  → tree structure / order 変更

merge / diff / revision 表示では上記を別カテゴリとして扱う
```

---

## 8. 既存 `itemOrder` との関係

### 8.1 方針（推奨）

| 項目 | 決定 |
|------|------|
| 新 schema | **`itemOrder` を必須フィールドから削除**（`rootNodes` + tree が代替） |
| 旧ファイル読込 | `itemOrder` の各 ID を **`rootNodes` の item 参照に合成**（Group なし） |
| 旧 schema への down-convert | **Group が 1 つも無い場合のみ**可能 — flatten した `itemOrder` を出力 |
| Group あり → v1.2 down-convert | **不可**（error） |
| 自動 Group 生成 | migration では **行わない** |

### 8.2 読込時の合成アルゴリズム（v1.0 / v1.1 / v1.2）

```text
1. items / excludedItems は現行どおり読む
2. itemOrder が bijection なら:
     rootNodes = itemOrder.map(id => ({ type: "item", id }))
     groups = []
3. itemOrder が無い / 壊れている:
     computeEffectiveItemOrder（現行）で並びを決定 → 同上
4. excludedItems の ID は rootNodes に含めない
```

**Viewer 互換:** 合成後の tree を flatten すれば **現行と同じ見た目順** になる。

### 8.3 schemaVersion 候補

| 候補 | 内容 |
|------|------|
| **`1.3`** | `rootNodes` + `groups` 必須。`itemOrder` 削除。**採用候補** |
| `2.0` | 破壊的に見えるため、実際は v1 系列の延長として **`1.3` を推奨** |

**本 phase では schema ファイルを変更しない。**

### 8.4 flat schema 読込と v1.3 永続化の分離

v1.0 / v1.1 / v1.2 ファイルの扱いを **メモリ上の合成** と **ディスク上の migration** で分離する。

| 経路 | 契約 |
|------|------|
| **読込（read）** | `itemOrder`（または repair 後の effective order）から **`rootNodes` の item node をメモリ合成**。`groups = []` |
| **参照・表示・collect merge 計算** | 合成 tree / flat 互換 view を使用。**元ファイルを v1.3 に自動 rewrite しない** |
| **単純 read のみ** | working tree / Description ファイルを **dirty にしない**（Version Control 上も変更なし） |
| **初回 tree mutation** | `expectedRevision` CAS 成功後、**v1.3 形式**（`rootNodes` + `groups` + `schemaVersion: "1.3"`）で **初めて** 永続保存 |
| **明示 migration** | 将来、別 operation / CLI（例: `migrate-description-tree`）で提供 **可能**。read だけでは実行しない |

**Version Control との関係:**

```text
flat v1.2 ファイルの read 合成 → VC 変更なし
初回 Group 作成 / moveNode 等で v1.3 保存 → 通常の semantic 変更として commit 対象
itemOrder 削除・rootNodes 追加は migration commit として diff に現れる（想定どおり）
```

lazy migration（現行 v1.0→1.2 と同型）: **保存操作が起きるまで** on-disk schemaVersion は変えない。

### 8.5 Description mutation lock（SoT）

同一 `spec/{project}/src/data/{screenId}.json` を変更する **すべての mutation**（Group create/update、legacy PUT / create / DELETE、Collector merge-write、将来の exclude/restore）は **`withDescriptionScreenLock`** の単一境界を使う。

```text
key: project + screenId（in-process queue）
filesystem: spec/{project}/.jskim/description-mutation/{screenId}.lock
順序: queue 待機 → lock 取得 → revision 再読込 / CAS → mutation → atomic persist → lock 解放
```

- lock **取得前**の revision は信用しない。取得後に raw bytes SHA-256 を再検証する。
- `writeFileAtomic` replace 失敗時: destination は backup から復元、TEMP / backup は helper 契約どおり削除（部分 JSON 非公開）。
- 異なる screenId は並列可能。同一 screenId は process 内 + 他 process（lock file EEXIST）で直列化。

---

## 9. collected / manual / excluded 契約

| 原則 | 内容 |
|------|------|
| Group と collected | Group は collected / manual の区分 **対象外** |
| Group の自動生成 | HTML DOM から Group を **自動生成しない** |
| `excludedItems` | **現行意味を維持** |
| Item を Group へ移動 | collected なら **collected のまま**。manual-only も **manual-only のまま** |
| Group 削除 | **Item 実体（`items` エントリ）を暗黙削除しない**（§10） |
| Preview Badge | active tree 上の collected Item のみ（除外 Item は tree 外） |

validation 追加（将来）— §5.4 と整合:

```text
tree 上の item 参照 id 集合 = items の key 集合（1:1）
items の key ∩ excludedItems の key = ∅
excludedItems の key は tree に出現しない
collected ⊆ tree 上の active item id
manual-only 削除は tree から除去 + items から削除（現行 manual delete と同型）
```

---

## 10. Group 削除ポリシー

### 10.1 比較

| 方式 | 内容 | 長所 | 短所 |
|------|------|------|------|
| **A. subtree 削除** | Group + 全子 node 削除 | 操作が単純 | collected / manual Item の **誤削除リスク** |
| **B. Group のみ削除（children 昇格）** | Group ノードだけ除去し、children を **親の children** へ挿入（順序維持） | Item データ安全 | 空 Group 削除後に構造が平坦化 |

### 10.2 決定（推奨）

| operation | 既定 UI（将来） | domain 契約 |
|-----------|-----------------|-------------|
| **`deleteGroup`** | 一般削除 | **B: Group のみ削除 + children 昇格** |
| **`deleteGroupSubtree`** | 明示的「グループと配下を削除」 | **A: subtree 全体削除**（確認強） |

**理由:** Group は論理構造であり Item データと分離。誤タップで collected Item を大量削除するリスクを下げる。

subtree 削除時も **`excludedItems` 側のエントリは触らない**（tree 外のため。subtree 削除対象外）。

### 10.3 operation 原子性（将来）

#### `deleteGroup`（children 昇格）

```text
1. 対象 Group の node reference のみ tree から除去
2. 当該 Group の children を、削除された Group が占めていた位置へ同一順序で挿入（昇格）
3. groups[] から当該 groupId 定義を除去
4. subtree 内 Item / 子 Group の **定義**（items / 他 groups）は維持
5. §5.4 不変条件・最大 depth（§5.3）・duplicate を再検証
6. expectedRevision CAS 失敗時、ファイル全体不変
```

#### `deleteGroupSubtree`（明示的全削除）

```text
1. subtree 内に collected Item が 1 つでもあれば operation 全体を拒否（partial 削除禁止）
2. subtree が manual-only Item と Group 定義のみの場合に限り許可
3. 1 回の atomic mutation で:
   - subtree 上の node reference すべて除去
   - 対象 Group 定義（subtree 内 groups[] エントリ）削除
   - manual-only Item 定義（items エントリ）削除
4. excludedItems は tree 外のため対象外（触らない）
5. CAS 失敗時ファイル不変
```

**UI:** subtree 削除は確認ダイアログ必須。collected 保護エラーは日本語メッセージで全体拒否を明示。

---

## 11. 移動・並び替え operation（将来 domain / API）

Feature API（`createFeature`, `moveScreen`, …）と同型の **revision + expectedRevision CAS** を前提とする。

### 11.0 Item Tree HTTP API（7F-1C-3B 実装済み）

dev サーバー（`jskim spec dev`）の route 例:

```text
GET   /_jskim/spec/description-tree/:screenId
POST  /_jskim/spec/description-tree/:screenId/groups
PATCH /_jskim/spec/description-tree/:screenId/groups/:groupId
POST  /_jskim/spec/description-tree/:screenId/nodes/move
POST  /_jskim/spec/description-tree/:screenId/children/reorder
POST  /_jskim/spec/description-tree/:screenId/groups/:groupId/delete
POST  /_jskim/spec/description-tree/:screenId/groups/:groupId/delete-subtree
```

- GET: persisted raw `revision` + `sourceSchemaVersion` + normalized `description`（`schemaVersion: "1.3"` 表現）。**read-only**（lazy migration なし）
- POST/PATCH / action POST: `{ status, revision }` を返す。v1.0–v1.2 への初回 tree mutation 成功時のみ v1.3 へ lazy migration
- Viewer tree UI / Item create-update / exclude-restore / Collector Group annotation は **未実装**
- **Phase 7F-1D-1**: Viewer Item Tree 参照・探索 UI 実装済み（GET `/_jskim/spec/description-tree/:screenId` のみ）。Group 編集 UI は未実装
- legacy flat Description PUT / Collector v1.3 mutation は **従来どおり fail-closed**

**moveNode 例:**

```json
POST /_jskim/spec/description-tree/demo-screen/nodes/move
{
  "expectedRevision": "sha256:…",
  "node": { "type": "item", "id": "product-name" },
  "destinationParentGroupId": "contract-card",
  "insertIndex": 1
}
```

**reorderChildren 例:**

```json
POST /_jskim/spec/description-tree/demo-screen/children/reorder
{
  "expectedRevision": "sha256:…",
  "parentGroupId": null,
  "orderedNodes": [
    { "type": "group", "id": "contract-section" },
    { "type": "item", "id": "page-title" }
  ]
}
```

**deleteGroup / deleteGroupSubtree 例:**

```json
POST /_jskim/spec/description-tree/demo-screen/groups/section/delete
{ "expectedRevision": "sha256:…" }

POST /_jskim/spec/description-tree/demo-screen/groups/section/delete-subtree
{ "expectedRevision": "sha256:…" }
```

**HTTP エラー mapping（domain code → status）:**

| code | HTTP |
|------|-----:|
| `SPEC_DESCRIPTION_NOT_FOUND` / `SPEC_DESCRIPTION_SCREEN_NOT_FOUND` / `SPEC_DESCRIPTION_NODE_NOT_FOUND` / `SPEC_DESCRIPTION_GROUP_NOT_FOUND` / `SPEC_DESCRIPTION_GROUP_PARENT_NOT_FOUND` | 404 |
| `SPEC_DESCRIPTION_INVALID` / `SPEC_DESCRIPTION_REVISION_REQUIRED` / `SPEC_DESCRIPTION_GROUP_INSERT_INDEX_INVALID` / `SPEC_DESCRIPTION_GROUP_DEPTH_EXCEEDED` / `SPEC_DESCRIPTION_REORDER_MISMATCH` | 400 |
| `SPEC_DESCRIPTION_REVISION_CONFLICT` / `SPEC_DESCRIPTION_GROUP_ALREADY_EXISTS` / `SPEC_DESCRIPTION_NODE_ID_CONFLICT` / `SPEC_DESCRIPTION_GROUP_CYCLE` / `SPEC_DESCRIPTION_GROUP_SUBTREE_CONTAINS_COLLECTED_ITEM` / `SPEC_DESCRIPTION_MUTATION_IN_PROGRESS` | 409 |
| `SPEC_DESCRIPTION_COLLECTED_STATE_UNAVAILABLE` / 想定外（`SPEC_DESCRIPTION_INTERNAL` 等） | 500（汎用 message、path/stack 非露出） |

message 文字列による status 判定は行わない。

### 11.1 最小 operation 一覧

| operation | 概要 |
|-----------|------|
| `createGroup` | 新 `groupId`、kind、初期 children（空可）、挿入位置 |
| `updateGroup` | `name` / `description` / `kind` 変更（tree 構造は別 op） |
| `deleteGroup` | §10 B（children 昇格）。UI 上の「グループ解除」も **同一 operation**（独立 `ungroup` API なし） |
| `deleteGroupSubtree` | §10 A（subtree 全体削除。collected Item 含有時は atomic 拒否） |
| `moveNode` | SpecNodeRef を別 parent（または root）へ移動 |
| `reorderChildren` | 同一 parent 内の順序変更 |

Item 固有の `addItem` / `deleteItem` / `excludeItem` / `restoreItem` は **現行を維持**し、tree 更新と **同一 transaction** で行う。

### 11.2 `moveNode` validation

```text
target parent が存在（root または groups[].groupId）
同一 Screen 内
Item 二重配置禁止
Group 循環禁止（移動先が自分の子孫でない）
expectedRevision CAS
Group 移動時: subtree ごと移動（子 node 参照はそのまま）
Item 移動時: items[<id>] 内容は不変、参照位置のみ変更
```

#### 11.2.1 最大 depth（subtree 移動）

**新 parent の depth だけを見てはならない。** 移動対象 subtree 全体を検査する。

```text
1. moved subtree 内の Group について、root からの相対 depth（relative depth）の最大値を計算
2. newParentDepth（root 直下なら 0）+ subtreeMaxRelativeDepth ≤ 8  を満たすこと
3. 超過時は moveNode 全体を拒否。tree とファイルは不変
4. Group 単体 create / deleteGroup 昇格後も同様に再検証
```

例: parent depth=6 の Group へ、内部に depth+2 の subtree を移動 → 合計 8 ✓。depth+3 なら ✗。

### 11.3 Screen 複製（将来・現行 POST copyFromScreenId との接続）

現行（phase 7B-3A）: `POST /_jskim/spec/descriptions` + `copyFromScreenId` は **active `items` / `itemOrder`** と画面説明を複製。`excludedItems`・実装・Preview は複製しない。

v1.3 以降の **推奨契約:**

```text
Screen 複製時は Item Group tree 全体を複製する
  - rootNodes / groups / items / excludedItems の関係を維持
  - 同一 Screen 内の groupId / itemId は複製元と同じ値を使用（別 Screen namespace のため衝突しない）
複製先 Screen は新 screenId を持つ
Reference Image / Device Capture は現行複製ポリシーを変更しない（複製しない）
実装 Source / snapshot は現行どおり複製しない
```

flat v1.2 ソースを複製する場合: 複製先も **flat のまま**（tree mutation 前）。tree 付き v1.3 ソースなら **tree ごと** 複製。

**本 phase では複製 API / store コードを変更しない。**

---

## 12. Screen と Modal の ownership 境界（将来）

**本 schema には Modal フィールドを追加しない。** 拡張可能性のみ記載。

```text
Screen は自 Screen の Item Tree を所有
各 Modal も自 Modal の Item Tree を所有（将来）
Screen tree と Modal tree は別 ownership
node id の Screen ↔ Modal 共有禁止
Screen → Modal への Item 移動は reorder ではなく
  copyItemToModal / transferItemOwnership 等の明示 operation
Modal 実装前でも ItemGroup モデルは Screen 単体で完結
```

共通型 **`ItemTreeDocument`**（`rootNodes` + `groups` + `items` + `excludedItems`）を Screen / Modal で再利用可能、とする。

---

## 13. HTML 収集との境界

**Phase 7F-1A では collector を変更しない。** 以下は **将来 Collector** の契約案。

| 原則 | 内容 |
|------|------|
| DOM 自動階層化 | **禁止** — `<div>` / `<section>` の入れ子を Group に **しない** |
| 既存画面 | annotation 無し → **平面 Item のまま**（`rootNodes` 合成のみ） |
| 将来 annotation | **明示 attribute のみ** が Group 生成候補 |

### 13.1 既存 tree 上 Item の位置維持

| 状況 | 契約 |
|------|------|
| **既に tree に配置済みの collected Item** | **既存 parent と順序を維持**。DOM 出現順だけで再配置しない |
| **新規 discovered collected Item** | 明示 Group annotation **無し** → **`rootNodes` 末尾** に `{ type: "item", id }` を追加 |
| **新規 + 将来 Group annotation あり** | 検証済み Group の `children` 末尾（または annotation 規則で定めた位置）へ追加 **可能** |
| **DOM 順序変更のみ** | ユーザーが編集した Group 配置を **勝手に組み替えない** |
| **一般 DOM wrapper 中 nest** | tree へ **自動反映しない** |

### 13.2 実装から Item が消えた場合（現行政策との整合）

現行 Collector / merge（[README.md](./README.md) §10）:

```text
実装 snapshot から item ID が消えても Description の item 定義を自動削除しない
validation / merge report で orphan warning（SPEC_DESCRIPTION_ITEM_ORPHAN）
status: "missing" を Description JSON に自動記録しない
```

v1.3 tree 導入後も **同政策を維持**:

```text
tree 上の node reference と items 定義は残す（collected か manual-only かは別判定）
collect は tree 構造を壊さない（位置維持 §13.1）
新規削除 policy は本 phase では追加しない
```

将来 annotation 例（属性名は **未確定**）:

```html
<section data-jskim-spec-group="contract-section">
  <div data-jskim-spec-group="contract-card">
    <span data-jskim-spec-item="product-name"></span>
  </div>
</section>
```

Collector は「Group 定義 + 配下 Item ID 収集」を **別 phase** で設計する。

---

## 14. 条件・metadata・継承禁止

将来 Group に `description` / display condition / state metadata を足しても:

```text
Group の条件が子 Item の items[...] へ自動コピーされない
親 metadata の暗黙継承禁止
Viewer は Group 条件を Group 行として明示表示
Item 条件は Item 側にのみ保存
```

**理由:** 暗黙継承は diff・merge・実際の適用条件を不明瞭にする。

---

## 15. Version Control への将来影響

**本 phase では Version Control を変更しない。**

| 対象 | 将来扱い |
|------|----------|
| `groups` / tree order | logical snapshot **含む**（description 一部） |
| Group CRUD / move | semantic diff **対象** |
| Item 内容 vs 位置 | **別 diff カテゴリ**（内容変更 / tree 移動） |
| subtree 移動 | 大量 Item **内容変更** と誤表示しない |
| merge | Group フィールドと tree order を **別 merge** |
| corrupt snapshot | cycle / duplicate node / dangling reference / orphan definition → **fsck error** |

Feature merge（`mergeFeaturesDocument`）と Item tree merge は **独立**。

---

## 16. セキュリティ・公開境界

| 原則 | 内容 |
|------|------|
| Group `name` / `description` | ユーザー入力。Viewer は **text rendering** |
| HTML 保存 | **禁止** |
| `innerHTML` / `v-html` | **禁止** |
| ID / 名前 | path 意味・URL を **埋め込まない** |
| secret | token / fileKey / nodeId / 絶対 path 等を Description に **保存しない** |

Revision API 投影も Item と同様 **browser-safe 文字列** のみ。

---

## 17. 未決定事項と推奨

| 項目 | 状態 | 選択肢 | 推奨 |
|------|------|--------|------|
| schemaVersion 番号 | 未実装 | `1.3` vs `2.0` | **`1.3`**（v1 延長） |
| Group `description` field | 未実装 | 必須空文字 vs optional | **optional。writer は `""` 正規化可** |
| 推奨 depth 超過 | 未実装 | error vs warning | **warning（保存は可）**。depth > 8 は **error** |
| `REPEATABLE` の子制約 | 未実装 | 自由 vs Item のみ推奨 | **validation では自由。Viewer は guideline のみ** |
| drag-drop reorder | 未実装 | UI のみ vs API | **`reorderChildren` API を正本** |
| Modal tree 保存場所 | 未実装 | 別 JSON vs Description 拡張 | **未決定** — Modal phase で `modalId` 所有 tree として **別ファイル** を第一候補 |
| collector Group annotation 名 | 未確定 | `data-jskim-spec-group` 他 | **`data-jskim-spec-group` 案** を第一候補 |
| Excel Export での Group 行 | Phase 7F 設計 | 見出し行 vs インデント列 | [excel-export.md](./excel-export.md) 更新時に **Group 行 + kind 列** を追加 |

---

## 18. 決定表

| 項目 | 決定 |
|------|------|
| Group 再帰 | **支持** |
| Item の子 | **禁止** |
| root の Item | **許可** |
| 空 Group | **許可** |
| 空 root（0 Item） | **許可** |
| 最大 Group 深さ | **8**（検証） |
| 推奨 Group 深さ | **4 以下**（guideline） |
| Group / Item ID 衝突 | **同一 tree 内禁止** |
| Group 順序 SoT | **`rootNodes` / `children`** |
| `groups[]` 順序 | **非 semantic**（canonical: `groupId` 昇順） |
| DOM 自動階層化 | **禁止** |
| 暗黙的条件継承 | **禁止** |
| 既存平面データ互換 | **root Item として読込** |
| Modal tree | **将来同一モデル再利用** |
| Feature Group と Item Group | **別概念** |
| 一般 Group 削除 | **children 昇格** |
| 全 subtree 削除 | **別 operation** |
| 新 schema の `itemOrder` | **削除（`rootNodes` へ）** |
| Node 参照形式 | **`{ type, id }`** |
| Group kind 保存値 | **`UPPER_SNAKE_CASE`** |
| Group orphan definition | **禁止** |
| active Item orphan definition | **禁止** |
| excluded Item の tree 配置 | **禁止** |
| flat schema read 時の自動 rewrite | **禁止** |
| 初回 tree mutation 時の v1.3 保存 | **許可** |
| 新規 unannotated collected Item | **`rootNodes` 末尾** |
| 既存 collected Item の Group 位置 | **維持** |
| exclude 後の復元位置 | **`rootNodes` 末尾** |
| subtree 内 collected Item 削除 | **operation 全体拒否** |
| Screen 複製 | **tree 全体複製**（別 Screen namespace） |
| dangling reference | **validation error** |
| duplicate placement | **validation error** |

---

## 19. 次の実装 phase（参考）

本書は設計のみ。想定される後続（番号は roadmap 草案）:

1. **7F-1B** — `description-spec.v1.3.schema.json` + validator + read 合成
2. **7F-1C** — domain mutation（§11）+ revision
3. **7F-1D** — Viewer tree UI + flatten 互換表示
4. **7F-2x** — collector Group annotation（任意）
5. **7F-x** — Version Control diff / merge 拡張
6. Modal tree — Modal phase 開始時に ownership 設計を確定

---

## 20. 変更履歴

| date | phase | 内容 |
|------|-------|------|
| 2026-07-21 | 7F-1A | 初版（設計のみ） |
| 2026-07-21 | 7F-1A-2 | 到達可能性・read/migration 分離・Collector 配置・exclude/restore・削除原子性・Screen 複製・canonical writer・depth 移動検証を補強 |
| 2026-07-21 | 7F-1C-1 | v1.3 canonical writer・lazy migration・createGroup/updateGroup mutation（domain API のみ）を実装 |
| 2026-07-21 | 7F-1C-1A | Description mutation lock を `withDescriptionScreenLock` へ統合（project + screenId、filesystem lock、lock 後 revision 再検証） |
| 2026-07-21 | 7F-1C-2A | moveNode / reorderChildren domain mutation（CAS + lazy migration + unchanged） |
| 2026-07-21 | 7F-1C-2B | deleteGroup / deleteGroupSubtree domain mutation（children 昇格・subtree 削除・collected 保護） |
| 2026-07-21 | 7F-1C-3A | Item Tree GET / createGroup / updateGroup HTTP API（legacy PUT は v1.3 fail-closed 維持） |
