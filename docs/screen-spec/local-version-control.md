# Screen Spec ローカル版管理設計（Phase 7E-0〜7E-4B）

> ### 実装済み（domain API）
> - 7E-1: repository / object store / Feature Group
> - 7E-2: working snapshot / index / status / stage（`project.json.screenOrder`、PNG signature、index reachable integrity、HEAD 変更時 stage 拒否）
> - 7E-3: author config、commit / log、branch / annotated tag、revision resolve、checkout materialization、revert、transaction journal、fsck、stale lock recovery
> - **7E-6**: local merge（3-way / fast-forward / already-up-to-date）、`MERGE_STATE`、conflict / `--continue` / `--abort`、`mergeFeaturesDocument` 等 Feature domain merge
>
> lock 順序: **mutation lock → index lock → ref CAS**
> **transaction commit point は ref/HEAD 更新**。old ref → rollback、new ref → forward recovery。それ以外は `SPEC_VERSION_RECOVERY_UNSAFE`。
> 未完了 journal がある間は commit/checkout/revert/stage/branch/tag/author 書き込みを `SPEC_VERSION_RECOVERY_REQUIRED` で拒否する（log/status/fsck/inspect は read-only 継続可）。
> journal path は `operationId`（UUID）のみから導出し、相対 path 文字列を信用しない（containment / symlink 拒否）。
> commit で ref 更新後に index が失敗した場合は journal を残し recovery が new index へ前進する。
> checkout で `source_installed` かつ HEAD が old のときは backup 検証付き rollback。derived cleanup 失敗は `cleanup_pending`（core は new のまま）。
> revert は result commit を先に永続化し、source swap 後の ref 失敗は old source へ rollback する。
> detached HEAD での commit は許可し、HEAD を新 commit へ移動する。
> screenId は ASCII kebab-case のみ（契約 A）。`localeCompare('en')` は決定的。
> checkout は aggregate `resources/manifest.json` と `spec/{project}/dist` を derived として除去し、次の collect/build で再生成する。
> Screen Spec 内部 tag は source Git tag と自動連携しない。
>
> ### 実装済み（Phase 7E-4A CLI）
> - root `jskim spec version`（init / config / status / diff / add / commit / log / branch / tag / checkout / revert / **merge** / fsck / recover）
> - merge: `<revision>` 開始、`--inspect` / `--continue` / `--abort`（相互排他）、conflict 時 exit **3**
> - `--json` envelope、usage=2 / conflict·recovery=3 の exit code 区分
>
> ### 実装済み（Phase 7E-4B Revision API + Viewer）
> - companion `revision-query`（browser-safe projection）
> - `jskim spec dev` same-origin GET API（`/_jskim/spec/version/*`、`/_jskim/spec/features`）
> - Viewer 「改訂履歴」 modal（read-only）。merge commit は **マージ** badge と **親: N**（`parentCount`）表示。mutation は CLI のみ
> - author email / Figma `fileKey` / `nodeId` / token / 絶対 path は API・Viewer に出さない
> - static `spec build` / `jskim serve` では API mount・改訂履歴ボタンなし
>
> ### 未実装
> - Viewer mutation UI、Excel Export、Remote Provider

この文書は、Screen Spec に **Git に似たローカル版管理** と **画面中心データモデル（Feature Group 付き）** を導入するための調査・設計および実装契約である。

| 項目 | 値 |
|------|-----|
| 状態 | domain + CLI + merge + read-only Revision API / Viewer 改訂履歴 実装済み |
| 関連 | [excel-export.md](./excel-export.md)（版管理対応 Export は Phase 7F） |
| 対象 package | companion `@ywal123456/jskim-screen-spec` + root `jskim spec version` / `jskim spec dev` |

---

## 1. 目的

- Screen Spec の基本設計単位を **個別画面（Screen）** に固定する
- 複数画面を任意の **Feature Group** に整理できるようにする（機能は identity を代替しない）
- backend 無しで、working tree / stage / commit / log / branch / tag / checkout / revert を使えるようにする
- Local Viewer から Revision API 経由で改訂履歴を閲覧できるようにする
- 将来の Remote Provider と Central Viewer（push 済みのみ）へ拡張可能な object model を先に固定する

## 2. 背景

### 2.1 既存の手作業 Excel との違い

既存の手作業による画面設計書は、しばしば **機能単位 workbook** に複数の `画面設計` シートを含む。
これは **納品・閲覧の束ね方** であって、JSKim 内部の基本 entity ではない。

| 観点 | 手作業 Excel（参考） | JSKim 内部 |
|------|----------------------|------------|
| 基本 entity | 機能 workbook に見えることが多い | **Screen** |
| 分類 | ファイル分割・シート集合 | **Feature Group**（任意） |
| 履歴 | 改訂履歴シート（手書き） | content-addressed commit |
| Export | 機能単位が自然 | Screen / Feature / Project の 3 scope |

### 2.2 現行実装の制約

- Feature Group に相当する schema / API / Viewer 階層は **未実装**
- Description 編集の `expectedRevision` は楽観ロック用 content hash であり、**履歴ストアではない**
- `dist` は再生成物であり版管理の正本にしない
- Viewer 編集は Description 等への保存まで。Nunjucks / Vue source への attribute 自動挿入は **未実装**

---

## 3. Screen中心のdata model

### 3.1 階層

```text
Project
├─ Feature Group A
│  ├─ Screen …
├─ Feature Group B
│  └─ Screen …
└─ Ungrouped Screens
   └─ Screen …
```

### 3.2 Screen identity（最終）

| フィールド | 意味 | 安定性 |
|------------|------|--------|
| `screenId` | project 内で一意・安定 | **不変**（名前変更・機能移動でも変えない） |
| `screenName` | 表示名（Description `screen.name`） | 可変 |
| `path` | 実装 path（Source `screen.path`、design-only は空） | 可変 |
| Feature 所属 | Feature Group の membership（後述）。画面側に必須ではない | 可変 |
| 画面順 | Feature 内 `screenIds` 順、または Ungrouped 順 | 可変 |
| `status` | `design-only` / `implementation-only` / `linked` | 算出 |

### 3.3 Screen 詳細（版管理対象に含めうる領域）

現行実装に対応する論理内容:

| 領域 | 現行物理 SoT | 備考 |
|------|--------------|------|
| description | `spec/.../src/data/{screenId}.json` | items / itemOrder / excludedItems |
| states / collect / interactions | `src/{project}/pages/**/*.spec.json` | Source |
| implementation link | Source `path` + status 算出 | |
| snapshots | `spec/.../src/snapshots/...` | Preview 正本 |
| resources | `spec/.../src/resources/...` | collector 生成・版管理方針は §11 |
| Reference Images | `spec/.../src/references/{screenId}/{pc\|sp}/` | canonical `meta.json` + PNG（§5.1a） |
| Device Captures | `spec/.../src/captures/{screenId}/{stateId}/{pc\|sp}/` | meta + PNG |
| Figma 公開投影 | Viewer / Revision API / Excel 向け | browser-safe のみ（`fileKey` / `nodeId` は出さない） |

