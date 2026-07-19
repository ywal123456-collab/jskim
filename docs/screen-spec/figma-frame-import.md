# Figma Frame Import 設計（Phase 7D-0）

調査日: 2026-07-19（公式根拠・利用者決定の反映補正を含む）  
対象ベース: `630b207` 時点の実装調査 + Phase 7D-0 設計  
**Phase 7D-1**: companion core（`jskim-screen-spec/src/figma/`）を実装済み。
entry: `importFigmaReferenceImage` / `reimportFigmaReferenceImage`。
**Phase 7D-2**: `jskim spec dev` の Figma Import / Reimport HTTP API を実装済み（本節 §14）。
**Phase 7D-3**: Viewer Import/Reimport UI・`confirmWidthMismatch`・manifest/status の browser-safe `source` を実装済み。
実 Figma / 実 PAT の live smoke は未検証（mock のみ）。

凡例:

| 区分 | 意味 |
|------|------|
| **実装確認** | 本 repository のコード・既存設計文書で確認した事実 |
| **公式確認** | Figma 公式 Developer Docs で確認した事実（URL・確認日付き） |
| **設計提案** | 7D 実装に向けた本設計の推奨 |
| **未確認** | 公式文書または実装で未検証。断定しない |

関連文書:

- [reference-image.md](./reference-image.md)（Reference Image 契約。§35 に Figma の概略あり）
- [device-preview-capture.md](./device-preview-capture.md)（Device Capture。別ストレージ）
- [README.md](./README.md)（Screen Spec 全体契約）

---

## 1. 目的

Figma の特定 Frame を PNG export し、既存の **Reference Image** として保存・Viewer 表示・同一 source からの Reimport を可能にする機能の契約を定める。

大きな流れ（設計提案）:

```text
Figma Frame
→ Figma REST API で PNG export URL 取得
→ PNG ダウンロード・検証
→ 既存 Reference Image 保存契約へ委譲
→ Viewer で expected / 参照画像として利用
→ source metadata により Reimport
```

Figma 専用の別画像ストアは作らない（設計提案。既存 `reference-image.md` §35 と一致）。

---

## 2. 現行 Reference Image 契約

### 2-1. 保存位置とファイル名（実装確認）

| 項目 | 内容 | 根拠 |
|------|------|------|
| ルート | `spec/{project}/src/references/` | `jskim-screen-spec/src/reference-image/paths.ts`（`referencesRootDir`） |
| viewport 単位 | `{screenId}/{viewport}/`（`pc` / `sp`） | 同 `referenceViewportDir` |
| 画像 | `reference-<sha256hex>.png` | `presets.ts`（`referenceGenerationImageFileName`） |
| metadata | 同ディレクトリの `meta.json` | `referenceMetaPath` |
| Device Capture | **別パス** `spec/{project}/src/captures/...` | `device-capture`。Reference へ自動昇格しない |

### 2-2. SHA-256 / revision（実装確認）

- `imageRevision` は **単調増加カウンタではない**。PNG bytes の content hash（`sha256:<hex>`）。
- 計算: `computeContentRevision(imageBytes)`（`util/write-file-atomic.js`）。
- ファイル名 hex は revision の `sha256:` 以降。
- 同一内容の再登録は generation ファイルが既に存在すれば画像公開は no-op（`publishReferenceGenerationImage`）。
- `putReferenceImage` は metadata 比較で `result: 'unchanged'` を返し得る（`isSameReferenceContent`）。

楽観的同時更新:

- 既存 `current` を置き換えるとき `expectedImageRevision` 必須。
- 不一致は `SPEC_REFERENCE_IMAGE_REVISION_CONFLICT`。
- `missing` 時に `expectedImageRevision` を付けると conflict。

### 2-3. meta.json schema（実装確認）

`ReferenceImageMetadata`（`types.ts`）:

```ts
{
  schemaVersion: '1.0',
  screenId: string,
  viewport: { id: 'pc' | 'sp', width: number, height: number },
  format: 'png',
  imageFile: string,           // reference-<hex>.png
  imageRevision: string,       // sha256:<hex>
  imageWidth: number,
  imageHeight: number,
  uploadedAt: string,          // ISO-8601
  source: { type: 'upload' }   // 現状これのみ
}
```

検証（`validate-metadata.ts`）:

- `source` は必須。未知フィールド拒否。
- **`source.type` は `'upload'` のみ受理**（現状）。`figma` は未実装。
- `putReferenceImage` は常に `source: { type: 'upload' }` を書き込む。

### 2-4. viewport（実装確認）

- 単位は **screenId + viewport**（`pc` = 1440×900、`sp` = 375×812 プリセット）。
- Frame 幅からの自動判定はしない。呼び出し側が viewport を明示する。
- 画像の実寸（`imageWidth` / `imageHeight`）は PNG から読み取り、viewport プリセット寸法とは独立に保存される。

### 2-5. atomic write / 失敗時（実装確認）

- commit point は `meta.json` の atomic 置換（`commitReferenceImage` / `persist-reference.ts`）。
- generation PNG は `createFileAtomic`。同一 path が存在すれば no-op。
- meta 失敗時は新規公開画像の cleanup（best-effort）。既存 meta/画像は保全する方針。
- 画面単位ロック: `withReferenceImageLock`（`key-lock.ts`）。

### 2-6. 削除・旧ファイル（実装確認）

- `deleteReferenceImage` は対象 viewport の meta と画像を削除（revision 一致必須）。
- 置換時、旧 generation PNG の即時削除は必須ではない（orphan 掃除は別関心。既存設計どおり）。

### 2-7. Device Capture との関係（実装確認）

| 項目 | Reference Image | Device Capture |
|------|-----------------|----------------|
| 目的 | デザイン基準画像 | 実装のブラウザ撮影 |
| パス | `src/references/...` | `src/captures/...` |
| source | `{ type: 'upload' }` のみ | source 概念なし（`capturedAt` 等） |
| API | PUT/DELETE/GET status | POST collect / GET status |
| Viewer | 参照タブ | Live / PC / SP |
| 昇格 | なし | Capture → Reference 自動変換は **未実装** |

