# Preview Viewport / Reference Image 方針（Phase 7C-0）

このドキュメントは、Screen Spec Viewer の **Preview Provider モデル**、**PC/SP Device Capture**、**Reference Image**、および将来の **Figma Frame Import** を受け入れ可能な構造の調査結果と詳細設計です。

**Phase 7C-0:** 調査・設計のみ（本ドキュメント）。production code / Schema / Viewer / API は変更しない。

後続詳細（Device Capture）: [device-preview-capture.md](./device-preview-capture.md)

後続 Phase:

| Phase | 内容 |
|-------|------|
| **7C-1** | Live / PC / SP タブと Playwright Device Capture（詳細は device-preview-capture.md） |
| **7C-2** | Reference Image 登録・表示 |
| **7D** | Figma Frame Import（local Reference Image 生成） |

関連:

- Screen Spec 概要: [README.md](./README.md)
- 設計先行 CRUD: [design-first-crud.md](./design-first-crud.md)
- 収集項目除外: [collected-item-exclusion.md](./collected-item-exclusion.md)
- 画面設計書削除: [screen-description-deletion.md](./screen-description-deletion.md)

調査時点のリポジトリ HEAD: `870c184`（本方針の確定改定は Phase 7C-1A-0）。

---

## 1. 背景

現行 Preview は、実装画面から収集した **snapshot HTML + 収集 CSS** を Viewer の **Shadow DOM** に注入して表示する（iframe なし）。

画面状態（union）:

| 条件 | status | Preview（現行） |
|------|--------|-----------------|
| Description のみ | `design-only` | No Preview（実装 snapshot を読まない） |
| 実装のみ | `implementation-only` | Live DOM Preview + collected items |
| 両方 | `linked` | Live DOM Preview + Description |

製品として求める Viewer 構造:

```text
[Live] [PC] [SP]
```

| タブ | 役割 |
|------|------|
| **Live** | 既存 Shadow DOM Preview。Badge・項目選択・highlight・state 切替。将来の画面設計書ベース編集・コード制御の基盤 |
| **PC** | Playwright が width 1440 で撮った画面画像。実 media query 結果の検証用（読取専用） |
| **SP** | Playwright が width 375 で撮った画面画像。同上 |

さらに同じ画面へ次を追加する予定がある:

```text
Reference Image … デザイン基準の静止画（PNG/JPEG/WebP 等）
Figma Frame Import … Frame を Reference Image + metadata として取り込む
```

本 Phase の目的は、Live DOM と Device Capture / Reference Image を **混ぜない最小モデル** を確定することである。

---

## 2. 用語

| 用語 | 定義 |
|------|------|
| **Preview Provider** | Preview の原種別。当面: `live-dom` / `device-capture` / `reference-image`（いずれも無ければ No Preview） |
| **Viewport** | Device Capture / Reference Image が紐づく論理デバイス識別子。当面: `pc` / `sp`。Tablet / Custom は将来拡張で過設計しない |
| **Device Capture** | Playwright が実際の browser viewport で生成した **静止画**（PC/SP）。Live DOM の表示幅変更ではない |
| **Preview Variant** | `Provider +（Viewport）+（Screen State）` の直交組み合わせ |
| **Screen State** | Collector / Source の画面内状態（default / error / confirm 等）。Viewport とは **別次元** |
| **display scale / fit-to-width** | Viewer パネルに画像や広い Live を収める視覚調整。**PC/SP の定義ではない** |

### 2.1 三次元の分離（確定）

```text
Provider:  live-dom | device-capture | reference-image
Viewport:  pc | sp
State:     default | error | confirm | …（Source 定義）
```

同一平面のフラット一覧に混ぜない。

---

## 3. 現行 Preview 構造

実装参照（companion）:

| 領域 | 主な場所 |
|------|----------|
| manifest 型 | `jskim-screen-spec/src/viewer/types.ts` |
| 読込・status / hasPreview | `src/builder/load-screen-spec-project.ts` |
| DomPreview | `src/viewer/components/DomPreview.vue`（Shadow DOM） |
| 収集 | `src/collector/collect-screen-spec-project.ts` |
| snapshot | `spec/{project}/src/snapshots/{screenId}/{stateId}.html` |