### 3.4 原則

- `screenId` は project 内で安定・一意
- Feature 所属が変わっても `screenId` と画面履歴は維持
- 画面名変更で `screenId` を自動変更しない
- Feature 未所属（Ungrouped）を許可
- **画面削除** と **Feature からの除去** を区別する
- 画面間 interaction は Feature 境界を越えてよい

---

## 4. Feature Group

### 4.1 最終構造（確定）

Canonical membership / 機能内画面順は **`spec/{project}/src/features.json` のみ**。
画面 metadata（Description / Source）に `featureId` を **重複保存しない**。

```json
{
  "schemaVersion": "1.0",
  "features": [
    {
      "featureId": "inquiry",
      "name": "お問い合わせ",
      "description": "お問い合わせ入力から完了まで",
      "displayOrder": 1,
      "screenIds": [
        "inquiry-input",
        "inquiry-confirm",
        "inquiry-complete"
      ]
    }
  ]
}
```

```ts
interface ScreenFeaturesDocument {
  schemaVersion: '1.0';
  features: ScreenFeature[];
}

interface ScreenFeature {
  featureId: string;
  name: string;
  description?: string;
  /** 機能どうしの表示順の唯一の正（後述） */
  displayOrder: number;
  /** 機能内の画面順の唯一の正。各 screenId は高々 1 feature にのみ出現 */
  screenIds: string[];
}
```

### 4.2 順序の正本（確定）

| 対象 | canonical | 非 canonical |
|------|-----------|--------------|
| 機能どうしの順 | **`displayOrder`（project 内で一意）** | `features` 配列の物理順は **正としない** |
| 機能内の画面順 | **`screenIds` 配列順（semantic）** | — |
| Ungrouped 画面順 | 既存 project の画面 canonical 順（`loadScreenSpecProject` と同一規則。実装で固定。既定案は **screenId 昇順**） | `features.json` に Ungrouped 専用配列は持たない |

**採用: B（`displayOrder` が機能順の唯一の正。serialization 時に配列を `displayOrder` → `featureId` で安定ソートして書き戻す）**

| 候補 | 判定 |
|------|------|
| A. 配列順を正とし `displayOrder` 削除 | 不採用 |
| B. `displayOrder` を正とし配列はソート規則で正規化 | **採用** |

理由: 別 branch で異なる機能を追加したとき数値 `displayOrder` の方が merge しやすい。配列順と `displayOrder` を同時に正にしない。
### 4.3 所属モデル比較

| 候補 | 内容 | 判定 |
|------|------|------|
| A. 画面に `featureId` のみ | 機能名・機能内順が弱い | 不採用 |
| B. `features.json` + 各画面 `featureId` | 双方向不整合 | 不採用 |
| C. `features.json` の `screenIds` のみ | membership / 順の単一正本 | **採用** |
| D. 正規化 mapping テーブル | 過剰 | v1 非採用 |

### 4.4 単一所属 / tags / many-to-many

| 候補 | 判定 |
|------|------|
| A. 画面あたり primary feature 最大 1 + Ungrouped 可 | **採用** |
| B. primary + tags 複数 | 後続。v1 schema に入れない |
| C. 完全 many-to-many | **初期除外** |

採用理由: Excel 重複防止、Viewer 木の単純さ、順序定義、revision filter の明確さ、移動時 identity 維持、二重編集防止。

### 4.5 操作意味

| 操作 | 意味 |
|------|------|
| feature 作成 | `features` に追加。画面は自動所属させない |
| feature 名変更 | `name` のみ。`featureId` 不変 |
| feature 順序変更 | **`displayOrder` のみ**更新（配列は正規化書き戻し） |
| screen を feature に追加 | 他 feature から除去して `screenIds` に追加 |
| screen を他 feature へ移動 | 原子的に除去+追加。**`screenId` と screen blob identity は維持** |
| feature 内 reorder | 当該 `screenIds` 配列の並べ替えのみ |
| feature から除去 | `screenIds` から外し Ungrouped。**画面データは削除しない** |
| feature 削除 | feature 行削除。所属画面は **削除せず** Ungrouped |
| screen 削除 | 画面データ削除契約に従い、全 `screenIds` からも除去 |

### 4.6 検証規則（確定）

| 規則 | 違反時 |
|------|--------|
| `displayOrder` は project 内で **重複不可** | `SPEC_FEATURE_ORDER_CONFLICT` |
| `displayOrder` は **有限の整数**（推奨: 1 以上、上限例 1_000_000）。小数・NaN・非数は不可 | `SPEC_FEATURE_INVALID` |
| 同一 `screenId` が複数 feature の `screenIds` に出現 | `SPEC_FEATURE_DUPLICATE_MEMBERSHIP` |
| 存在しない `screenId` 参照 | `SPEC_FEATURE_INVALID`（save / commit 時） |
| `features.json` に無い画面 | **Ungrouped**（エラーではない） |
| `features.json` 不在 | 全画面 Ungrouped（後方互換） |

serialization: 検証成功後に `features` 配列を `displayOrder` 昇順 → `featureId` 昇順で並べ替えて書き戻す。
**重複 `displayOrder` を自動採番で黙って解消しない**（衝突は error）。

---

## 5. 現行実装の調査

### 5.1 保存構造と version 対象（確定 matrix）

| 分類 | 現行パス例 | version 対象 | 原則 |
|------|------------|--------------|------|
| Screen identity / metadata | Description `screen.*` + Source `screen.*` | **含む** | 画面設計の正本 |
| Description / items | `spec/.../src/data/{screenId}.json` | **含む** | 人編集の設計データ |
| State / interaction / collect 手順 | `src/{project}/pages/**/*.spec.json` | **含む**（logical に `screens/{id}/source.json` へ正規化コピー） | Screen Spec の機械向け正本。**実装テンプレート全体の代替ではない** |
| Feature Group | `spec/.../src/features.json` | **含む** | membership / order 正本 |
| Reference Image（canonical） | `spec/.../src/references/.../meta.json` + PNG | **含む** | §5.1a。Reimport 復元のため canonical meta を保存 |
| Device Capture | `spec/.../src/captures/...` | **含む** | content-addressed binary + meta |
| implementation snapshot | `spec/.../src/snapshots/...` | **含む** | Preview 再現の正本 |
| collector resources | `spec/.../src/resources/...` | **含む**（hash ファイル + manifest） | Spec 再現の一部 |
| Nunjucks / Vue 等の実装ソース | `src/{project}/**/*.{njk,vue,html,...}` | **除外** | implementation Git の責任 |
| dist / Viewer bundle | `spec/.../dist/**` | **除外** | 再生成 output |
| cache / temp / lock / runtime | `.tmp`、in-progress 等 | **除外** | runtime |
| PAT / token / signed URL / 絶対パス | 環境変数・一時 export URL・OS path | **除外** | secret・移植性（`fileKey`/`nodeId` とは別分類） |