Capture 結果がそのまま Reference になる経路はコード上存在しない。Figma Import は **upload と並列の Reference 入力経路**として設計する（設計提案）。

### 2-8. HTTP API（実装確認）

`scripts/lib/create-reference-image-api.js`（`jskim spec dev` のみ）:

| Method | Path |
|--------|------|
| PUT | `/_jskim/spec/reference-images/{screenId}/{viewport}` multipart: `image` + 任意 `expectedImageRevision` |
| DELETE | 同 path。JSON: `expectedImageRevision` |
| GET | `/_jskim/spec/reference-images/status?screenId=&viewport=` |

制約（実装確認）:

- 最大 20 MiB（`MAX_REFERENCE_IMAGE_BYTES`）。
- PNG 署名検証。
- runtime in-memory: `idle` / `uploading` / `deleting` / `failed`。
- 同一 key 進行中: `409 SPEC_REFERENCE_IMAGE_IN_PROGRESS`。
- API は build/reload を呼ばない。`meta.json` watcher BUILD_ONLY に委譲。
- Origin チェック失敗: `SPEC_REFERENCE_IMAGE_FORBIDDEN_ORIGIN`。
- `jskim serve` / 通常 `jskim dev` では書き込み API 無効（read-only Viewer）。

### 2-9. Viewer（実装確認）

- manifest の `referenceImages.pc|sp` は `missing` / `current` / `invalid`。
- `current` に含む: `imagePath`, `imageRevision`, 寸法, `uploadedAt`。
- **`source` は Viewer manifest に未出力**（`ReferenceImageManifestEntry`）。
- UI は Upload / Replace / Delete。source 種別表示なし。
- revision conflict 後は Viewer 側で最新再読込が必要（既存 UX）。

### 2-10. 既存テスト（実装確認・抜粋）

| 領域 | 主なファイル |
|------|----------------|
| put / replace / same-hash | `test/reference-image/put-replace.test.ts` |
| delete | `test/reference-image/delete.test.ts` |
| atomic / rollback | `test/reference-image/persist-atomicity.test.ts` |
| concurrency / lock | `test/reference-image/concurrency.test.ts` |
| metadata 検証 | `test/reference-image/validate-metadata.test.ts` |
| PNG | `test/reference-image/png-validate.test.ts` |
| manifest 出力 | `test/reference-image/manifest-output.test.ts` |
| watcher | `test/reference-image/watcher-events.test.ts` |
| Viewer panel / client / UI | `test/viewer/reference-image-*.test.ts`, `use-reference-image-panel.test.ts` |
| Device Capture | `test/device-capture/*`, `test/viewer/device-capture-*.test.ts` |
| same-port / spec dev | root `test/spec-dev-integration.test.js` 等 |

---

## 3. Figma API 調査結果

確認日: **2026-07-19**（公式 Developer Docs を Web 取得）。  
非公式ブログのみでは契約を確定しない。

### 3-1. 認証（公式確認）

出典:

- https://developers.figma.com/docs/rest-api/authentication/
- https://developers.figma.com/docs/rest-api/personal-access-tokens/
- https://developers.figma.com/docs/rest-api/scopes/

| 方式 | 概要 |
|------|------|
| OAuth 2 | 他ユーザー代行・製品向け。公式はアプリ向けに推奨 |
| Plan access token | Org/Enterprise。CI 等。beta 記載あり |
| Personal Access Token (PAT) | 個人アカウント向け。ローカル tooling 向けと明記 |

PAT の渡し方（公式確認）:

- HTTP header `X-Figma-Token: <token>`
- URL query に載せない（公式は header を指示）

OAuth 例（公式 rate-limit ページの sample）では `Authorization: Bearer <token>` も示される。  
**初期実装は PAT + `X-Figma-Token` のみを対象とする**（設計提案。§4）。

必要な scope（公式確認）:

- `GET /v1/files/:key/nodes` … Tier 1、`file_content:read`
- `GET /v1/images/:key` … Tier 1、`file_content:read`
- `file_metadata:read` は metadata 専用 endpoint 用。初期 Import の必須にはしない（設計提案）

権限の上限（公式確認）:

- Scope は組織・ファイル共有権限を上書きしない。アクセスできない file は取得できない。

### 3-2. file key / node id / URL（公式確認）

出典:

- https://developers.figma.com/docs/rest-api/file-endpoints/（確認日: 2026-07-19）
- https://developers.figma.com/docs/plugins/api/properties/nodes-id/（確認日: 2026-07-19）

- file key: URL `https://www.figma.com/:file_type/:file_key/:file_name` から取得可能。
- node: `?node-id=:id` 付き URL から取得可能（GET file nodes の説明）。
- path の `:key` は file key **または branch key**。

**node ID 正規化（公式確認）:**

- Plugin API 公式 Remarks: Figma ファイル URL 上の node id は hyphen（例: `1-3`）。API 利用時は colon（例: `1:3`）へ変換する必要がある。
- REST file-endpoints の例も `ids=1:2,1:3` 形式。

したがって Import parser は URL の `node-id` が `1-3` のとき API リクエスト用に `1:3` へ正規化する（**未決ではない**）。

parser が別途検証する項目（設計契約）:

- URL query の decode（`node-id=123%3A456` 等）
- `node-id` クエリ欠落
- 空の `node-id`
- サポート外形式（数字以外の断片、不正区切り等）
- すでに colon 形式で直接入力された `nodeId`（再ハイフン化せず、正規化済みとして受理）

### 3-3. Frame / node 照会（公式確認）

`GET /v1/files/:key/nodes?ids=...`

- 指定 node の document（型・name・絶対座標等）を返す。
- nodes map の値が `null` になり得る（存在しない id 等）。
- エラー: `400`（パラメータ）、`403`（token 無効/期限切れ）、`404`（file なし）。

「FRAME 型のみ許可」は API が強制せず、**クライアント側で `document.type` を検証する**（設計提案）。

### 3-4. PNG export（公式確認）

