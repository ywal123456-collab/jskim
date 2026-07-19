# Reference Image 方針（Phase 7C-2A-0 / 7C-2A-1 / 7C-2A-2）

このドキュメントは、Screen Spec Viewer の **Reference Image（デザイン基準画像）** について、保存モデル・画面/Viewport 関係・Upload/Replace/Delete API・Viewer 表示・Figma Import 受け入れ口を確定する設計です。

| Phase | 状態 |
|-------|------|
| **7C-2A-0** | 調査・設計（文書） |
| **7C-2A-1** | **完了** — Reference Image **core**（put/delete/status、PNG 検証、atomic 保存、optimistic revision、watcher、manifest/output） |
| **7C-2A-2** | **完了** — `jskim spec dev` multipart PUT / DELETE / status GET、runtime registry、same-port 統合 |
| **7C-2A-3** | **完了** — Viewer **参照** タブ、内部 PC/SP、Upload/Replace/Delete Dialog、runtime/pending UX、read-only 表示 |
| **7C-2A-3S** | **完了** — Viewer same-port 安定化（upload/delete in-progress 409、Dialog revision conflict、画面作成/複製での Reference missing、polling cleanup） |

関連:

- Preview Provider 全体方針: [preview-viewport-reference-image.md](./preview-viewport-reference-image.md)
- Device Capture 実装方針: [device-preview-capture.md](./device-preview-capture.md)
- 設計先行 CRUD: [design-first-crud.md](./design-first-crud.md)
- Screen Spec 概要: [README.md](./README.md)

---

## 1. 背景

現行 Viewer（Phase 7C-1A）は次を提供する。

```text
[Live] [PC] [SP]
```

| タブ | 実装 | 役割 |
|------|------|------|
| Live | DomPreview（Shadow DOM） | 項目 Badge・選択・highlight・state 切替 |
| PC / SP | Device Capture 画像 | Playwright による実装結果の静止画検証 |

DESIGN_ONLY は実装 snapshot が無いため **No Preview** のままである。デザイン基準画像を先に登録してレビューする導線がまだ無い。

長期的には Figma Frame を取り込み、Device Capture と並べて比較したい。そのためには、実装結果（Capture）とデザイン基準（Reference）を **混ぜない保存・API・manifest 契約** を先に固定する必要がある。

---

## 2. 目的

本設計の目的:

```text
1. Reference Image の単位（screen / state / viewport）を初期バージョン向けに確定する
2. captures/ と分離した保存ディレクトリと generation + meta.json 契約を決める
3. Upload / Replace / Delete の API・検証・原子性・revision を決める
4. DESIGN_ONLY / IMPLEMENTATION_ONLY / LINKED での表示可否を決める
5. watcher / manifest / output / read-only 契約を決める
6. Figma Import が同じ core を使えるように source metadata の拡張口を残す
7. 実装 Phase を安全に分割する
```

本設計文書の当初スコープ外（Viewer / Figma / 比較は後続 Phase）:

```text
Viewer 参照タブ / Dialog
Schema 変更
Figma API
visual diff / overlay
OCR / 画像→HTML
annotation editor
```

---

## 3. Live DOM・Device Capture との役割分担

| 層 | 役割 | Source of truth |
|----|------|-----------------|
| **Live DOM** | 設計書と実 DOM item の接続、Badge、選択、highlight、将来の直接編集・コード生成 | snapshot HTML + Description |
| **Device Capture** | 実装結果の PC/SP viewport 静止画、反応形検証 | 派生成果物（source + snapshot + resources から再生成） |
| **Reference Image** | デザイン基準画像、実装と独立、upload / Figma import | ユーザー資産（手動または import） |

Reference Image を次として扱わない。

```text
実際の source code
実装結果
Description JSON の代替
Live DOM の source of truth
```

---

## 4. No-code 拡張との関係

想定フロー:

```text
画面設計書または Component Model 修正
→ 実 source 生成・更新
→ Live DOM 収集
→ Device Capture 再収集
→ Reference Image と結果比較
```