境界の明示:

- Screen Spec repository は **implementation source repository を代替しない**
- Nunjucks / Vue ファイル全体を blob へ複製しない
- custom attribute で結ばれた identity と、Screen Spec 側に蓄積された収集・設計結果だけを tree に記録する
- 過去 revision の checkout は **Spec working tree** に限る。implementation source の自動 checkout は行わない

### 5.1a Reference / Figma metadata と露出境界（確定）

現行実装（`reference-image/types.ts` / `validate-metadata.ts` / `browser-safe-source.ts` / `figma-frame-import.md`）に基づく。

#### Canonical server-side `meta.json`（working tree 正本）

`source.type === 'figma'` のとき必須フィールド例:

| field | 役割 |
|-------|------|
| `type` | `'figma'` |
| `fileKey` | Reimport 用ファイル識別（**credential ではない**） |
| `nodeId` | Reimport 用 Frame 識別（正規化済み。**credential ではない**） |
| `frameName` | 表示・監査 |
| `importedAt` | ISO 日時 |
| `exportScale` | 現行固定 `1` |

`source.type === 'upload'` は `{ type: 'upload' }` のみ。
その他の Reference meta（`imageRevision`、寸法、`imageFile` 等）も canonical として version 対象。

#### version object に含める / 含めない

| 含める | 含めない |
|--------|----------|
| 上記 canonical meta 全体（`fileKey` / `nodeId` 含む） | Figma PAT / `JSKIM_FIGMA_TOKEN` 値 |
| Reference PNG bytes | `X-Figma-Token` / `Authorization` |
| | 一時 signed download URL / export URL |
| | request header、ユーザー credential、絶対パス |

#### browser-safe 投影（現行 `BrowserSafeReferenceSource`）

| 含む | 含まない |
|------|----------|
| `type: 'upload'` | `fileKey` |
| `type: 'figma'` + `frameName` + `importedAt` | `nodeId` / `exportScale`（Viewer 非公開） |
| | token / signed URL |

#### 層ごとの露出（確定）

| 層 | 契約 |
|----|------|
| **Local object store** | canonical server-side metadata を **そのまま** content-addressed 保存。checkout / Reimport 復元可能 |
| **Remote Provider** | 同一 object を **hash 変更なく**転送。push 時に `fileKey`/`nodeId` を削って別 commit を作らない。token / signed URL は元々 object に無い。会社方針で平文保存不可なら **provider-level 暗号化 / ストレージ暗号化**で対応し、**core は metadata を勝手に redaction しない** |
| **Revision API / Local Viewer / Central Viewer** | **browser-safe 投影のみ**返す。`fileKey` / `nodeId` 非露出 |
| **Excel Export** | browser-safe のみ（`frameName` / `importedAt`）。`fileKey` / `nodeId` / token / signed URL 非出力 |

#### checkout 後の復元

```text
過去 revision を checkout
→ 当該 revision の Reference PNG と canonical meta を working tree へ復元
→ source が figma なら、既存 Reimport API と同じく server が meta の fileKey/nodeId を読んで再 export 可能
→ Viewer / Revision API 応答は従来どおり browser-safe のみ
→ upload source または meta 欠落はその状態をそのまま復元
```

- checkout は画面単位で **PNG と meta を同一 revision から対で復元**する
- 現 working tree の新しい Figma source metadata と、過去 revision の画像を **混ぜない**
- Reimport 実行時の PAT は従来どおり **runtime 環境変数**から注入（object / config に保存しない）

### 5.2 Feature 相当の既存語彙

- Source `interactions[].category`（modal/tab/…）は **画面グループではない**
- sample ドキュメント上の「画面グループ」は UX 説明のみで schema ではない
- `featureId` / `screenGroup` 等は **未実装**

### 5.3 custom attribute

| 機能 | 状態 |
|------|------|
| `data-jskim-spec-*` 収集と Description 突合 | **実装済み** |
| Viewer 編集 → Description 保存 | **実装済み**（`jskim spec dev`） |
| Viewer 編集 → Nunjucks/Vue へ attribute 自動挿入 | **未実装**（本設計でも非目標） |
| production HTML から attribute 除去 | **実装済み** |

### 5.4 Reference / Capture atomic（再利用）

再利用する原則:

- content hash（`sha256:<hex>`）
- TEMP → publish → `meta.json` atomic commit
- `expected*Revision` 楽観ロック
- 中断時は既存 meta を残す
- browser-safe に秘密を載せない

版管理で新たに必要な原則:

- PNG bytes を object store の **blob** として dedupe
- commit tree は logical path → blob hash
- working tree の物理 path と logical tree を分離可能にする
- Reference の **canonical meta**（Figma 時は `fileKey`/`nodeId` 含む）を blob 化し、checkout で対復元する（§5.1a）

画像上限（現行）: Reference **20 MiB**。Capture は Playwright PNG（専用 20 MiB 定数は無し、寸法上限あり）。

### 5.5 Viewer / API / runtime

| 項目 | 現状 |
|------|------|
| 編集 API | `jskim spec dev` のみ `/_jskim/spec/*` |
| Description | `scripts/lib/create-description-edit-api.js` |
| Reference | `scripts/lib/create-reference-image-api.js` |
| Capture | `scripts/lib/create-device-capture-api.js` |
| serve / 通常 dev / 静的 `/spec/` | 編集 API なし（read-only） |
| Revision API / 改訂履歴 modal | **実装済み**（`create-version-history-api.js`、`jskim spec dev` のみ。static/serve は非 mount） |

将来接続点:

- API: 新規 `scripts/lib/create-version-*-api.js` を `create-spec-dev-runtime.js` に登録
- domain: `jskim-screen-spec/src/version/`（新設）
- UI: `ScreenSpecPage.vue` / Dialog 群 / SpecHeader

### 5.6 CLI

現行 `parseSpecArgv`: `build` / `collect` / `dev` のみ。`export` / `version` / `feature` は **未実装**。

---

## 6. Source of Truth

版管理の snapshot 入力は次を正とする。

1. working tree の Screen Spec SoT（§5.1 の「含む」行）
2. 明示 revision 指定時は **その commit の tree**