`GET /v1/images/:key?ids=...&format=png&scale=...`

- 成功時: `images` が nodeId → **一時 URL** の map。`status` は省略され得る。
- 一時 URL の有効期限: **30 日**（公式: image assets expire after 30 days）。
- `scale`: 0.01〜4。
- 最大 32 megapixels。超過は縮小される。
- `images[id]` が `null` の場合、その node の render 失敗（非存在・不可視等）。
- エラー: `400` / `403` / `404` / `500`（unexpected rendering error）。

流れ（公式確認 + 設計契約）:

```text
1. GET /v1/images/:key → 一時 URL
2. 一時 URL へ HTTPS GET（download に X-Figma-Token を付けない）
3. PNG bytes を取得し Content-Type + PNG signature を検証
```

一時 URL の安定 host 一覧・download 時の例外的認証要否は公式に明確でない → **未確認**（§11-2 / §18）。

### 3-5. rate limit（公式確認）

出典: https://developers.figma.com/docs/rest-api/rate-limits/  
確認日: 2026-07-19（ページ記載: 2025-11-17 更新の制限が有効）

本機能が呼ぶ endpoint はいずれも **Tier 1**:

| Endpoint | Tier |
|----------|------|
| `GET /v1/files/:key/nodes` | Tier 1 |
| `GET /v1/images/:key` | Tier 1 |

公式表に基づく **運用上の参考値**（確認日: 2026-07-19。永続契約としてコードへハードコードしない。Figma は変更し得る）:

| 座席 | Starter | Professional | Organization | Enterprise |
|------|---------|--------------|--------------|------------|
| View / Collab（Tier 1） | 最大 6 回/month | 最大 6 回/month | 最大 6 回/month | 最大 6 回/month |
| Dev / Full（Tier 1） | （公式表は空欄） | 10/min | 15/min | 20/min |

注意（公式確認）:

- View / Collab の Tier 1 は **プラン横断で最大 6 回/month** になり得る。需要に応じてさらに下がる場合があると記載。
- Dev / Full の per-minute 値は上表のとおり（Starter 列は公式表で空）。数字は参考であり実装定数の正本にしない。
- PAT の rate limit は per-user / per-plan（トークン発行者単位）。
- 超過時 **HTTP 429**。
- 応答ヘッダ: `Retry-After`（秒）、`X-Figma-Plan-Tier`、`X-Figma-Rate-Limit-Type`（`low`=Collab/Viewer、`high`=Full/Dev）、`X-Figma-Upgrade-Link`。
- 公式は Retry-After 待ち再試行を推奨。ただし月次上限のように即回復しない場合は無意味な連打を避ける（§10-3）。

### 3-6. HTTP ステータス整理

| コード | 公式に確認できた意味 | 設計上の扱い |
|--------|----------------------|--------------|
| 400 | 無効パラメータ（nodes/images） | retry しない |
| 403 | file endpoints 表: developer / OAuth token が invalid または expired | retry しない。権限不足・scope 不足も 403 になり得るかは **未確認**。401 と原因を固定対応させない |
| 404 | file なし | retry しない |
| 429 | rate limit。Retry-After あり | deadline-aware の限定 retry（§10-3） |
| 500 | images の unexpected rendering error | 限定 retry（deadline 内） |
| 401 | 本調査の file-endpoints 表には明示なし | 受け取った場合は retry せず、本文・状況から `UNAUTHORIZED` / `FORBIDDEN` を選ぶ（§13） |

---

## 4. 認証と秘密情報

### 4-1. 初期バージョンの認証方式（Phase 7D 確定契約）

**初期バージョンは Personal Access Token（PAT）+ 環境変数 `JSKIM_FIGMA_TOKEN` のみをサポートする。**  
OAuth と Plan Access Token は初期範囲外。

根拠（利用者決定）:

- JSKim は現時点でローカル開発ツールである。
- 初期実装でユーザー別ログインや OAuth callback server を導入しない。

将来拡張（記録のみ・初期非実装）:

- 組織共有運用やマルチユーザー製品化時に OAuth / Plan Access Token を再検討する。

PAT 有効期限（公式確認）:

- 出典: https://developers.figma.com/docs/rest-api/personal-access-tokens/  
- 出典: https://developers.figma.com/docs/rest-api/changelog/（PAT 最大 90 日、非期限 PAT 新規作成不可の方針更新）
- 確認日: 2026-07-19
- **現在、PAT は最大 90 日の有効期限**を持つ。
- 期限切れ後は再発行し、環境変数 `JSKIM_FIGMA_TOKEN` を更新する必要がある。
- token 値は config / meta.json / manifest / ログに保存しない。

### 4-2. token の保管（確定契約）

既存 env 命名（実装確認）: `JSKIM_PDF_BROWSER`, `JSKIM_ENGINE_SPEC`。  
Figma token 名: **`JSKIM_FIGMA_TOKEN`**（同プレフィックスに整合）。

原則:

- `jskim.config.js` / `meta.json` / manifest / Git 管理ファイルに平文保存しない。
- Viewer / API request body / query に token を載せない。
- server 側のみが env を読み、Figma REST API へは `X-Figma-Token` header で送る。
- ログ・エラー・stack で token / Authorization / 署名付き download URL 全文を出さない（末尾数文字のみの mask 可）。
- README に token 実値を書かない。

### 4-3. config

任意で「Figma Import を有効にする」フラグを将来 `jskim.config.js` に置けるが、**token 自体は config に書かない**。  
初期は env があれば API 利用可、なければ `SPEC_FIGMA_TOKEN_MISSING` で拒否する。

---

## 5. Import 入力

### 5-1. 入力方式

| 候補 | 長所 | 短所 |
|------|------|------|
| fileKey + nodeId のみ | 曖昧さ少 | UX が悪い |
| Figma URL のみ | コピー&ペースト容易 | パース失敗がある |
| 両方 | 柔軟 | 実装・テスト増 |

**推奨（設計提案）: URL を第一入力とし、内部では fileKey + nodeId に正規化。高度利用者向けに fileKey/nodeId 直接指定も API で許可。**