Reference Image はコード生成の **補助資料** になり得るが、初期バージョンでは画像を自動でコードへ変換しない。

初期非範囲:

```text
画像 OCR
画像→HTML 自動生成
Figma node→Component 自動変換
visual diff / pixel comparison
annotation editor
```

---

## 5. Reference Image の単位

### 5.1 候補比較

| 候補 | 単位 | 長所 | 短所 |
|------|------|------|------|
| **A** | `screenId + viewport` | DESIGN_ONLY でも使える、単純、PC/SP Capture と比較しやすい | state 別デザイン不可 |
| **B** | `screenId + stateId + viewport` | 実装 state と厳密対応 | DESIGN_ONLY に state が無い、削除/rename と強結合、初期複雑 |
| **C** | 独立 `referenceId` | 複数案・拡張性が高い | 初期過設計、CRUD/selector 増加 |

### 5.2 最終モデル（確定）

**初期バージョンは候補 A: screen + viewport。**

```text
各 screen について
  PC Reference Image: 0 または 1
  SP Reference Image: 0 または 1
```

後続 schema 拡張候補（初期に入れない）:

```text
state 別 Reference Image
同一 viewport の複数デザイン案（A/B）
```

---

## 6. Screen State との関係

初期モデルでは Reference Image は **StateSelector と直接結合しない**。

```text
state を default → error に変えても
同じ PC / SP Reference Image を表示する
```

混同防止:

```text
Live / Device Capture … StateSelector が意味を持つ
Reference Image … 画面全体のデザイン基準（state 非依存）
```

**推奨 UX（実装 Phase で適用）:**

```text
Reference Provider 表示中は StateSelector を非表示または無効化する
（「状態を変えても参照画像は変わらない」を UI で示す）
```

---

## 7. DESIGN_ONLY

Reference Image は実装 route がなくても使える。

必須シナリオ:

```text
DESIGN_ONLY + PC Reference
DESIGN_ONLY + SP Reference
DESIGN_ONLY + PC/SP Reference
DESIGN_ONLY + Reference なし
```

Reference がある DESIGN_ONLY を従来の単純 No Preview のままにしない。

### 7.1 Preview 可否フラグ（推奨）

現行 `hasPreview` の意味は変更しない。

```text
hasPreview（現行維持）
  ≡ 実装があり、かつ snapshots/{screenId}/ に *.html が 1 件以上
```

追加概念（manifest / Viewer 計算用。Description Schema 1.2 には埋め込まない）:

```text
hasImplementation
hasLivePreview      … 現行 hasPreview と同義でよい
hasDeviceCapture    … いずれかの state/viewport に current|stale Capture
hasReferenceImage   … PC または SP に current Reference
hasAnyPreview       … hasLivePreview || hasReferenceImage
                      （将来 hasDeviceCapture を含めてもよいが、
                       Capture のみ・Live なしは現状ほぼ起きない）
```

DESIGN_ONLY + Reference あり:

```text
hasLivePreview = false
hasReferenceImage = true
hasAnyPreview = true
→ No Preview 文言ではなく Reference Provider を表示
```

Description Schema 1.2 に binary metadata を埋め込まない。理由:

```text
revision 競合とバイナリ寿命が異なる
atomic generation + meta.json と二重管理になる
Figma import でも同じ問題が起きる
```

---

## 8. IMPLEMENTATION_ONLY

次を許可する（確定）。

```text
IMPLEMENTATION_ONLY
+ Live
+ Device Capture
+ Reference Image
```

表示可否を `hasDescription` で判定しない。

**アップロード権限（確定）:**

```text
登録済み screenId があれば Description の有無に関係なく upload / replace / delete 可能
（editable spec dev のみ）
```

screen が manifest に存在しない ID への orphan upload は拒否する。

---

## 9. LINKED

LINKED は Live / Device Capture / Reference をすべて表示できる。

```text
preferred provider は既存 sessionStorage を拡張可能
Reference 選択中も preferred を project スコープで保持する
```