### 3.1 `hasPreview`（現行）

```text
hasPreview ≡ 実装があり、かつ snapshots/{screenId}/ に *.html が 1 件以上
```

`design-only` では snapshot があっても読まない。`linked` は Description ∩ Source のみで決まり、`hasPreview` は必須ではない。

### 3.2 画面あたりの現行 Preview 数

```text
Screen State ごとに最大 1 snapshot HTML
Viewport 次元・Device Capture・screenshot API は無い
```

---

## 4. 現行 State 構造

| 層 | 場所 |
|----|------|
| 定義 | `src/{project}/pages/**/*.spec.json` の `states[].id` |
| 成果物 | `spec/{project}/src/snapshots/{screenId}/{stateId}.html` |
| Viewer | `states[].id` + `snapshotFile` |

**State と Viewport は別次元（確定）。** Device Capture は state × viewport の画像を持ち得るが、Live DOM の state selector と同一配列にはしない。

---

## 5. Shadow DOM 幅変更は PC/SP ではない

### 5.1 現行レンダリング

DomPreview は **iframe を使わない**。`attachShadow` に HTML/CSS を注入する。

- `@media` / `link[media]` は **Viewer ブラウザの viewport** で評価される（Shadow ホスト幅ではない）
- `window.innerWidth` も Viewer 基準
- Playwright collect は `setViewportSize` 無し（既定 ≈ 1280×720）
- Badge は item 先頭への **inline 挿入**（`getBoundingClientRect` overlay ではない）

### 5.2 候補比較（調査結果）

| 候補 | 内容 | 結論 |
|------|------|------|
| **A. Shadow CSS width** | ホストを 375px 等に狭める | **PC/SP としては不採用**。desktop レイアウトが狭い箱に圧縮されるだけで、実 SP media query を再現しない。表示幅 / zoom 補助に留める |
| **B. iframe** | iframe 幅で media query を合わせる | **不採用（製品方針）**。Badge・将来 Live 編集と衝突しやすい |
| **C. Device Capture** | Playwright 実 viewport で画像生成 | **PC/SP の採用方式** |

### 5.3 Shadow 幅変更の位置づけ（確定）

```text
Shadow DOM の logical width / scale-to-fit は
「PC/SP」ではなく、任意の表示補助（zoom / パネル収まり）になり得る。
7C-1 の PC/SP 機能としては実装しない。
```

---

## 6. PC/SP の定義（Device Capture）

| ViewportId | Capture 時 browser viewport |
|------------|-----------------------------|
| `pc` | width **1440** / height **900**（viewport。画像 fullPage 高さは別） |
| `sp` | width **375** / height **812** |

詳細（保存パス・stale・再収集）は [device-preview-capture.md](./device-preview-capture.md)。

定数は companion 単一モジュールに集約し、散在ハードコードを避ける。custom viewport エディタは非範囲。

preset 保存:

```text
tool default
+ 任意の project config override（7C-1B で検討可）
```

Description 画面別 viewport は採用しない。

---

## 7. No-code / ローコード拡張との関係（長期原則）

```text
1. Live DOM と Description itemId の接続が、将来の直接編集・コード生成の基盤である。

2. Device Capture と Reference Image は検証用の派生成果物である。

3. Capture 画像や Figma 画像を、画面設計データの source of truth にしない。

4. 画面設計書が実コードを制御する機能を追加しても、
   PC/SP Capture は「生成結果を検証する」役割を維持する。
```

将来の想定フロー（本 Phase では Component Model / コード生成を設計しない）:

```text
Description / Component Model 修正
→ source code 生成または更新
→ Live DOM collect（snapshot）
→ PC/SP Capture 再収集
→ 結果比較（後続）
```

---

## 8. 選択状態の保持

Provider / Viewport 選択は **Viewer UI 状態**（設計データではない）。

```text
主: sessionStorage（projectName スコープ）
副: URL query（任意・共有用）
```