### 5-2. URL パース（設計契約）

対応する想定パターン（branch 実動作は §18 の実地確認対象）:

```text
https://www.figma.com/design/:fileKey/:name?node-id=123-456
https://www.figma.com/file/:fileKey/:name?node-id=123-456
https://www.figma.com/design/:fileKey/:name?node-id=123%3A456
branch URL（path の key が branch key）
```

規則:

1. pathname から fileKey（または branch key）を抽出する。
2. query `node-id` を URL decode する。
3. hyphen 形式（例: `1-3`）を colon 形式（例: `1:3`）へ正規化する（§3-2 公式確認）。
4. すでに colon 形式の `nodeId` 直接入力は正規化済みとして受理する。
5. 次はエラーとする: `node-id` 欠落、空文字、サポート外形式、非 Figma ホスト、不正 path → `SPEC_FIGMA_URL_INVALID` / `SPEC_FIGMA_NODE_ID_INVALID`。
6. server-side `meta.json` には **正規化済み fileKey / nodeId** を保存する。
7. **元 Figma URL は Viewer に渡さない**。server meta への保存も初期契約では行わない（追跡が必要なら将来検討）。

### 5-3. 対象 screen / viewport（Phase 7D 確定契約）

- screenId: 現在 Viewer で開いている画面（API path で明示）。
- viewport: ユーザーが **必ず明示選択**（`pc` | `sp`）。
- Frame 幅・高さから PC/SP を **自動判定しない**。暗黙推定で既存 Reference を上書きしない。
- Frame と viewport プリセットの寸法不一致:
  - **import 禁止エラーにはしない**（初期に strict mode は導入しない）。
  - **structured warning** として API/core が返せるようにする。
  - **高さ不一致**は long page Frame として許容する。
  - **幅不一致**は Viewer UI で実際の Frame 幅と viewport 幅を示し、ユーザー確認を取る（7D-3）。
- export `scale`: 初期は **1 固定**。高解像度は将来オプション。`exportScale` は server-side source に記録する。

---

## 6. 保存構造

### 6-1. 再利用方針

**推奨（設計提案）: 既存 `putReferenceImage` / `commitReferenceImage` 経路を拡張して再利用。Figma 専用ディレクトリは作らない。**

```text
Figma PNG bytes
→ assertReferencePngBuffer（既存）
→ computeContentRevision（既存）
→ reference-<sha256>.png（既存）
→ meta.json（source を figma に拡張）
```

Figma client は **meta.json を直接書き換えない**。storage 層に PNG + source metadata を渡す。

### 6-2. 一時ファイル

| 項目 | 推奨（設計提案） |
|------|------------------|
| ダウンロード中 | OS temp または `references/.../.tmp-figma-*`（最終公開前）。project 外 temp を優先しやすくする |
| 成功後 | generation 公開 + meta atomic。temp 削除 |
| 失敗時 | temp 削除。既存 Reference 不変 |
| 同一 hash | 既存 generation 再利用（現行どおり） |
| Windows | 既存 `writeFileAtomic` / `createFileAtomic` をそのまま使用 |

### 6-3. サイズ上限

Reference API 上限 20 MiB（実装確認）に合わせる。Figma 32MP 縮小後でも 20 MiB 超なら `FIGMA_IMAGE_TOO_LARGE` / 既存 `SPEC_REFERENCE_IMAGE_FILE_TOO_LARGE` 系で拒否。

---

## 7. source metadata

### 7-1. 現状との差分

現状 `source: { type: 'upload' }` のみ（実装確認）。  
`reference-image.md` §35 は将来 `figma` を想定済みだが **コード未実装**。

### 7-2. server-side meta.json の source（Phase 7D 確定契約）

Reimport に必要な情報を **server-side `meta.json` のみ**に保持する。

```json
{
  "source": {
    "type": "figma",
    "fileKey": "<string>",
    "nodeId": "<normalized id>",
    "frameName": "<string>",
    "importedAt": "<ISO-8601>",
    "exportScale": 1
  }
}
```

| フィールド | server meta | 理由 |
|------------|-------------|------|
| type | 必須 | Reimport 可否 |
| fileKey / nodeId | 必須 | server 側 Reimport |
| frameName | 必須（取得できた場合） | UI 表示 |
| importedAt | 必須 | 最終 import 時刻 |
| exportScale | 必須 | 再現性（初期は 1） |
| 元 Figma URL | **保存しない**（初期） | Viewer 漏洩面を増やさない |
| token / email / user id / signed URL | **禁止** | 秘密・個人情報 |

### 7-3. Viewer manifest への projection（Phase 7D 確定契約）

browser 向け manifest / screen data には **最小情報のみ**を載せる。

```json
{
  "source": {
    "type": "figma",
    "frameName": "...",
    "importedAt": "..."
  }
}
```

Viewer / browser に **渡さない**:

```text
fileKey
nodeId
元 Figma URL
token
signed download URL
exportScale（初期は UI 必須でない。必要なら後続で再検討）
```

upload 互換:

```json
{
  "source": {
    "type": "upload"
  }
}
```

- 既存 `source: { type: "upload" }` の meta はそのまま有効。
- validator は `upload` | `figma` を受理。`figma` 時は server meta で fileKey/nodeId 必須。
- `uploadedAt` フィールド名は schemaVersion `1.0` 互換のためリネームしない。意味は「この Reference が現世代として確定した時刻」。

---

## 8. Import / Reimport

### 8-1. 定義（設計契約）

| 操作 | 意味 |
|------|------|
| Import | ユーザーが URL または fileKey/nodeId を指定し、現 viewport の Reference として登録/置換 |
| Reimport | **browser は fileKey/nodeId を送らない**。`screenId` / `viewport` と `expectedImageRevision` のみ送り、server が `meta.json` の `source`（figma）を読んで再 export |

### 8-2. 上書きポリシー