---

## 10. 保存ディレクトリ

### 10.1 名称比較

| 名称 | 評価 |
|------|------|
| `references` | 短い。Capture の `captures` と対になる。推奨 |
| `reference-images` | 明確だが長い |
| `design-references` | 「design」が Description と紛らわしい |

### 10.2 確定パス

```text
spec/{project}/src/references/{screenId}/{viewport}/
├─ reference-<sha256hex>.png
└─ meta.json
```

例:

```text
spec/sample/src/references/inquiry-input/pc/
spec/sample/src/references/inquiry-input/sp/
```

混ぜないもの:

```text
snapshots/
captures/
resources/
production src/assets
Viewer output 以外の app dist
```

---

## 11. Image Format

### 11.1 比較

| Format | 線の鮮明さ | Figma | 透明 | サイズ | 既存 parser | 初期 |
|--------|------------|-------|------|--------|-------------|------|
| **PNG** | 高い | 標準 export | 可 | 大きい | `readPngDimensions` 再利用可 | **採用** |
| JPEG | 文字に不利 | 可 | 不可 | 小さい | 新規 | 後続 |
| WebP | 良好 | 環境差 | 可 | 小さい | 新規 | 後続 |

### 11.2 確定

```text
Phase 7C-2 初期は PNG のみ
JPEG / WebP は実需要確認後に拡張
```

非 PNG は API/UI で明確に拒否する（日本語メッセージ）。

---

## 12. Metadata

### 12.1 初期必須（確定）

```json
{
  "schemaVersion": "1.0",
  "screenId": "inquiry-input",
  "viewport": {
    "id": "pc",
    "width": 1440,
    "height": 900
  },
  "format": "png",
  "imageFile": "reference-<sha256hex>.png",
  "imageRevision": "sha256:...",
  "imageWidth": 1440,
  "imageHeight": 1800,
  "uploadedAt": "2026-07-18T00:00:00.000Z",
  "source": {
    "type": "upload"
  }
}
```

`viewport.width` / `viewport.height` は **論理 viewport preset**（Device Capture と同じ pc=1440×900 / sp=375×812）。画像の実ピクセルは `imageWidth` / `imageHeight`。

### 12.2 初期任意（入れてもよいが必須にしない）

```text
originalFileName … 表示用。no-op 判定には使わない
label / note … 後続 UI。初期は省略可
```

### 12.3 Figma 拡張口（upload 時は載せない）

```json
"source": {
  "type": "figma",
  "fileKey": "...",
  "nodeId": "...",
  "frameName": "...",
  "sourceUrl": "...",
  "importedAt": "..."
}
```

### 12.4 保存禁止

```text
Figma access token
cookie
absolute local path
OS ユーザー情報
browser executable
一時 upload path
```

---

## 13. Viewport と画像寸法

```text
viewport.id          … pc | sp（ユーザー選択）
logical width/height … preset（1440×900 / 375×812）
imageWidth/Height    … 実 PNG ピクセル（2x export 可）
```

**自動判定（推奨）:**

```text
画像 width から PC/SP を「提案」してよい
最終確定はユーザー選択（または API の viewport 引数）
自動判定だけで viewport を確定しない
```

---

## 14. Generation Image

Device Capture と同様に **固定ファイル名の同時上書きを避ける**。

```text
reference-<content-sha256>.png  … generation
meta.json                       … 現在有効な generation を指す commit point
```

`createFileAtomic` / `writeFileAtomic` / `computeContentRevision`（companion `util/write-file-atomic.ts`）および PNG IHDR 検証（`png-dimensions.ts`）を再利用する。

Capture 専用 helper（`persist-capture.ts`）を無理に共通化せず、Reference 用の薄い persist を新設してよい。過剰な plugin framework は作らない。

---

## 15. Atomic Commit

推奨順序:

```text
1. multipart TEMP へ受信
2. magic bytes / IHDR / dimension / size 検証
3. imageRevision = content hash 計算
4. generation image を createFileAtomic で publish
5. metadata TEMP 作成
6. meta.json を writeFileAtomic で commit（commit point）
7. 以前の generation を best-effort cleanup
```

失敗時:

```text
既存 Reference Image を維持
新 TEMP を削除
未参照 generation を削除
```

部分成功（image のみ成功・meta 失敗）でも **既存 meta が指す画像が正** であり続ける。

---

## 16. Status

### 16.1 persisted（確定）

```text
missing   … meta.json なし
current   … meta + 参照 PNG が契約どおり
invalid   … metadata / hash / PNG が壊れている
```

**stale は持たない。** Reference は source から派生しない。

Figma 再 import 用の将来状態（初期 enum に入れない）:

```text
reimportAvailable / sourceUpdated … 後続で別フィールドとして検討
```

### 16.2 runtime（spec dev in-memory）

```text
idle
uploading
deleting
failed
```

manifest には runtime を含めない（Device Capture と同じ分離）。

---

## 17. Upload

### 17.1 API 比較

| 方式 | 評価 |
|------|------|
| **multipart PUT** | FormData・ブラウザ標準。推奨 |
| JSON base64 | サイズ肥大・メモリ負荷 |
| local filesystem path | セキュリティ上不可 |
| raw binary body | filename/MIME 扱いが弱い |

### 17.2 確定

```http
PUT /_jskim/spec/reference-images/{screenId}/{viewport}
Content-Type: multipart/form-data
```

```text
field name: image（必須・1 件）
viewport: path の pc | sp
```

**upload と replace は同一 PUT。** 既存があれば replace、なければ create。

`scripts/lib/parse-multipart-form-data.js` に binary-safe な最小 multipart parser を実装済み（外部依存なし。7C-2A-2）。

---

## 18. Replace

PUT が replace を兼ねる。

競合時は §20 の `expectedImageRevision` を用いる。

レスポンス例:

```json
{
  "screenId": "inquiry-input",
  "viewport": "pc",
  "result": "created" | "updated" | "unchanged",
  "reference": {
    "status": "current",
    "imageRevision": "sha256:...",
    "imageWidth": 1440,
    "imageHeight": 1800,
    "uploadedAt": "..."
  }
}
```

絶対 path・TEMP path は返さない。`imageFile` を出す場合は basename または Viewer 相対 URL のみ。

---

## 19. Delete

```http
DELETE /_jskim/spec/reference-images/{screenId}/{viewport}
Content-Type: application/json
```

```json
{
  "expectedImageRevision": "sha256:..."
}
```

| 状況 | 挙動 |
|------|------|
| revision 一致 | meta unlink + generation best-effort 削除 → missing |
| revision 不一致 | 409。既存維持 |
| 既に missing | 404 または冪等 204（実装 Phase で一方に統一。推奨は **404** で明示） |
| 画面 DELETE との同時 | Reference DELETE は viewport 単位のみ。Description DELETE と束ねない |

---

## 20. Optimistic Revision

Reference はユーザー資産のため **last-write-wins を採用しない**。

| 状況 | リクエスト |
|------|------------|
| 既存 current の replace/delete | `expectedImageRevision` **必須** |
| missing への初回 upload | `expectedImageRevision` 省略または `null` |
| 不一致 | `409` + 日本語メッセージ。既存画像維持 |

Device Capture が `expectedRevision` を要求しない理由（派生成果物）とは意図的に異なる。

---

## 21. Validation

最小:

```text
screenId 形式（既存 Description/Capture と同系）
viewport ∈ { pc, sp }
screen が project に存在する
multipart field `image` のみ（unknown field 拒否）
空ファイル拒否
最大 body / 最大 file size（実装 Phase で数値確定。目安: 数 MB〜十数 MB）
PNG signature + IHDR（MIME ヘッダのみ信頼しない）
width/height 上限（Capture の 8192×65536 を上限候補として再利用検討）
path traversal / filename sanitization
truncated PNG 拒否
```