**使わない:** `dist/**`、secret、絶対パス、runtime、Nunjucks/Vue 実装ソース全体。

Export・改訂履歴も同じ正本規則に従う（[excel-export.md](./excel-export.md)）。

---

## 7. 保存方式の比較

| 候補 | 概要 | 判定 |
|------|------|------|
| A. 利用者の project Git をそのまま使う | branch/history が source と混線。filter・binary 方針が困難 | **不採用** |
| B. Screen Spec 専用 nested Git | Git CLI / ネスト repo の運用負荷。Windows・テスト・Remote 抽象が重い | **不採用** |
| C. JSKim 専用 content-addressed object store | 要件（stage/filter/Remote Provider）に直結。Node で完結 | **採用** |
| D. 単純 revision 配列 / autosave 履歴 | Git 類似操作・branch/merge/Remote に耐えない | **不採用** |

採用理由（C）:

- 利用者 source Git と衝突しない
- screen / feature filter を commit metadata / tree walk で実装しやすい
- Reference/Capture の content hash と整合
- Remote Provider は object + ref CAS を転送すればよい
- テストは in-memory / 一時 directory で可能
- 「Git に見せるためだけに Git を呼ぶ」「必ず自前」の教条を避け、要件適合で選択

---

## 8. 推奨architecture

```text
[Working tree: spec/{project}/src + Source *.spec.json]
        │ status/diff/add
        ▼
[Index / stage]
        │ commit
        ▼
[Object store: blob / tree / commit]  ← content-addressed
        │
   refs/heads, refs/tags, HEAD
        │
   Local Viewer ← Revision API（spec dev）
        │（将来）
   Remote Provider ←→ Central Viewer（push 済みのみ）
```

単位の整理:

| 単位 | 役割 |
|------|------|
| Screen | 設計・編集 |
| Feature Group | 分類・照会・Excel Feature Export |
| stage 選択 | Screen / Feature / Project |
| commit snapshot | **常に Project tree**（部分 commit でも tree は project 全体の合成） |
| history filter | Project / Feature / Screen |
| Excel | Screen / Feature / Project |

画面ごとに別 repository は作らない。

---

## 9. Repository layout

物理配置（project 隔離・確定）:

```text
spec/{project}/.jskim/version/
  format
  HEAD
  index
  config.json     # user.name / user.email のみ。secret 禁止
  objects/aa/bb/<rest>
  refs/heads/
  refs/tags/
  locks/
  journal/
```

| 決定 | 内容 |
|------|------|
| 位置 | `spec/{project}/.jskim/version/` |
| history の正本 | **この local repository 自体**（利用者 project Git に object を二重 commit しない） |
| 利用者 Git | 既定で **追跡しない** |
| gitignore 契約 | 実装 Phase **7E-1** で `spec/*/.jskim/version/` を root / create-jskim template の `.gitignore` に追加する。**本 Phase（文書）では `.gitignore` を変更しない** |
| 削除 | local repo 削除 = **未 push の local history も削除**。保護は backup / Export / Remote push |
| コピー | project ごとコピーすると history も含む。含めずコピーしたい場合は後続 **backup/export command**（未設計詳細・調査項目）で選択可能にする |
| 絶対パス | object / commit / config に書かない |

`format` に repository format version を置く。

---

## 10. Object format

### 10.1 共通

| 項目 | 契約 |
|------|------|
| hash | **SHA-256**（Reference Image の `sha256:<hex>` と同一系統） |
| 表示 | API は short（先頭 12 hex）と full を併記可。内部は full |
| 保存 | `objects/{hash[0:2]}/{hash[2:4]}/{hash[4:]}` に raw bytes |
| 型分離 | ヘッダ `jskim <type> <byteLength>\0` + payload（Git 類似）。type = `blob`\|`tree`\|`commit`\|`tag` |
| unknown field | commit/tag の JSON payload は未知キー無視（前方互換）。必須欠落は error |

### 10.2 blob

- payload = ファイル生バイト（PNG / JSON テキスト等）
- JSON blob も **canonical bytes** を保存（再 pretty-print で hash を変えない）

### 10.3 tree

Canonical テキスト（LF、UTF-8、NFC 推奨）:

```text
<mode> <type> <hash> <path>\n
```

- path は logical relative（`/` 区切り、`.` / `..` 禁止）
- エントリは path のバイト順ソート
- mode: `100644` file / `040000` tree（必要なら拡張）

### 10.4 commit

JSON payload（key 順固定、indent なし、LF 終端）例:

```json
{
  "formatVersion": 1,
  "tree": "<sha256 hex>",
  "parents": ["<sha256 hex>"],
  "author": { "name": "...", "email": "", "when": "2026-07-20T01:23:45.000Z" },
  "committer": { "name": "...", "email": "", "when": "2026-07-20T01:23:45.000Z" },
  "message": "..."
}
```

| 項目 | 決定 |
|------|------|
| timestamp | UTC ISO-8601。**hash 入力に含める** |
| author | §10.6 の identity 契約 |
| empty commit | 既定拒否（init も自動では作らない） |
| 同一 tree | 許可（メッセージ・時刻が異なれば別 commit） |
| message | 必須・非空・最大長（例: 2 KiB）。制御文字制限 |
| parents | `string[]`。0 個（初回）、1 個（通常）、2 個以上（merge）。**object は最初から許容** |
| 変更要約の永続 | 必須としない。log/filter は parent tree diff |

### 10.5 tag

| 項目 | 契約 |
|------|------|
| object / ref 形式 | **7E-1** から annotated tag object を阻まない（`tag` type + `refs/tags/<name>`） |
| CLI / 作成・照会 | **7E-3** |
| 既定 | **annotated tag**（name、target commit、message、tagger） |
| 上書き / 移動 / `--force` | **初期範囲で禁止・除外** |
| 名前空間 | Screen Spec 内部 tag と **利用者 project の Git tag は別物**。同名でも自動連携しない（例: source Git `v0.7.0` ≠ Spec `review-2026-07-20`） |

### 10.6 author identity（確定）

設定ファイル: `spec/{project}/.jskim/version/config.json`

```json
{
  "user": {
    "name": "例: 設計担当",
    "email": "optional@example.com"
  }
}
```

- `token` / `password` / PAT 等は **保存禁止**
- 利用者の **global Git config は自動継承しない**（予測可能性のため。継承は将来も既定にしない）

環境変数（CI / non-interactive）:

- `JSKIM_SPEC_AUTHOR_NAME`
- `JSKIM_SPEC_AUTHOR_EMAIL`

precedence（確定）:

1. コマンド別明示 option（将来）
2. 環境変数
3. repository-local `config.json`
4. 解決不能なら **`SPEC_VERSION_AUTHOR_REQUIRED`**（黙って `local` に落とさない）