| 状況 | 推奨 |
|------|------|
| missing → Import | 確認なしで作成可（Upload と同様） |
| current (upload) → Import | **確認ダイアログ必須**（Viewer）。API は `expectedImageRevision` 必須で競合防止 |
| current (figma) → Import（別 Frame） | 確認のうえ置換。source を新 Frame に更新 |
| current (figma) → Reimport | 確認は軽量（または省略可）。同一 source の更新 |
| 同一 PNG hash | `unchanged`（no-op）。**imageRevision は変わらない**（content hash のため「増加」しない） |
| hash 同一で frameName のみ変化 | meta のみ更新してよい（設計提案）。revision は不変。`isSameReferenceContent` を figma フィールド対応に拡張 |
| hash 変化 | 新 generation + meta 更新。revision = 新 hash |
| Frame 削除 / null image | 失敗。**既存 Reference 保持** |
| Import 失敗（途中） | 既存保持 |
| manual upload で置換 | `source` を `{ type: 'upload' }` に戻す（Figma Reimport 情報は破棄） |
| Device Capture | Reference の source に影響しない（別ストア） |

失敗した Import/Reimport が既存の健全な Reference を壊さないことを最優先とする。

---

## 9. revision

### 9-1. 意味の再確認（実装確認）

`imageRevision` / `expectedImageRevision` = **PNG content の SHA-256**。  
カウンタ増加モデルではない。

| 操作 | revision |
|------|----------|
| 初回 Figma Import | 新 PNG の hash |
| 内容変化 Reimport | 新 hash（Viewer cache 無効化） |
| 同一 hash Reimport | 不変。`unchanged` |
| metadata のみ更新 | hash 不変。meta の `uploadedAt` / `frameName` 等のみ |
| manual upload 置換 | 新 PNG hash |
| Device Capture | Reference revision 非関与 |
| 削除 | エントリ消失 |

Viewer: `imagePath` + `imageRevision` で表示キャッシュを区別（実装確認）。  
同時更新: `expectedImageRevision` 不一致で 409。

---

## 10. ネットワーク・retry・rate limit

### 10-1. 処理段階（設計提案）

1. 入力検証（URL / fileKey / nodeId / viewport / screenId）
2. token 存在確認
3. （任意）`GET .../nodes` で type=FRAME・frameName 取得
4. `GET .../images` で PNG 一時 URL
5. 一時 URL からダウンロード
6. Content-Type / PNG signature 検証
7. サイズ上限
8. SHA-256
9. atomic 保存（既存 commit）
10. metadata / status 応答

### 10-2. timeout / サイズ（設計提案・調整可能）

| 項目 | 初期値 | 根拠 |
|------|--------|------|
| connect timeout | 10s | ローカルツールとして妥当 |
| Figma API response timeout | 30s | Tier1 render 待ち |
| image download timeout | 60s | 大画像 |
| 全体 operation deadline | 120s | API+download+保存。**retry より優先** |
| 最大ダウンロード | 20 MiB | 既存 Reference 上限に整合 |
| redirect | 最大回数制限。各 hop で HTTPS 再検証 | SSRF 緩和（§11） |

数値は後から調整可能にしてよいが、初期は定数でよい。rate limit の公式数値はここに埋めない。

### 10-3. retry（確定方針・deadline-aware）

429 を受けるたびに無条件で追加リクエストを 3 回送る設計にはしない。

**429 の最終推奨ポリシー:**

1. 応答から `Retry-After` を読む。
2. `Retry-After` が **残りの全体 operation deadline 内**に収まる場合のみ待機して再試行する。
3. `Retry-After` が残り deadline より長い場合は **自動再試行しない**（すぐ `SPEC_FIGMA_RATE_LIMITED`）。
4. 自動再試行の回数上限は最大 3 回だが、**回数より全体 deadline を優先**する。
5. View/Collab の月次上限のように即回復できないと判断できる場合（例: `Retry-After` が過大、`X-Figma-Rate-Limit-Type: low` かつ長時間待機）は、無駄な待機を避けユーザーへ rate limit エラーを返す。
6. エラー応答には `retryAfterSeconds` と、可能なら安全に精製した `planTier` / `rateLimitType` を含めてよい。
7. token、signed URL、Authorization、`X-Figma-Token`、生の upgrade URL をエラーに含めない。

利用する Figma ヘッダ（公式確認）:

| Header | 用途 |
|--------|------|
| `Retry-After` | 待機秒。deadline 判定の入力 |
| `X-Figma-Plan-Tier` | 運用・エラー付帯情報（任意） |
| `X-Figma-Rate-Limit-Type` | `low` / `high`。月次寄り制限の手がかり |
| `X-Figma-Upgrade-Link` | **Viewer へ無検証でリンク表示しない**。7D-3 で要否と URL 検証方針を決める |

その他:

| 条件 | retry |
|------|--------|
| 401 / 403 / 404 / 400 / validation | しない |
| 5xx / 一時的 network | 指数 backoff（例: 1s, 2s）。deadline 内かつ最大 2〜3 回 |
| PNG 検証失敗 / サイズ超過 / images[id]=null | しない |
| ユーザーキャンセル | 将来。初期は HTTP 切断で best-effort abort |

---

## 11. セキュリティ

### 11-1. 一般

| 脅威 | 対応（設計契約） |
|------|------------------|
| token ログ露出 | mask。リクエストダンプ禁止 |
| stack に Authorization / X-Figma-Token | fetch wrapper で header を error に載せない |
| project ファイルへ token | 禁止。env のみ |
| path traversal | 既存 `screenId`/`viewport` 検証 + path helper |
| symlink / root 逸脱 | 既存 atomic write 前提を維持 |
| 同時 Import | 既存 `withReferenceImageLock` + API `IN_PROGRESS` |
| meta/image 不一致 | 既存 commit 順序（画像公開→meta atomic）を維持。失敗時既存保全 |

### 11-2. export 一時 image URL のダウンロード（確定契約）