既存再利用:

```text
readPngDimensions / assertPngBuffer
computeContentRevision
writeFileAtomic / createFileAtomic
```

---

## 22. 同一画像 no-op

次がすべて一致する場合:

```text
imageRevision（内容 hash）
viewport
source.type（upload）
```

```text
result = unchanged
meta.json write なし
uploadedAt 維持
watcher build/reload なし
```

`originalFileName` だけ違う再アップロードで repository diff を作らない。

---

## 23. Watcher

Device Capture と同型:

| 対象 | kind |
|------|------|
| `references/**/meta.json` add/change/unlink | **BUILD_ONLY** |
| `reference-<hash>.png` / TEMP / atomic tmp / orphan cleanup | **IGNORE** |

結果:

```text
upload/replace/delete で meta commit
→ collect: 0
→ build: 1
→ reload target=spec: 1

no-op
→ build: 0 / reload: 0
```

API は build/reload を直接呼ばない。

Collector の source scan からも `references/` を除外する（Capture の `captures/` 除外と同趣旨）。

---

## 24. Manifest

### 24.1 配置（確定）

**screen エントリ（または screen JSON トップ）に `referenceImages` を置く。**

state 配下には置かない（初期単位が screen+viewport のため）。

```json
{
  "id": "inquiry-input",
  "referenceImages": {
    "pc": {
      "status": "current",
      "imagePath": "reference-images/inquiry-input/pc/reference-<sha>.png",
      "imageRevision": "sha256:...",
      "imageWidth": 1440,
      "imageHeight": 1800,
      "uploadedAt": "...",
      "viewportWidth": 1440,
      "viewportHeight": 900
    },
    "sp": {
      "status": "missing"
    }
  }
}
```

`hasReferenceImage` は build 時に PC/SP いずれかが `current` なら true。
`hasAnyPreview` は Viewer/load 層で `hasPreview || hasReferenceImage` として計算してよい。

runtime（uploading 等）は manifest に含めない。

---

## 25. Output

```text
spec/{project}/dist/data/reference-images/{screenId}/{viewport}/reference-<sha>.png
```

```text
正常 meta が指す generation のみコピー
invalid / orphan / TEMP / 旧 generation はコピーしない
production app dist には含めない
```

Device Capture の `data/device-captures/` と path を分離する。

---

## 26. Viewer Provider

### 26.1 候補比較

| 候補 | UI | 評価 |
|------|-----|------|
| **A** | `[Live][PC][SP][参照]` + 参照内 `[PC][SP]` | 現行タブを壊しにくい。初期推奨 |
| B | PC/SP ごとに 実装\|参照 | 比較に強いが現行 PC/SP 意味が変わる |
| C | `[Live][実装][参照]` × viewport | きれいだが PC/SP タブ UX を大きく変える |
| D | 5 タブ横並び | 狭い画面・a11y で不利 |

### 26.2 初期推奨（確定）

**候補 A。**

```text
[Live] [PC] [SP] [参照]
```

- Live / PC / SP … 現行どおり（Live=DOM、PC/SP=Device Capture）
- 参照 … Reference Image。内部で PC/SP を切替

将来の Device vs Reference 比較（7C-2B）は、参照タブまたは別比較モードで拡張する。初期に overlay を作らない。

preferred provider は sessionStorage を拡張（例: `live` \| `pc` \| `sp` \| `reference`）。不正値は Live へ fallback。

---

## 27. StateSelector

```text
参照タブ表示中: StateSelector を隠すか disabled
Live / PC / SP: 現行どおり StateSelector を表示
```

文言例:

```text
参照画像は画面全体のデザイン基準です。状態切替の対象ではありません。
```

---

## 28. 共通 image renderer

**共通化できる責任:**

```text
fit-to-width
原寸超拡大なし
縦長スクロール
load / error
alt
revision-addressed URL（cache bust query なし）
```

**分離する責任:**

```text
Device: current/stale/collecting/failed / 再収集
Reference: missing/current/invalid / upload/replace/delete / Figma source
```