### 10.7 JSON canonical 規則（blob 化前）

| 規則 | 内容 |
|------|------|
| key order | UTF-8 コードポイント昇順の再帰ソート |
| newline | LF のみ |
| Unicode | NFC |
| number | JSON 標準（整数は指数表記しない） |
| null | 保存する。`undefined` はキー省略 |
| array order | 意味順を維持（並び替えない）。ただし `features` 配列は §4.2 のソート規則で正規化してから blob 化する |
| timestamp in data files | 既存 meta の時刻文字列をそのまま（正規化は別契約） |

---

## 11. Logical tree

commit が指す logical tree（例）:

```text
project.json                 # { schemaVersion, projectName, screenOrder[] }
features.json                # ScreenFeaturesDocument
theme/preview.css            # 存在する場合
screens/{screenId}/description.json
screens/{screenId}/source.json          # Source 文書の正規化コピー
screens/{screenId}/snapshots/{stateId}.html
screens/{screenId}/resources/...        # per-screen（aggregate manifest は除外）
screens/{screenId}/references/{viewport}/meta.json
screens/{screenId}/references/{viewport}/reference.png   # blob（hash ファイル名に依存しない logical 名）
screens/{screenId}/captures/{stateId}/{viewport}/meta.json
screens/{screenId}/captures/{stateId}/{viewport}/capture.png
```

`project.json.screenOrder` は **全 screenId をちょうど 1 回**含む project-level 順（現行 canonical は `loadScreenSpecProject` の `screenId.localeCompare(..., 'en')`）。  
tree 内ディレクトリの名前ソートは hash 安定化用であり、製品の画面順ではない。

| 順序の種類 | 正本 |
|------------|------|
| Feature どうし | `features[].displayOrder` |
| Feature 内画面 | `features[].screenIds` |
| Ungrouped | `screenOrder` からどの Feature にも属さない id を filter（配列順維持） |
| Project 全体表示 / Export | Feature（displayOrder）→ 各 screenIds → Ungrouped（上記） |

Feature へ移動しても `screenOrder` から screenId を削除しない。checkout（7E-3）は `screenOrder` / Feature / screen データを復元できること。

| 含む | 含まない |
|------|----------|
| Description / Source / features | `dist/**` |
| Reference / Capture（meta+bytes、PNG signature 検証） | Viewer bundle / cache |
| snapshots / per-screen resources | token / signed URL / 絶対パス / dist / aggregate manifest |
| Source `*.spec.json` の正規化コピー | **Nunjucks / Vue 実装ソース全体** |

Feature 変更は主に `features.json` blob の diff として現れ、画面移動だけでは画面 blob を不必要に複製しない。

---

## 12. Working tree / Index

| 項目 | 契約 |
|------|------|
| working tree SoT | 現行物理パス上のファイル |
| status | HEAD tree（または index）と **content hash 比較**。mtime 単独は使わない |
| 状態 | untracked / modified / deleted / staged / staged+modified |
| stage | path 集合を index に載せる。**常に project index** |
| `--screen` | その画面 logical paths を stage |
| `--feature` | その時点の membership に属する画面 paths + 必要なら `features.json` の関連変更 |
| `--all` | project 全変更 |
| feature metadata のみ | `features.json` だけ stage |
| binary | hash 比較。同一 bytes は unmodified |
| empty commit | 既定不可 |

機能単位 stage は「別 repo / 別 commit」ではなく、**選択した変更を project index に載せる操作**である。
commit 時の tree は「HEAD tree に staged 変更を適用した **完全な project tree**」。

---

## 13. Commit / Ref / HEAD / init（確定）

### 13.1 `jskim spec version init`

| 項目 | 契約 |
|------|------|
| 生成するもの | repository metadata のみ（`format` / `HEAD` / `refs/heads/main` の unborn 準備 / 空 index / `config.json` 雛形 等） |
| 自動 stage | **しない** |
| 自動 initial commit | **しない** |
| 初期 branch | **`main`** |
| HEAD | `ref: refs/heads/main` |
| commit が無い間 | **unborn branch**（`main` はまだ hash を持たない） |
| working tree | 現行 Screen Spec 内容は status 上 **added / untracked 相当** として列挙 |
| ユーザー操作 | 明示的に `add` → `commit` |
| 空 project | init 自体は可能。empty initial commit は **既定で作らない・許可しない** |

理由: Git 類似の明示 commit、初期 snapshot のユーザー確認、自動履歴と承認履歴の混同防止、CI の予測可能性。

### 13.2 ref

- commit 後: `refs/heads/<branch>` → commit hash
- `HEAD` → `ref: refs/heads/main` または detached hash
- ref 更新は **expected old hash の compare-and-swap**（unborn → 初回 commit は expected empty）

---

## 14. Branch / Tag

| 操作 | 契約 | Phase |
|------|------|-------|
| branch 作成 / 削除 | 現 HEAD 基準。checkout 中の削除は拒否 | 7E-3 |
| tag 作成 / 照会 | annotated。上書き・force・移動は初期禁止 | **7E-3**（形式は 7E-1） |
| 名前 | Windows / URL 安全な文字に制限 | |

---

## 15. Checkout / Revert

| 操作 | 契約 |
|------|------|
| checkout | revision の tree を working tree へ展開。dirty なら既定拒否（`--force` は破壊的・明示） |
| Reference | PNG + **canonical meta** を同一 revision から対で復元（§5.1a）。Figma なら Reimport 可能。Viewer 表示は browser-safe |
| revert | **履歴を消さず**、指定 commit の逆 diff を適用した **新 commit**（または stage まで） |
| reset --hard 相当 | 公開 CLI の既定には置かない。復旧用内部 / 明示危険オプションは後続 |

---

## 16. Merge / Conflict

### 16.1 object model（7E-1 から）

- `commit.parents`: **0 個以上**
- 通常 commit: parent **1**
- merge commit: parent **2 以上**
- 7E-1〜5 で merge commit を読めればよい（作成 UI/engine は不要）

### 16.2 実装時期（確定）

| Phase | merge 関連 |
|-------|------------|
| 7E-1〜5 | merge **engine / conflict UI は範囲外** |
| **7E-6** | local merge + conflict / abort / continue |
| 7G 初期 | Remote は object/ref 転送可能。**non-fast-forward pull の自動統合はしない**（ff のみ or 明示 reject）。完全統合は **7E-6 完了後** |
| 7G と 7E-6 | Remote Provider 自体は merge 非依存。integration に merge または明示中断が必要 |

### 16.3 conflict 方針（7E-6 設計）