| 規則 | 内容 |
|------|------|
| URL 取得元 | ユーザー入力ではなく **Figma `GET /v1/images` 応答からのみ** |
| スキーム | **HTTPS のみ** |
| redirect | 回数を制限する。redirect 後も HTTPS を再検証する |
| token 付与 | image download リクエストに `X-Figma-Token` / Authorization を **付けない** |
| ログ | signed URL 全体・query string を残さない（host のみ等に制限） |
| host allowlist | 公式に安定した host 一覧が確認できていないため、**任意の単一 hostname を固定しない**（§18） |
| 応答検証 | Content-Type と PNG signature の **両方**を検証 |
| サイズ超過 | ダウンロード中断し一時ファイルを削除。既存 Reference は不変 |
| 非 PNG | 既存 `assertReferencePngBuffer` で拒否 |

---

## 12. read-only / offline

| 状況 | 応答（設計契約） |
|------|------------------|
| オフライン / DNS 失敗 | `SPEC_FIGMA_TIMEOUT` または network 系。既存 Reference 維持 |
| API timeout | 同上 |
| `JSKIM_FIGMA_TOKEN` 未設定 | `SPEC_FIGMA_TOKEN_MISSING`。UI は設定案内 |
| PAT 期限切れ / invalid token | `SPEC_FIGMA_UNAUTHORIZED`（HTTP は主に 403 と公式記載。401 もあり得るため固定マッピングしない） |
| scope 不足 / file アクセス権限不足 | `SPEC_FIGMA_FORBIDDEN`（本文・状況で判定。403 と断定しすぎない） |
| file / node なし | `SPEC_FIGMA_FILE_NOT_FOUND` / `SPEC_FIGMA_NODE_NOT_FOUND` |
| 分次・月次 rate limit / Retry-After > deadline | `SPEC_FIGMA_RATE_LIMITED`（付帯: retryAfterSeconds 等） |
| export の images[id] が null | `SPEC_FIGMA_EXPORT_FAILED`。既存 Reference 維持 |
| spec server read-only（serve 等） | Import/Reimport API 未搭載。UI 非表示（Upload と同様） |
| project 書込不可 | `SPEC_REFERENCE_IMAGE_WRITE_FAILED` 系。既存維持 |
| Reimport のみ失敗 | 既存 current を表示し続け、runtime `failed` |

read-only Viewer: Figma ボタン・API 呼び出しなし（実装確認の Reference 方針に合わせる）。

---

## 13. エラーモデル

既存 Reference は `SPEC_REFERENCE_IMAGE_*`（実装確認）。  
Figma 固有は **`SPEC_FIGMA_*`**。保存失敗は既存コードへマップする。

内部分類の柱:

```text
SPEC_FIGMA_UNAUTHORIZED   … 認証失敗（期限切れ PAT 等）
SPEC_FIGMA_FORBIDDEN      … 権限・scope・アクセス拒否
SPEC_FIGMA_RATE_LIMITED   … 分次 / 月次制限、Retry-After 超過
```

**401 と 403 を単一原因へ固定対応させない。**  
公式 file-endpoints は invalid/expired token を主に **403** と説明する。実装は HTTP status と安全に精製した Figma エラー内容からユーザー向け日本語メッセージを選ぶ。

| code | 日本語メッセージ例 | 主な状況 |
|------|-------------------|----------|
| `SPEC_FIGMA_TOKEN_MISSING` | Figma トークンが設定されていません。環境変数 JSKIM_FIGMA_TOKEN を設定してください。 | env 未設定 |
| `SPEC_FIGMA_URL_INVALID` | Figma URL が不正です。Frame のリンクを確認してください。 | URL パース失敗 |
| `SPEC_FIGMA_FILE_KEY_INVALID` | fileKey が不正です。 | 直接入力検証 |
| `SPEC_FIGMA_NODE_ID_INVALID` | nodeId が不正です。 | 欠落・空・形式不正 |
| `SPEC_FIGMA_UNAUTHORIZED` | Figma 認証に失敗しました。トークンの有効期限や再発行を確認してください。 | PAT 期限切れ / invalid |
| `SPEC_FIGMA_FORBIDDEN` | この Figma ファイルへアクセスできません。権限またはトークンの scope を確認してください。 | 権限・scope 不足 |
| `SPEC_FIGMA_FILE_NOT_FOUND` | Figma ファイルが見つかりません。 | 404 file |
| `SPEC_FIGMA_NODE_NOT_FOUND` | 指定の Frame / node が見つかりません。 | nodes null 等 |
| `SPEC_FIGMA_NODE_NOT_FRAME` | 指定の node は Frame ではありません。 | type 検証 |
| `SPEC_FIGMA_RATE_LIMITED` | Figma API の利用制限に達しました。しばらくしてから再試行してください。 | 429、Retry-After > deadline、月次上限 |
| `SPEC_FIGMA_EXPORT_FAILED` | Figma からの画像エクスポートに失敗しました。 | images[id]=null、render 失敗 |
| `SPEC_FIGMA_DOWNLOAD_FAILED` | エクスポート画像のダウンロードに失敗しました。 | download 失敗 |
| `SPEC_FIGMA_RESPONSE_INVALID` | Figma API の応答が不正です。 | malformed JSON 等 |
| `SPEC_FIGMA_IMAGE_TOO_LARGE` | 画像サイズが上限（20 MiB）を超えています。 | size limit |
| `SPEC_FIGMA_TIMEOUT` | Figma API またはダウンロードがタイムアウトしました。 | deadline / network |
| `SPEC_REFERENCE_IMAGE_REVISION_CONFLICT` | （既存）再読込を促す | |
| `SPEC_REFERENCE_IMAGE_WRITE_FAILED` | （既存）保存失敗 | |
| `SPEC_REFERENCE_IMAGE_IN_PROGRESS` | （既存）重複操作 | |

`SPEC_FIGMA_RATE_LIMITED` の JSON 付帯（設計契約）:

```json
{
  "code": "SPEC_FIGMA_RATE_LIMITED",
  "message": "…",
  "retryAfterSeconds": 12,
  "planTier": "starter",
  "rateLimitType": "low"
}
```

含めない: token、signed URL、Authorization、未検証の `X-Figma-Upgrade-Link` 生値のリンク化。

---