推奨: 薄い共有 `PreviewImage`（または既存 `DeviceCaptureImage` の汎用化）+ 薄い panel を分ける。汎用 provider registry framework は作らない。

---

## 29. read-only Viewer

静的 Viewer で可能:

```text
参照タブ表示
PC/SP 参照切替
DESIGN_ONLY / IMPLEMENTATION_ONLY / LINKED での表示
```

禁止:

```text
upload / replace / delete
runtime GET
write API
Figma import
```

build 成果物に `referenceImages` metadata と参照 PNG を含める。

---

## 30. 画面作成

```text
新規 DESIGN_ONLY
→ Reference Image なし（missing）
→ その後 PC/SP を個別 upload 可能
```

Reference upload が Description PUT を暗黙実行しない。

---

## 31. 画面複製

**Reference Image は複製しない（確定）。**

理由:

```text
新 screenId への暗黙コピーは所有関係が不明瞭
binary 肥大
Description 複製が items のみである現行方針と整合
```

複製先は Reference missing から開始する。

---

## 32. Description 削除

現行どおり Description JSON のみ削除。

**Reference Image は自動削除しない（確定）。**

| 遷移 | Reference |
|------|-----------|
| LINKED → IMPLEMENTATION_ONLY | 維持・表示継続 |
| DESIGN_ONLY 削除（画面が manifest から消える） | source file は **孤児として保全**（初期） |

孤児 cleanup / 削除 Dialog での同時削除オプションは後続。ユーザー binary を暗黙削除しない。

---

## 33. Implementation 削除

実装が消えて DESIGN_ONLY になっても Reference は表示継続する。

Device Capture（実装依存）と異なり、Reference は実装存在に依存しない。

---

## 34. Reference 削除と Description 削除の区別

| 操作 | 対象 |
|------|------|
| 画面設計書を削除 | Description JSON のみ |
| 参照画像を削除 | 選択 viewport の Reference のみ |
| source を削除 | 本設計の範囲外 |

UI 文言で混同しない。

```text
画面設計を削除
参照画像を削除（PC） / 参照画像を削除（SP）
```

---

## 35. Figma Import

確定関係:

```text
Figma Frame
→ local Reference Image generation
→ 同一 meta.json 契約（source.type = "figma"）
```

token / cookie は保存しない。

初期 manual upload 実装では Figma API を呼ばない。

再 import:

```text
新 generation → meta.json 置換
```

`file version` / `etag` 等は Phase 7D で必要なら追加。初期 upload metadata に空の Figma フィールドを強制しない。

**詳細設計**: [figma-frame-import.md](./figma-frame-import.md)。

**Phase 7D-1（core 実装済み）**: companion の `importFigmaReferenceImage` / `reimportFigmaReferenceImage` が既存 `putReferenceImage` へ委譲する。server-side `source.type = "figma"`（fileKey / nodeId / frameName / importedAt / exportScale）を meta.json に保存する。`schemaVersion` は `1.0` のまま。

**Phase 7D-2（spec dev API 実装済み）**:

| Method | Path |
|--------|------|
| POST | `/_jskim/spec/reference-images/{screenId}/{viewport}/figma:import` |
| POST | `/_jskim/spec/reference-images/{screenId}/{viewport}/figma:reimport` |

- Import: JSON で `figmaUrl` **xor** `fileKey`+`nodeId`、任意/必須の `expectedImageRevision`（既存 PUT と同契約）。`token` フィールドは拒否。トークンは `JSKIM_FIGMA_TOKEN` のみ。
- Reimport: `expectedImageRevision` のみ。server-side figma source を再 export。
- read-only / serve: 既存どおり API 未登録。
- 同一 screenId+viewport の upload/delete/Figma は `SPEC_REFERENCE_IMAGE_IN_PROGRESS` で共有。
- 成功後の manifest 更新は既存 watcher（API は build 非呼び出し）。
- 詳細契約: [figma-frame-import.md](./figma-frame-import.md) §14。
- Viewer UI / manifest / GET status の browser-safe `source` 表示は **7D-3 実装済み**（`confirmWidthMismatch` 含む）。実 Figma live smoke は未検証。