| 項目 | 方針 |
|------|------|
| 画面を変えても維持 | はい（同一 project セッション） |
| refresh 後 | session なら維持 |
| 別 project | 維持しない |
| Description / manifest へ保存 | **しない** |

---

## 9. Preview Provider（確定）

```text
live-dom          … Shadow DOM + snapshot HTML。Badge / 編集の基盤
device-capture    … Playwright PC/SP 画像。検証専用
reference-image   … デザイン基準画像
```

Figma Frame:

```text
import source
→ local Reference Image
→ Viewer では reference-image Provider
```

`figma-live` のような第三の最終 Provider は初期ロードマップに入れない。

---

## 10. Preview Variant と selector UI

### 10.1 選択状態

```ts
type PreviewProviderId = 'live-dom' | 'device-capture' | 'reference-image';
type ViewportId = 'pc' | 'sp';

type PreviewSelection = {
  provider: PreviewProviderId;
  /** device-capture / reference-image で使用。live-dom では不要でもよい */
  viewport?: ViewportId;
  /** live-dom / device-capture で使用 */
  stateId?: string;
};
```

### 10.2 UI（確定）

```text
[ Live | PC | SP ]     … 当面の主タブ（Live=live-dom、PC/SP=device-capture+viewport）
[ 初期状態 ▼ ]         … Screen State（複数 state 時）
（将来）参照画像タブまたは Provider 追加
```

PC/SP タブ初期では:

```text
DOM Badge なし
項目クリックなし
DOM highlight なし
直接要素編集なし
annotation なし
```

これらは **Live のみ** が担当する。

---

## 11. Live DOM Preview（役割）

```text
既存 Shadow DOM renderer を維持する
iframe を導入しない
PC/SP のためにホスト幅を「デバイス」として偽らない
Badge / 選択 / state 切替を継続
将来の設計書駆動編集の唯一の対話 Preview
```

Live 用の任意 zoom / パネル収まりは PC/SP 定義と混同しない。

---

## 12. Reference Image

役割: **デザイン基準**の補助 Preview（実装結果ではない）。

推奨ディレクトリ:

```text
spec/{project}/src/references/{screenId}/
```

Device Capture（`captures/`）とは分離する。詳細は 7C-2 と [device-preview-capture.md](./device-preview-capture.md) §28。

初期: Badge / annotation なし。Figma token は repo / Description に保存しない。

---

## 13. Figma Import との関係

```text
Figma = import source
Viewer 表示 = local Reference Image
```

Device Capture（実装結果）と Reference Image（デザイン基準）は目的が異なる。将来の PC Capture vs PC Reference 比較を塞がない metadata にする（比較 UI 自体は後続）。

---

## 14. Badge と座標

| Provider | Badge |
|----------|-------|
| live-dom | 現行 inline Badge |
| device-capture | **なし**（初期） |
| reference-image | **なし**（初期） |

annotation は後続 Phase。Figma marked node 連携も後続。

---

## 15. 画像表示（PC/SP / Reference）

```text
fit-to-width
縦スクロール
初期は zoom slider / pan / diff / annotation なし
```

長い画像はパネル内縦スクロールで耐える。

---

## 16. No Preview の再定義

将来:

```text
No Preview ≡
  Live DOM も Device Capture も Reference Image も利用できない
```

推奨フラグ:

| フィールド | 意味 |
|------------|------|
| `hasLivePreview` | snapshot HTML あり（現行 `hasPreview` 相当） |
| `hasDeviceCapture` | PC または SP 画像が 1 枚以上 |
| `hasReferencePreview` | 参照画像が 1 枚以上 |
| `hasPreview` | 互換: 上記のいずれかの OR（段階的拡張） |

---

## 17. manifest / production 配置

```text
spec/{project}/src/snapshots/     … Live DOM
spec/{project}/src/captures/      … Device Capture（詳細は別紙）
spec/{project}/src/references/    … Reference Image
spec/{project}/src/data/          … Description
spec/{project}/src/resources/     … 収集 CSS/asset
```

いずれも production `files` copy 対象外。`data-jskim-spec-*` strip 維持。

---

## 18. read-only Viewer