## 14. API（Phase 7D-2 実装）

実装: `scripts/lib/create-reference-image-api.js` + `scripts/lib/figma-reference-image-api.js`。
core は companion の `importFigmaReferenceImage` / `reimportFigmaReferenceImage` に委譲する。

既存パス慣習（`:collect` と同様のアクションサフィックス）に合わせた最終 endpoint:

### 14-1. Import

```text
POST /_jskim/spec/reference-images/{screenId}/{viewport}/figma:import
```

Request JSON（`figmaUrl` **xor** `fileKey`+`nodeId`）:

```json
{
  "figmaUrl": "https://www.figma.com/design/AAA/Name?node-id=1-2",
  "expectedImageRevision": "sha256:..."
}
```

または:

```json
{
  "fileKey": "AAA",
  "nodeId": "1:2",
  "expectedImageRevision": null
}
```

- `missing`: `expectedImageRevision` 省略可（既存 PUT と同契約）。
- `current`: 置換時は必須。
- **拒否**: `token` / `JSKIM_FIGMA_TOKEN`、URL と直接入力の同時指定、`exportScale` / `frameName` / `importedAt` の client 指定。
- トークンは **環境変数 `JSKIM_FIGMA_TOKEN` のみ**（request body / query 不可）。
- `exportScale` は server 固定（core 既定値）。request では受け取らない。

Success（既存 PUT と同様に `referenceImage` をネスト。browser-safe `source` のみ）:

```json
{
  "result": "created",
  "screenId": "...",
  "viewport": "pc",
  "referenceImage": {
    "status": "current",
    "imageRevision": "sha256:...",
    "imageWidth": 1440,
    "imageHeight": 2000,
    "uploadedAt": "..."
  },
  "frame": { "frameName": "...", "width": 1440, "height": 2000 },
  "source": { "type": "figma", "frameName": "...", "importedAt": "..." },
  "warnings": [
    {
      "code": "SPEC_FIGMA_VIEWPORT_SIZE_MISMATCH",
      "message": "Frame サイズが viewport プリセットと異なります。",
      "frameWidth": 1600,
      "frameHeight": 3200,
      "viewportWidth": 1440,
      "viewportHeight": 900
    }
  ]
}
```

レスポンスに含めない: `fileKey` / `nodeId` / 元 URL / token / signed download URL / 絶対パス / raw Figma body。

### 14-2. Reimport

```text
POST /_jskim/spec/reference-images/{screenId}/{viewport}/figma:reimport
```

```json
{
  "expectedImageRevision": "sha256:..."
}
```

- browser は fileKey/nodeId/URL/`exportScale`/`frameName`/token を送らない（送ると 400）。
- server が `meta.json` の `source.type === 'figma'` から fileKey/nodeId/exportScale を読む。
- `source.type !== 'figma'` または未登録: `SPEC_FIGMA_SOURCE_MISSING`（400）。

### 14-3. 共通

| 状況 | HTTP |
|------|------|
| success / unchanged | 200 |
| 入力不正 / token field | 400 `SPEC_FIGMA_INPUT_INVALID` 等 |
| token 未設定 | 500 `SPEC_FIGMA_TOKEN_MISSING` |
| unauthorized / forbidden | 401 / 403 |
| file/node なし | 404 |
| revision conflict | 409 `SPEC_REFERENCE_IMAGE_REVISION_CONFLICT` |
| 同一 target 進行中 | 409 `SPEC_REFERENCE_IMAGE_IN_PROGRESS`（upload/delete と共有 lock） |
| rate limit | 429 + 検証済み `Retry-After` / `retryAfterSeconds` / `planTier` / `rateLimitType` / HTTPS Figma `upgradeLink` |
| timeout | 504 `SPEC_FIGMA_TIMEOUT` |
| export/download 失敗 | 502 |
| read-only（`jskim serve` 等） | Reference API 未登録のため endpoint 自体なし（既存方針） |

runtime: `idle` / `uploading` / `deleting` / **`importing`** / `failed`。Import と Reimport は同一 key。

- client 切断時は `AbortSignal` を core へ渡し、lock を解放する。
- API は build を直接呼ばない（`meta.json` watcher → BUILD_ONLY。既存 Reference と同じ）。
- Viewer UI / manifest / GET status の browser-safe `source` は **7D-3 で実装済み**。

### 14-4. confirmWidthMismatch（7D-3）

| 項目 | 契約 |
|------|------|
| request field | `confirmWidthMismatch`（boolean、省略時 `false`） |
| 幅不一致 + `false` | Frame 取得のみ。export/download/保存なし。`result: "confirmation-required"` |
| 幅不一致 + `true` | 通常どおり Import/Reimport |
| 幅一致 | `false` でも即保存 |
| 高さのみ不一致 | 確認不要（long page） |

confirmation-required に fileKey / nodeId / URL / token は含めない。

---

## 15. Viewer UI（Phase 7D-3 実装）

現行 Preview（Live / PC / SP / 参照）を維持し、参照タブに最小追加。

実装済み:

- 「Figmaから取込」/「Figmaから再取込」（editable のみ。URL 入力のみ、token 入力なし）
- 既存 Reference 置き換え警告 / 幅不一致確認（`confirmWidthMismatch`）
- browser-safe source 表示、loading / 日本語エラー / dialog Abort
- manifest / GET status の `source` projection
- read-only では mutation 不可

やらない（継続）:

- Viewer 全体レイアウト刷新
- Figma ファイルブラウザ / OAuth / token 入力 UI
- strict mode / 実 Figma live smoke

---

## 16. テスト計画

### 16-1. Unit

- Figma URL パース（design/file、`node-id` の `-` → `:`、percent-encoding、欠落・空・不正形式）
- fileKey / nodeId validation（colon 直接入力含む）
- token mask
- deadline-aware 429 判定（Retry-After ≤ 残り deadline のみ再試行、回数より deadline 優先）
- PNG signature / size limit / 一時ファイル削除
- server source metadata 生成と Viewer projection（fileKey/nodeId 非露出）
- same-hash → `unchanged`
- FRAME 以外 type 拒否