| 状況 | 方針 |
|------|------|
| fast-forward | 許可 |
| 3-way | common ancestor tree 基準 |
| features.json | 構造マージ。二重所属は conflict |
| A: 移動 / B: 同一画面を旧 feature 内 reorder | **conflict** |
| A: Feature 削除 / B: 同 Feature に screen 追加 | conflict |
| A/B: 同一 screen を異なる feature へ | conflict |
| screen JSON 同一フィールド | field conflict |
| 片側削除・片側修正 | conflict |
| binary Reference/Capture | 双方変更なら conflict |
| abort / continue | `version/` 下に `MERGE_STATE.json`（`mergeIndexTree` / `mergeIndexRevision` 含む）。conflict setup 時点で index も auto-merge 結果を保持する。conflict path を stage すると resolved 扱い |

#### merge CLI workflow（7E-6 実装）

```text
# branch 上で target revision を merge（clean tree 必須）
jskim spec version merge [<project>] <revision> [--message <msg>] [--json]

# 進行中 merge の確認
jskim spec version merge [<project>] --inspect [--json]

# conflict 解消後（該当 path を add 済み）
jskim spec version merge [<project>] --continue [--message <msg>]

# merge 中止（working tree が merge 開始時と同一のとき。index は merge setup の auto-merge 状態を許容し、ours へ復元する）
jskim spec version merge [<project>] --abort
```

conflict setup 後の index は **ours tree ではなく** auto-merge 済み tree（non-conflict は theirs/ours 結果、conflict path は ours）を保持する。`continue` / `commit` はこの index を merge commit の tree として使う。

merge 中に Feature API で `features.json` を変更した場合は **working edit** とみなす。反映には `add --feature` / `add --features` が必要であり、merge 開始後の Feature 変更があると `merge --abort` は `SPEC_VERSION_MERGE_ABORT_UNSAFE` になり得る。

| outcome | 説明 | exit |
|---------|------|------|
| already-up-to-date | 取り込み不要 | 0 |
| fast-forward | ref / source を target へ | 0 |
| merged | 2-parent commit 作成 | 0 |
| conflicts | `MERGE_STATE` 残置、path 一覧 | **3** |

merge 進行中は checkout / revert / branch / tag / author config を `SPEC_VERSION_MERGE_IN_PROGRESS` で拒否する。`status` は merge base / target / 未解決 conflict を表示する。

---

## 17. Atomicity / Recovery

| 項目 | 契約 |
|------|------|
| object write | temp + rename。不完全 object は hash 検証で破棄 |
| index / ref | CAS + lock file |
| journal | 任意。crash 後に未完了 tx を rollback |
| 同時 Viewer/CLI | repository lock（排他）。409 / CLI エラー |
| stale lock | pid / 時刻しきい値で回収（実装で慎重に） |
| fsck | 到達不能 object・壊れた hash・欠落参照を報告 |
| gc | dangling blob 削除（ref / index / reflog から到達不可） |
| corruption vs dangling | 破損は error。dangling は gc 対象 |

既存 `writeFileAtomic` / revision 楽観ロックの思想を踏襲する。

---

## 18. CLI

### 18.1 version（設計）

```text
jskim spec version init [<project>]
jskim spec version status [<project>] [--feature <id>] [--screen <id>]
jskim spec version diff [<project>] [--staged] [--feature <id>] [--screen <id>]
jskim spec version add [<project>] [--feature <id>] [--screen <id>] [--all]
jskim spec version commit [<project>] -m <message>
jskim spec version log [<project>] [--feature <id>] [--screen <id>]
jskim spec version branch [<project>] …
jskim spec version checkout [<project>] <revision>
jskim spec version tag [<project>] <name>
jskim spec version revert [<project>] <revision>
jskim spec version merge [<project>] <revision> [--message <message>]
jskim spec version merge [<project>] --inspect [--json]
jskim spec version merge [<project>] --continue [--message <message>]
jskim spec version merge [<project>] --abort
```

現行 `jskim spec <subcommand>` パターンに合わせる。`export` は別サブコマンド（Phase 7F）。

| 項目 | 契約 |
|------|------|
| exit 0/1 | 成功 / 利用誤り・失敗 |
| メッセージ | 日本語 |
| `--json` | CI 向け machine-readable（後続で必須化可） |
| project 省略 | 既存どおり単一 project のみ |
| dirty checkout | 既定失敗 |
| ambiguous id | 明確なエラー |

### 18.2 feature CLI

Viewer 編集を主、CLI は自動化・CI 用に **同等操作を提供**（どちらか一方に閉じない）。

```text
jskim spec feature list|create|rename|reorder|move-screen|delete …
```

実装順: schema + repository（7E-1）の後、mutation API / Viewer（7E-5）と CLI を並列可能。

---

## 19. Revision API

Local Viewer は filesystem に直接触らず、`jskim spec dev` の same-origin API を使う。
`serve` / 静的 Viewer では **read-only かつ未初期化なら空/非表示**（mutation なし）。

### 19.1 初期 read API（実装済み）

既存 `/_jskim/spec/...` に合わせる。**GET のみ**。`jskim spec dev` でのみ mount。

| Method | Path | 用途 |
|--------|------|------|
| GET | `/_jskim/spec/version/status` | branch, HEAD, dirty 要約（未初期化は 200 + `initialized:false`） |
| GET | `/_jskim/spec/version/revisions` | log（scope/filter/page + `historyHead`） |
| GET | `/_jskim/spec/version/revisions/{commitHash}` | 詳細 + first-parent 変更要約 |
| GET | `/_jskim/spec/version/diff` | `from`/`to`（省略時は to の first parent） |
| GET | `/_jskim/spec/version/branches` | |
| GET | `/_jskim/spec/version/tags` | |
| GET | `/_jskim/spec/features` | working tree の features（未作成なら空） |

Query（log）: `scope`（`project`\|`feature`\|`screen`）、`featureId`、`screenId`、`cursor`、`limit`（default 20、max 100）、`historyHead`

### 19.2 応答の要点

- short/full hash、author **name のみ**（email は Viewer/API 非露出。CLI/repository には保持）
- changedFeatures / changedScreens / changedItems / changedAssets（browser-safe summary）
- Figma canonical の `fileKey` / `nodeId` は投影しない（`frameName` / `importedAt` / `source.type` のみ可）
- corrupt repository → 500（`SPEC_VERSION_*_CORRUPT` 系）
- 未 init の list/detail → 409 `SPEC_VERSION_NOT_INITIALIZED`（status は 200 投影）
- history 変更中の pagination → 409 `SPEC_VERSION_HEAD_CHANGED`

### 19.3 将来 mutation API（設計のみ）

feature CRUD / stage / commit / checkout / revert / branch / tag / merge
共通: same-origin、CSRF 対策（既存編集 API 方針に合わせる）、`expectedHead`、operation lock、abort、日本語エラー、秘密非露出。