| 操作 | spec dev | 静的 / serve |
|------|----------|--------------|
| Live / PC / SP 表示切替 | 可 | **可** |
| Capture 再収集 | 可 | **不可** |
| Reference 追加・削除 | 可 | **不可** |
| Figma import | 可 | **不可** |

---

## 19. 画面 CRUD（概要）

| 操作 | Live snapshot | Device Capture | Reference |
|------|---------------|----------------|-----------|
| 画面作成 | なし | なし（未収集） | なし |
| 画面複製 | 複製しない | **複製しない** | 複製しない |
| Description 削除 | 触らない | **維持**（実装があれば表示可） | 初期は維持（7B-3B と整合） |

詳細は [device-preview-capture.md](./device-preview-capture.md) §26。

---

## 20. 実装 Phase（概要）

| Phase | 内容 |
|-------|------|
| **7C-1A-1** | Capture 保存・Playwright PC/SP core・atomic write・stale |
| **7C-1A-2** | spec dev Capture API・同時実行制御 |
| **7C-1A-3** | Viewer Live/PC/SP・再収集 UI・read-only |
| **7C-1B** | viewport config / 任意 auto recapture（省略可） |
| **7C-2** | Reference Image |
| **7D** | Figma → Reference |

---

## 21. リスク（Preview モデル）

| リスク | 緩和 |
|--------|------|
| Shadow 幅変更を PC/SP と誤解 | 本ドキュメントで明確に分離。7C-1 では採用しない |
| Capture 費用・state×viewport 爆発 | 手動再収集中心・初期は単一 viewport 単位（別紙） |
| hasPreview 意味変化 | フラグ分割と文言更新 |
| Figma token 漏洩 | 保存禁止 |
| iframe 再提案 | 製品方針で拒否。必要なら Capture で足りるか先に検証 |

---

## 22. 未決事項

Device Capture 固有の未決は [device-preview-capture.md](./device-preview-capture.md) §35。
本紙では:

```text
Reference Image の既定拡張子
7C-2 の hasPreview OR 拡張の具体フィールド名
Tablet viewport の時期
```

---

## 23. 推奨案（最終・確定）

```text
iframe は使用しない。

Live DOM:
  既存 Shadow DOM renderer を維持する。
  Badge / 項目選択 / state / 将来の直接編集基盤。

PC/SP:
  Playwright の実際の browser viewport で生成する Device Capture 画像。
  読取専用の検証 Preview。
  Live DOM の表示幅変更ではない。

Viewer:
  [Live] [PC] [SP] タブ（+ 将来 Reference）。

Reference Image:
  別 provider（デザイン基準）。

Figma:
  local Reference Image を生成する import source。
```

### 初期仮説の再評価

| 旧仮説（幅変更） | 評価 |
|------------------|------|
| Shadow logical width を PC/SP にする | **棄却**（media query 非再現） |
| scale-to-fit を PC/SP の本体にする | **棄却**（表示補助に格下げ） |
| iframe で media query を合わせる | **棄却**（製品方針） |
| Device Capture 画像 | **採用** |

### 具体例

| ケース | 表示 |
|--------|------|
| Live | Shadow DOM + Badge |
| PC 最新 | 1440 viewport の Capture 画像 |
| SP 未収集 | 未収集 UI + 再収集導線 |
| Reference / PC | デザイン基準画像 |
| Live + Capture + Reference | Provider/タブ切替 |
| DESIGN_ONLY + Reference のみ | 参照画像（Capture/Live なし） |
| No Preview | いずれも無い |

---

## 付録 A. 調査で確認したコード事実

```text
DomPreview: Shadow DOM のみ。iframe なし
Badge: inline insertBefore
hasPreview: snapshots.length > 0（実装あり時）
snapshot: spec/{project}/src/snapshots/{screenId}/{stateId}.html
Playwright: newPage() のみ。setViewportSize なし。screenshot API なし
```

## 付録 B. 非範囲

```text
production code / Schema / Viewer / Collector / API の実装
Capture 画像の生成
iframe 導入
custom viewport エディタ / annotation / Figma 認証
```