---

## 36. Device Capture 比較

将来（7C-2B）:

```text
PC Capture vs PC Reference
SP Capture vs SP Reference
```

初期モデルで揃えるキー:

```text
screenId
viewport
imageWidth / imageHeight
revision-addressed URL
```

後続:

```text
side-by-side
overlay / opacity
pixel diff
dimension mismatch warning
```

---

## 37. Accessibility・日本語文言

| 用途 | 文言例 |
|------|--------|
| タブ | 参照 |
| パネル | 参照画像 / PC参照画像 / SP参照画像 |
| 状態 | 未登録 / 登録済み / データ破損 |
| 操作 | 画像を追加 / 画像を置き換え / 参照画像を削除 |
| 進行 | アップロード中… / 削除中… |
| 区別 | 実装結果（Device Capture） / デザイン参照（Reference） |

色だけに依存しない。再収集（Capture）とアップロード（Reference）の accessible name を分ける。

---

## 38. 実装 Phase

### Phase 7C-2A-1（core・完了）

```text
references/ 契約
PNG validation（最大 20 MiB / 16384×65536）
generation + meta commit
missing/current/invalid
putReferenceImage / deleteReferenceImage / getReferenceImageStatus（HTTP なし）
expectedImageRevision
per screen+viewport lock
watcher BUILD_ONLY / IGNORE
manifest referenceImages + hasReferenceImage / hasAnyPreview
output data/reference-images/...
Viewer UI なし
```

### Phase 7C-2A-2（API・完了）

```text
spec dev multipart PUT / DELETE / status GET
runtime uploading/deleting/failed（in-memory registry）
同一 key 進行中 409（API 層。core 二重呼び出しなし）
same-origin / multipart 21 MiB / PNG 20 MiB
core 委譲（put/delete/getPublicInfo）。API に第 2 queue なし
API は build/reload 非実行（watcher meta.json BUILD_ONLY）
same-port integration（created/updated/unchanged/delete/in-progress）
Viewer UI なし
```

### Phase 7C-2A-3（Viewer・完了）

```text
[Live][PC][SP][参照]
参照内 PC/SP（sessionStorage 分離）
Upload / Replace / Delete Dialog
expectedImageRevision + pending sessionStorage
runtime uploading/deleting/failed UI + polling
共通 PreviewImage
DESIGN_ONLY editable / read-only
Description 削除後も Reference 維持
orphaned DESIGN_ONLY 非露出
```

### Phase 7C-2A-3S（Viewer 安定化・完了）

```text
same-port Viewer: upload/delete in-progress UI + 同一 key PUT/DELETE 409
Replace/Delete Dialog の stale expectedImageRevision → REVISION_CONFLICT
新規 DESIGN_ONLY 作成直後の Reference missing / upload（Description 非接触）
Reference あり画面の複製で Reference 非複製（missing）
provider / viewport / screen 移動時の Reference polling cleanup
```

### Phase 7C-2B（比較）

```text
Device Capture vs Reference の並びまたは overlay
```

### Phase 7D（Figma）

```text
Frame Import → 同一 Reference core
```

**分割推奨:** 1 → 2 → 3 を厳密に分ける。multipart と Viewer を同一 checkpoint にしない。2A-1 と 2A-2 の合併はテスト重量が増えるため非推奨。

---

## 39. リスク

| リスク | 緩和 |
|--------|------|
| Capture と path/UI 混同 | ディレクトリ・タブ文言・状態モデルを分離 |
| Description 削除で画像消失 | 自動削除しない |
| replace 競合 | expectedImageRevision |
| multipart / API 誤用 | binary-safe 最小 parser・field 契約・same-origin。依存追加なし |
| 2x export と論理 viewport 混同 | metadata で寸法を分離 |
| Git binary 肥大 | PNG 手動管理・orphan cleanup 後続 |
| DESIGN_ONLY No Preview 固定化 | hasReferenceImage / hasAnyPreview |