### 16-2. Integration（mock HTTP）

実 Figma へは繋がない。

- export 成功 → download → put 成功
- 401/403/404/429/5xx
- timeout / malformed JSON / images null
- 非 PNG / 过大
- redirect 拒否ケース
- meta 更新失敗時の既存保全
- concurrent import → IN_PROGRESS / lock
- read-only で endpoint なし

### 16-3. 既存契約の回帰

- manual upload / delete / revision conflict
- Device Capture 非干渉
- Viewer refresh / pending
- Windows path
- same-port spec dev
- `source: upload` の旧 meta 読込

### 16-4. Optional live test

- デフォルト suite / CI には含めない。
- 例: `JSKIM_FIGMA_LIVE_TEST=1` かつ token / fileKey / nodeId があるときのみ。
- ログに token・署名 URL を出さない。
- 手動 smoke 用に分離。

---

## 17. 実装フェーズ

### Phase 7D-1 — core（Figma client + storage 統合）✅ 実装済み

| 項目 | 内容 |
|------|------|
| 目標 | URL parser、token 読取、Figma API client、export+download、`source: figma` 対応の put 拡張、unit/integration（mock） |
| 実装 | `jskim-screen-spec/src/figma/*`、`reference-image` の source union / put 拡張、`test/figma/*` |
| entry | `importFigmaReferenceImage` / `reimportFigmaReferenceImage` |
| 禁止（継続） | Viewer UI、HTTP route、version、publish、実 token をリポジトリへ |
| 完了基準 | mock で Import/Reimport が既存 references パスへ保存され、upload meta と共存検証済み |

### Phase 7D-2 — spec dev API

| 項目 | 内容 |
|------|------|
| 目標 | `figma:import` / `figma:reimport`、revision/read-only/in-progress、status の source、integration |
| 修正想定 | `scripts/lib/create-reference-image-api.js`（または分割）、`create-spec-dev-runtime.js`、root/companion テスト |
| 禁止 | 大きな Viewer 改修、OAuth |
| テスト | spec-dev integration + API 単体 |
| 完了基準 | editable spec dev から JSON で Import/Reimport 可能。serve では不可 |
| リスク | 長時間リクエスト中の接続切断、429 UX |

### Phase 7D-3 — Viewer UI

| 項目 | 内容 |
|------|------|
| 目標 | Import/Reimport UI、source 表示、loading/error、E2E |
| 修正想定 | `jskim-screen-spec/src/viewer/preview/*`、関連 Vue、E2E |
| 禁止 | Preview 情報アーキテクチャの全面変更 |
| テスト | viewer ユニット + Playwright E2E（既存パターン） |
| 完了基準 | 参照タブから Figma Import/Reimport ができ、失敗時に既存画像が残る |
| リスク | same-port reload と long import の競合 |

各 Phase で version bump / publish は別判断（本 7D-0 では行わない）。

---

## 18. 未決事項

次は **解決済み**（未決に戻さない）:

- node-id の hyphen → colon 正規化（公式 Plugin API Remarks + REST 例）
- 初期認証方式（PAT + `JSKIM_FIGMA_TOKEN`）
- 寸法不一致の基本政策（警告 + 幅は UI 確認、strict mode なし）
- Viewer manifest の source 最小フィールド（`type` / `frameName` / `importedAt`）

### 公式文書で未確認・要検証

1. 一時 image URL の実際の host パターン（安定 allowlist なし）。
2. image download に別途認証が必要な例外の有無。
3. file アクセス権限不足・scope 不足が HTTP 上どう区別されるか（403 固定と断定しない）。
4. 401 を file/images endpoint が返す条件。
5. Frame 以外（COMPONENT 等）を意図的に export する需要（初期は FRAME のみ）。

### 任意の運用準備

1. live test 用の専用 Figma ファイルを用意するか。
2. `X-Figma-Upgrade-Link` を Viewer に出すか（出す場合の URL 検証方針）。

### 実アカウント / token がないと検証できない事項

1. 実際の export PNG の scale=1 ピクセル整合。
2. branch key を使った images API の実動作（公式は branch key 可と記載）。
3. 実際の座席・プラン別 Tier 1 rate limit の体感（月次 6 回制限を含む）。

---

## 付録 A. 責任境界（設計提案）

| 層 | 入力 | 出力 | 責任 | 非責任 | 主なエラー | テスト単位 |
|----|------|------|------|--------|------------|------------|
| URL/input parser | 文字列 | fileKey, nodeId | 正規化・検証 | ネットワーク | URL/KEY/NODE invalid | unit |
| Figma API client | key, ids, token | JSON / 一時 URL | header 認証、429/timeout | ファイル保存 | UNAUTHORIZED, RATE_LIMITED, … | mock HTTP |
| Frame export service | 上記 + scale | PNG Buffer + frameName | nodes 検証 + images + download 統括 | meta 書込 | NODE_NOT_FRAME, EXPORT/DOWNLOAD | integration |
| PNG validation | Buffer | 寸法 | 既存 validate | Figma | INVALID_PNG, TOO_LARGE | 既存流用 |
| Reference storage | PNG + metadata | put 結果 | atomic / lock / revision | Figma API | WRITE_FAILED, CONFLICT | 既存 + 拡張 |
| source/revision update | storage 内 | meta | schema | UI | validator | unit |
| spec dev API | HTTP | JSON | read-only/in-progress/env | Viewer 見た目 | 上記のマッピング | integration |
| Viewer UI | ユーザー操作 | API 呼び出し | 確認ダイアログ・表示 | token 保管 | ユーザー向けメッセージ | UI/E2E |

---

## 付録 B. 既存設計文書との関係

`reference-image.md` §35（Figma Import）の方向性:

- 同一 meta 契約、`source.type = "figma"`、token 非保存、専用ストアなし。

本設計はそれを **現行実装（upload のみ）との差分・API・段階分割・公式 API 根拠付きで具体化**する。矛盾する場合は **実装確認を優先**し、本書と `reference-image.md` を実装 Phase で同期更新する。