---

## 20. Viewer hierarchy

```text
Project
├─ Feature（折りたたみ）
│  └─ Screen（feature.screenIds 順）
└─ Ungrouped
   └─ Screen
```

| 項目 | 契約 |
|------|------|
| features.json 無し | 現行フラット一覧のまま動作 |
| 検索 | 結果に Feature パンくずを付けつつ deep link は `screenId` |
| deep link / route | 既存 screen route 互換。feature は query または親状態 |
| 機能移動 | 編集モードの UI（7E-5）。`screenId` 不変 |

---

## 21. 改訂履歴modal

- 名称: **改訂履歴**（実装済み・read-only）
- 表示: 現 branch、HEAD short hash、working tree 状態、message、author name、日時、tag、parent、変更 feature/screen/item/assets
- 起動: `jskim spec dev` の Viewer 画面ヘッダ（capability があるときのみ）。static Viewer では非表示
- 起動 scope:
  - Project 全体
  - 現 Feature（**その commit 時点の membership** で filter。現在所属だけで過去を書き換えない）
  - 現 Screen（**安定 `screenId`** で filter。機能移動後も履歴が追える）— 画面ページからの既定
- commit 選択: parent diff、機能変更、画面追加/修正/削除、機能間移動、item、Reference/Capture summary
- UX: pagination、loading/empty/error、keyboard/focus/aria、390px
- **mutation（commit/checkout/revert）は CLI のみ**。modal に mutation ボタンは無い
- **autosave ≠ commit**。Description 保存は working tree 更新のみ
- **browser-safe 境界**:
  - inline bootstrap（`__JSKIM_SPEC_VERSION__`）は capability と API ベース URL のみ。`projectName` 等の可変文字列は載せない
  - bootstrap JSON は HTML tokenizer 安全な inline serialization（`<` / `>` / `&` / U+2028 / U+2029 を escape）
  - Revision API / modal は **author email** を返さない（author **name** のみ）
  - Figma **fileKey** / **nodeId** / token / signed URL は API 応答に含めない
  - commit message / Feature name / item label は **HTML として解釈しない**（Vue text interpolation）

---

## 22. Excel Exportとの関係

詳細は [excel-export.md](./excel-export.md)（本設計に合わせて補正済み）。要約:

| scope | 内容 |
|-------|------|
| Screen Export | `改訂履歴` + `画面設計(<画面名>)` |
| Feature Export | 機能に属する複数画面（既存手作業 Excel の参考形） |
| Project Export | `機能一覧` + 全画面設計 |

- 基本設計単位は **Screen**
- 公式納品は HEAD または `--revision`
- `改訂履歴` シートは **version commit log**（export 時刻の捏造ではない）
- Export 入力の正本は **src / revision tree**（dist 単独に依存しない）

---

## 23. Remote Provider Framework

JSKim は公式中央 backend を固定運用しない。
提供するのは interface・orchestration・capability・conformance・in-memory provider・credential 境界。

最小 capability:

```text
hasObject / getObject / putObject
listRefs / getRef / updateRef(expectedOld, new)
fetch / push
optional lock / pagination
```

| 規則 | 内容 |
|------|------|
| hash 不変 | backend が commit / object ID を再発番しない。**`fileKey`/`nodeId` 削除による別 hash 生成もしない** |
| object 内容 | Local と同一 canonical bytes（§5.1a）。core による秘密以外の勝手な redaction 禁止 |
| 暗号化 | 組織方針で平文不可なら provider / ストレージ層。JSKim core は転送前に識別子を落とさない |
| ref | CAS。non-ff は拒否（強制は明示） |
| Central Viewer | **push 済み commit のみ**。応答は browser-safe。working tree / local-only は出さない |
| credential | PAT 等は config / object に入れず env / credential provider |
| pull | `fetch` + ローカル統合 |

---

## 24. Security

- PAT / token / password / signed URL を config・object・API 応答・Excel・エラーに出さない
- `fileKey` / `nodeId` は **object には保存しうる**が、Viewer / Revision API / Excel / エラーメッセージには出さない（credential と同一視しない）
- 絶対パス禁止（project-relative のみ）
- Central に local-only を出さない
- formula injection は Excel Phase で継続
- repository に macro 無し

将来 config 案（**本 Phase では production に追加しない**）:

```js
projects: {
  sample: {
    screenSpec: {
      versionControl: {
        remotes: {
          origin: {
            provider: '...',
            endpoint: '...',
            projectKey: '...',
          },
        },
        defaultRemote: 'origin',
      },
    },
  },
}
```

---

## 25. Migration / Compatibility

| 項目 | 契約 |
|------|------|
| 既存 project | 全画面 **Ungrouped**。`screenId` / route / Description / Source / Reference/Capture path 維持 |
| `features.json` 不在 | 正常。Viewer は現行同等 |
| schemaVersion | features `1.0`。未知は読込規則を文書化 |
| 重複 membership | save / commit 時 reject |
| 壊れた参照 | validation error |
| migration command | 必須ではない（lazy: 初回 feature 作成時にファイル生成） |
| build 破壊禁止 | Feature 導入だけで既存 build/Viewer を失敗させない |

---

## 26. Error contract

| code | メッセージ例 |
|------|----------------|
| `SPEC_VERSION_NOT_INITIALIZED` | 版管理リポジトリが初期化されていません。 |
| `SPEC_VERSION_CORRUPT` | 版管理リポジトリが破損している可能性があります。 |
| `SPEC_VERSION_LOCK_HELD` | 別の版管理操作が実行中です。 |
| `SPEC_VERSION_DIRTY_WORKTREE` | 未コミットの変更があるため checkout できません。 |
| `SPEC_VERSION_REF_CAS_FAILED` | 参照の更新に失敗しました。最新状態を確認してください。 |
| `SPEC_VERSION_OBJECT_MISSING` | 必要なオブジェクトが見つかりません。 |
| `SPEC_VERSION_EMPTY_COMMIT` | コミットする変更がありません。 |
| `SPEC_VERSION_AUTHOR_REQUIRED` | 作者名が設定されていません。`config.json` または環境変数を設定してください。 |
| `SPEC_FEATURE_NOT_FOUND` | 指定した機能グループが見つかりません。 |
| `SPEC_FEATURE_ORDER_CONFLICT` | 機能グループの displayOrder が重複しています。 |
| `SPEC_FEATURE_DUPLICATE_MEMBERSHIP` | 同じ画面が複数の機能グループに属しています。 |
| `SPEC_FEATURE_INVALID` | 機能グループの定義が不正です。 |

絶対パス・secret をメッセージに含めない。

---

## 27. Test strategy

実装 Phase で必要な観点（抜粋）:

- 既存 project が Ungrouped で開く
- feature CRUD / 移動 / reorder / 重複拒否 / 欠落参照
- screen identity 維持・移動 diff
- canonical serialization / hash 安定 / tree 決定性 / binary dedupe
- stage（screen/feature/project）/ atomic commit / ref CAS / 同時書き込み
- crash recovery / stale lock / dirty checkout
- revert / branch/tag / merge conflict ケース（§16）
- corrupt / missing object / Windows path / 日本語名
- Revision API filter・pagination・過去 membership の feature history
- Viewer modal a11y / 390px
- Excel Screen/Feature/Project + `--revision` 再現（semantic）
- Remote Provider conformance（後続）

hash は golden bytes を検討。Excel は semantic assertion 優先。

---

## 28. Implementation phases

順序固定: **画面中心 local model → local VC → revision UI → version-aware Excel → Remote**
（local merge は Excel 前でも Remote 本格統合前の **7E-6**）

### Phase 7E-1 — schema + repository format + object store

| 項目 | 内容 |
|------|------|
| 状態 | **実装済み**（domain API。ユーザー向け CLI は未提供） |
| 範囲 | `features.json` の validate/load/persist、`initVersionRepository`、blob/tree/commit/tag object store、canonical JSON、`spec/*/.jskim/version/` gitignore |
| 公開 API（companion root） | `loadScreenFeatures` / `persistScreenFeatures` / `validateScreenFeatureFile` / `initVersionRepository` / `writeVersionObject` / `readVersionObject` / `hasVersionObject` / `hashVersionObject` |
| 除外（未実装） | snapshot/status/diff、stage/commit workflow、branch/tag CLI、checkout/revert/merge、Revision API、Viewer、Excel、Remote |

### Phase 7E-2 — snapshot / status / diff / stage

| 項目 | 内容 |
|------|------|
| 状態 | **実装済み**（domain API。ユーザー向け CLI は未提供） |
| 範囲 | logical working snapshot（`project.json.screenOrder`）、object persistence、HEAD 読取、recursive tree diff、index（reachable integrity + lock/CAS）、`getVersionStatus`、`stageProject` / `stageScreen` / `stageFeature`、HEAD≠baseCommit 時 stage 拒否、PNG signature、7E-1 follow-up |
| 公開 API（追加） | `createWorkingSnapshot` / `persistSnapshotObjects` / `readVersionHead` / `readVersionIndex` / `diffVersionTrees` / `getVersionStatus` / `stageProject` / `stageScreen` / `stageFeature` |
| stage 契約 | `stageScreen`: screen subtree + `screenOrder` semantic merge（他 screen 内容は触らない。features.json 非自動）。`stageFeature`: features.json 全体 + 所属 screen（`screenOrder` 維持）。大規模な順序再配置は `stageProject` |
| 未解決 | Capture 専用バイト上限（現状は寸法中心。snapshot は全 bytes をメモリ読込） |
| 除外（未実装） | ユーザー CLI、commit/log、branch/tag 更新、checkout/revert、merge、Revision API、Viewer、Excel、Remote |

### Phase 7E-3 — commit / log / branch / tag / checkout / revert / recovery

| 項目 | 内容 |
|------|------|
| 範囲 | commit、refs CAS、**annotated tag CLI**、checkout 保護、revert、lock/journal、author 解決 |
| 除外 | merge engine / conflict UI、Viewer 改訂 UI、Excel |

### Phase 7E-4 — Revision API + 改訂履歴 modal

| 項目 | 内容 |
|------|------|
| 範囲 | GET API、改訂履歴 modal（**7E-4B 実装済み**） |
| 除外 | Remote、Excel、merge UI、Viewer mutation |

### Phase 7E-5 — Viewer Feature navigation / management

| 項目 | 内容 |
|------|------|
| 範囲 | Project→Feature→Screen sidebar、`/_jskim/spec/features` mutation API（spec dev のみ）、`機能管理` dialog、optimistic concurrency + project lock |
| 契約 | Feature 変更は working tree のみ。自動 stage/commit なし。Feature 削除は Screen 削除ではない |
| 除外 | Excel、Remote、merge、Viewer 版 mutation UI |

### Phase 7E-6 — local merge + conflict / abort / continue（**実装済み**）

| 項目 | 内容 |
|------|------|
| 範囲 | 3-way merge、§16.3 conflict、CLI abort/continue/inspect、Feature domain merge、Viewer read-only merge 表示 |
| 完了条件 | 代表 conflict ケースのテスト green |
| 除外 | Remote Provider 本体（7G）、Viewer conflict 解消 UI |

### Phase 7F-1〜3 — version-aware Excel

[excel-export.md](./excel-export.md)。Screen/Feature/Project、`--revision`、commit log 改訂履歴。

### Phase 7G-1〜3 — Remote Provider

interface + in-memory → fetch/push/CAS → Central Viewer 参照。
**公式 backend 運用は行わない。**
7E-6 前の 7G 初期は **non-fast-forward を拒否**し、自動 merge しない。

---

## 29. 決定事項と残件

### 29.1 本補正で確定済み

- init は metadata のみ。自動 stage / initial commit なし。初期 branch `main`（unborn 可）
- repository は `spec/{project}/.jskim/version/`。利用者 Git 既定非追跡。gitignore は **7E-1 で実装**
- author は repository-local config + env。global Git 非継承。欠落は error
- tag 形式は 7E-1、CLI は 7E-3。force/移動禁止。source Git tag と非連携
- template（Nunjucks/Vue）実装ソースは version 対象外
- merge object（parents≥2）は最初から許容。**merge engine / CLI は 7E-6 実装済み**
- Feature membership 正本は `features.json` のみ。機能順は一意な `displayOrder`、画面順は `screenIds`
- Ungrouped = features 非掲載。順は既存 screen canonical 順
- Reference version は **canonical meta（Figma 時 fileKey/nodeId 含む）+ PNG**。token/signed URL は非保存。Viewer/API/Excel は browser-safe のみ
- Remote は同一 hash。core は `fileKey`/`nodeId` を redaction しない

### 29.2 実装調査後に数値・詳細を固める項目

- resources の GC / 大容量閾値、object size 上限
- backup / 選択的コピー command の UX
- repository format migration command
- Capture 専用バイト上限を Spec 本体と揃えるか（現行は寸法中心）
- 横断 tags（feature 以外のラベル）をいつ入れるか（初期は入れない）

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-07-20 | Phase 7E-0 初版 |
| 2026-07-20 | init / inclusion / Feature 順序 / author / tag・merge Phase / gitignore 契約を確定 |
| 2026-07-20 | Figma canonical meta の version 保存・露出境界、displayOrder 一意 validation を確定 |