---

## 40. 未決事項（Viewer Phase で確定）

```text
参照タブの preferred key 文字列（reference vs reference-image）
hasAnyPreview に Device Capture のみの画面を含めるか
JPEG/WebP をいつ解禁するか
```

7C-2A-1 / 7C-2A-2 で確定済み:

```text
最大入力 PNG: 20 MiB
最大寸法: 16384 × 65536
multipart 全体 body: 21 MiB
missing DELETE: HTTP 404 SPEC_REFERENCE_IMAGE_NOT_FOUND（冪等 204 にしない）
同一 key 進行中: 409 SPEC_REFERENCE_IMAGE_IN_PROGRESS
```

---

## 41. 推奨案（最終）

```text
1. 単位は screen + viewport（PC/SP 各 0..1）。state 別・複数案は後続
2. 初期 format は PNG のみ
3. パスは spec/{project}/src/references/{screenId}/{viewport}/
4. generation image + meta.json（meta が commit point）
5. upload/replace は multipart PUT
6. replace/delete は expectedImageRevision（missing 初回は null/省略）
7. Description 削除・画面複製では Reference を消さない／コピーしない
8. DESIGN_ONLY / IMPLEMENTATION_ONLY / LINKED いずれも表示可
9. persisted に stale を持たない
10. Figma は同一 core の source.type=figma
11. Viewer 初期は [Live][PC][SP][参照]（参照内で PC/SP）
12. hasPreview は維持し、hasReferenceImage / hasAnyPreview を追加計算する
13. API は build/reload を呼ばず、meta.json の BUILD_ONLY に任せる
```

---

## 42. 最小シナリオ一覧

| # | シナリオ | 期待 |
|---|----------|------|
| 1 | DESIGN_ONLY + PC Reference | 参照タブで PC 表示。Live/PC/SP Device なしまたは No Live |
| 2 | DESIGN_ONLY + PC/SP | 参照内で両 viewport |
| 3 | IMPLEMENTATION_ONLY + Reference | Live + Capture + 参照が共存可 |
| 4 | LINKED + 三者 | preferred 保持 |
| 5 | PC のみ登録 | SP missing |
| 6 | SP のみ登録 | PC missing |
| 7 | 同一画像再 upload | unchanged。build 0 |
| 8 | 画像置換競合 | 409。勝者の画像維持 |
| 9 | 削除競合 | 409 または missing 明示 |
| 10 | Description 削除後 | Reference 維持 |
| 11 | 画面複製後 | Reference missing |
| 12 | invalid metadata | imagePath 非露出。再 upload 可 |
| 13 | read-only Viewer | 表示のみ。write なし |
| 14 | Figma import 後 | 同一 Viewer 契約で表示（7D） |

---

## 43. 現行コードとの対応（調査結果）

| 領域 | 現状 | Reference への示唆 |
|------|------|-------------------|
| Provider | `live` \| `pc` \| `sp` | `reference` を追加拡張 |
| Capture path | `captures/{screen}/{state}/{viewport}` | `references/{screen}/{viewport}`（state 無し） |
| Atomic | `write-file-atomic.ts` / Capture persist | 再利用・薄い Reference persist |
| PNG | `png-dimensions.ts` | 再利用 |
| multipart | `parse-multipart-form-data.js` | binary-safe・依存なし |
| Description CRUD | JSON のみ。assets 非接触 | Reference も自動削除しない |
| Watcher | captures の meta のみ BUILD_ONLY | references も同様 |
| DESIGN_ONLY UI | No Preview 固定 | hasAnyPreview で分岐が必要 |

---

*Phase 7C-2A-3 / 7C-2A-3S で Viewer 参照タブ・Dialog・runtime/pending と same-port 競合/作成・複製安定化まで確認。Figma・Device Capture 比較・overlay は未実装。version は変更しない。*
