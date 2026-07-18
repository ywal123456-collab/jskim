# Device Preview Capture 方針（Phase 7C-1A-0 / 7C-1A-1）

このドキュメントは、Screen Spec の **PC/SP Device Capture**（Playwright 実 viewport 画像）の保存モデル・状態・再収集 lifecycle の調査結果と詳細設計です。

| Phase | 状態 |
|-------|------|
| **7C-1A-0** | 調査・設計（文書） |
| **7C-1A-1** | **完了** — Device Capture **core**（内部 API・atomic 保存・inputRevision / status）。HTTP Capture API / Viewer Live・PC・SP タブは未実装 |

親方針（Provider モデル）: [preview-viewport-reference-image.md](./preview-viewport-reference-image.md)

---

## 1. 背景

Live DOM Preview（Shadow DOM + snapshot HTML）は、項目 Badge・選択・将来の設計書駆動編集の基盤として維持する。

一方、実サイトの `@media` / `window.innerWidth` に依存するレイアウトは、Shadow ホスト幅の変更では再現できない（詳細は親文書 §5）。

したがって PC/SP は次とする:

```text
Playwright が実際の browser viewport で生成した Device Capture 画像
```

Viewer タブ:

```text
[Live] [PC] [SP]
```

---

## 2. 目的

```text
1. Live DOM と Device Capture の責任を分離する
2. Capture のディレクトリ / metadata / stale 契約を決める
3. 手動再収集を中心とした lifecycle を決める
4. 7C-1A-1〜3 の実装分割を確定する
5. Reference Image / Figma と比較可能なが混ぜない構造にする
```

非目的:

```text
iframe 導入
Shadow 幅を PC/SP と偽る
完全な visual regression プラットフォーム
コード生成 / Component Model 設計
```

---

## 3. Live DOM との役割分担

| | Live DOM | Device Capture (PC/SP) |
|--|----------|------------------------|
| 原データ | snapshot HTML + 収集 CSS | Playwright screenshot 画像 |
| media query | Viewer 基準（限界あり） | Capture 時 viewport で評価済み |
| Badge / 項目クリック | **あり** | **なし**（初期） |
| highlight / 直接編集 | 将来含め Live 側 | なし |
| 用途 | 設計・編集・itemId 接続 | 実装結果の検証 |

**確定:** Capture 画像を画面設計の source of truth にしない。

---

## 4. No-code 拡張との関係

親文書 §7 と同原則:

```text
設計変更 →（将来）コード生成 → Live collect → Capture 再収集 → 比較
```

設計 JSON の文言・itemOrder・除外変更だけでは Capture を自動再収集しない（§18）。

---

## 5. 現行 Collector

実装: `jskim-screen-spec/src/collector/collect-screen-spec-project.ts`

```text
scan Source *.spec.json
→ Chromium 1 回 launch
→ screen × state を直列処理
→ 各 state: newPage → goto → actions → CSS/HTML をメモリ蓄積
→ 全成功後に snapshot / Description merge / resources を書込
→ browser.close
```

CLI 入口: `scripts/lib/run-screen-spec-collect.js`

```text
preserve build → OS TEMP outputDir
→ 127.0.0.1 静的 server
→ collectScreenSpecProject({ baseUrl })
→ TEMP 削除
```

watch（`create-spec-dev-orchestrator.js`）:

| kind | 動作 |
|------|------|
| `COLLECT_AND_BUILD` | collect → viewer build |
| `BUILD_ONLY` | Description/theme 変更時。**collect なし** |
| `IGNORE` | snapshots / resources / dist 等 |

**screenshot API は現行コードに存在しない。**

---

## 6. 現行 Playwright 実行

| 項目 | 現行 |
|------|------|
| Browser | `chromium.launch({ headless: true })` を collect 実行につき 1 回 |
| Context | `browser.newContext()` **未使用** |
| Page | **state ごとに** `browser.newPage()` → `finally` で `page.close()` |
| Viewport | `setViewportSize` **なし**（既定 ≈ 1280×720） |
| 遷移 | `page.goto(url, { waitUntil: 'load' })`。`networkidle` なし |
| URL | `http://127.0.0.1` のみ。`screen.path` は `/` 始まり |
| Actions | `runCollectActions` 直列（click/check/fill/select/wait） |
| wait | 明示 `wait` のみ（上限 30000ms）。font/image/animation 待ちなし |
| Cookie / storage | **未処理**。各 state はクリーン page |
| 並列 | screen/state とも直列。watch queue も単一実行 |
| 失敗 | 例外で collect 全体中断（その run の pending 書込なし） |

State 再現: 毎回同一 route へ goto → Source 定義の collect actions を再実行。

---

## 7. Device Capture

定義:

```text
screenId + stateId + viewport(pc|sp)
に対する Playwright 静止画 + metadata
```

Provider: `device-capture`
Viewport: `pc` | `sp`
State: Source の stateId

---

## 8. PC/SP Preset

| | width | height（browser viewport） |
|--|-------|---------------------------|
| **PC** | 1440 | 900 |
| **SP** | 375 | 812 |

`height` は viewport の初期窓。**最終画像高さ（fullPage）とは別**。`imageHeight` は metadata に記録する。

定数は単一モジュールへ集約。project override は 7C-1B。

---

## 9. Capture 形式

| 形式 | 評価 |
|------|------|
| **PNG** | テキスト鮮明・透過可・Playwright 標準。**初期固定推奨** |
| JPEG | 小さいが文字に劣化する。非推奨を初期既定にしない |
| WebP | サイズ有利だが環境差。後続で任意化検討可 |

**初期:** PNG 固定。format 抽象化フレームワークは作らない。

---

## 10. 保存ディレクトリ

**推奨パス（確定）:**

```text
spec/{project}/src/captures/{screenId}/{stateId}/{viewportId}/
  capture-<sha256hex>.png
  meta.json
```

例:

```text
spec/sample/src/captures/inquiry-input/default/sp/
├─ capture-9a52f4....png
└─ meta.json
```

名称: **`captures`**。

**非採用:** 固定名 `pc.png` + `pc.json` の同時上書き（2 ファイルを atomic に置換できない）。

分離対象:

```text
snapshots/     … Live HTML
resources/     … CSS/asset
references/    … デザイン基準画像
src/{project}/assets … production に流れやすいため禁止
```

---

## 11. Metadata と atomic commit

### 11.1 meta.json（確定）

```json
{
  "schemaVersion": "1.0",
  "screenId": "inquiry-input",
  "stateId": "default",
  "viewport": {
    "id": "sp",
    "width": 375,
    "height": 812
  },
  "format": "png",
  "fullPage": true,
  "deviceScaleFactor": 1,
  "inputRevision": "sha256:...",
  "imageFile": "capture-9a52f4....png",
  "imageRevision": "sha256:...",
  "imageWidth": 375,
  "imageHeight": 1840,
  "capturedAt": "2026-07-18T00:00:00.000Z"
}
```

`imageFile` は **basename のみ**（`../`・絶対パス・URL・他 viewport 参照は拒否）。

### 11.2 commit point

```text
1. TEMP PNG 生成 → 検証 → imageRevision
2. revision-addressed 最終ファイル名へ rename（未存在時）
3. meta.json を writeFileAtomic で置換 ← **ここが commit point**
4. meta が指さない旧 generation PNG を best-effort cleanup
```

有効な Capture = 正常 `meta.json` + それが指す正常 PNG。
metadata 置換前は既存 Capture が有効のまま。

### 11.3 Capture 中の入力変化

```text
inputRevisionBefore → Capture → inputRevisionAfter
不一致 → 保存せず abort（SPEC_DEVICE_CAPTURE_INPUT_CHANGED）
既存 Capture 維持 / TEMP 掃除
```

日本語メッセージ例: 「収集中に画面またはリソースが変更されました。最新の状態で再度収集してください。」

### 11.4 同一結果 no-op

`inputRevision` / `imageRevision` / viewport / 政策が同一なら write しない（`capturedAt` も更新しない）。

---

## 12. inputRevision

persisted 名称は **`inputRevision`**（旧称 `inputRevision` は使わない）。

意味:

```text
JSkim がプロジェクト内部で知っている、
当該 Capture の決定可能な入力集合に対する SHA-256
```

含める最小入力:

```text
screenId / stateId
route と state action 定義（canonical JSON）
当該 state の snapshot HTML bytes
参照 resource の content-hash（logical path 昇順）
viewport id / width / height
fullPage / format / deviceScaleFactor
capturePolicyVersion
```

含めない:

```text
capturedAt / 出力 PNG bytes / TEMP・絶対 path
browser executable / token / cookie
```

出力 PNG は別途 **`imageRevision`**（PNG bytes の sha256）。

限界（明示）:

```text
inputRevision 一致 ≠ 外部 API・日時・乱数・サーバ session まで同一
自動検知できない変化は手動再収集で対応
```

mtime は使わない。

---

## 13. stale 判定

| 状態 | 条件 |
|------|------|
| missing | meta.json なし |
| current | meta/image 正常かつ inputRevision 一致 |
| stale | 正常だが inputRevision 不一致 |
| invalid | malformed / 画像欠落 / hash 不一致 / 契約違反 |

```text
inputRevision 一致 → プロジェクト内の既知入力が同一
inputRevision 不一致 → 更新必要
一致しても外部 runtime データ同一は保証しない
```

---

## 14. Capture 状態

### Persisted

```text
meta.json + generation PNG（inputRevision / imageRevision）
```

### Runtime（repo に書かない）

```text
collecting / error / job id
```

失敗時: 旧正常 Capture を残す。壊れた画像で上書きしない。

---

## 15. 手動再収集

Viewer:

```text
[Live] [PC] [SP]      [Previewを再収集]
```

基本動作:

```text
現在 screenId
現在 stateId
現在選択 viewport（PC または SP）
```

### Live タブでのボタン

**推奨: ボタンを隠す（または disabled + 説明）。**

理由: Live は snapshot collect（既存 `spec collect` / watch）の世界。Device Capture 再収集と混同しやすい。

代替（非推奨優先）: 「最後に開いた device タブ」を再収集 — 暗黙的で分かりにくい。

---

## 16. 自動再収集

| 方針 | 評価 |
|------|------|
| source 変更で即 PC/SP 全自動 | 遅延・コスト・不完全画面 capture。初期非推奨 |
| **stale 表示のみ + 手動再収集** | **初期採用** |
| debounce 自動（config） | 7C-1B 以降のオプション候補 |

watch が `COLLECT_AND_BUILD` で snapshot を更新したあと:

```text
Capture は自動では撮らない
inputRevision 再計算 → Viewer が stale 表示
```

---

## 17. 再収集対象

### 初期実装範囲（確定）

```text
現在 screen × 現在 state × 現在 viewport
のみ
```

### 将来 dropdown（後続）

```text
現在 Preview
現在 state の PC+SP
現在画面の全 state
全 state × viewport
プロジェクト全体（CLI 側が自然）
```

プロジェクト全体は既存 `jskim spec collect` 拡張または別 CLI を後続検討。

---

## 18. 再収集対象 / 非対象の変更

### Capture を stale にする（snapshot/resource/preset 経由）

```text
source HTML / Nunjucks / Vue
CSS / JS（収集結果に影響）
image / font
state collect actions 設定
viewport preset
```

### Capture と無関係（自動再収集しない）

```text
screen name / description
item description / note / itemOrder
manual item CRUD
collected item 除外・復元
Description 複製・削除
```

将来コード生成が入る場合:

```text
設計変更 → 生成コード → inputRevision 変化 → stale
（設計 JSON 直書きだけでは Capture を触らない）
```

---

## 19. API

`spec dev` 専用・same-origin。候補:

```http
POST /_jskim/spec/device-captures:collect
Content-Type: application/json
```

```json
{
  "screenId": "inquiry-input",
  "stateId": "default",
  "viewport": "sp"
}
```

REST 風パス `.../{screenId}/{stateId}/{viewport}` も可だが、将来 batch を足すなら **collect アクション型** が拡張しやすい。

静的 Viewer / 通常 serve では無効。既存 Description API と同様の origin / body 制限。

本 Phase では実装しない。

---

## 20. Job / 同期処理

| 方式 | 評価 |
|------|------|
| POST 完了まで待機 | 単一 capture なら単純。browser 起動・font 待ちで数十秒になり得る |
| 202 + jobId + polling/SSE | batch・長時間向き。実装コスト増 |

**初期推奨:** 単一 capture は **同期 POST（タイムアウト長め）**。
将来 batch または体感が悪い場合に 202 job へ拡張。外部 queue / webhook は使わない。

---

## 21. 同時実行

同一 key（screenId, stateId, viewport）:

```text
推奨: 直列化（lock）。二番目は完了待ちまたは 409 Conflict
前 job キャンセルは初期非対応（複雑）
```

異なる key:

```text
project 単位 concurrency limit（初期 1 を推奨）
Playwright browser 多重起動を避ける
```

既存 `createSpecTaskQueue`（collect/build 単一）と整合させ、Capture job も **project 内で直列** が安全。

---

## 22. State 再現

**推奨:** 既存 Collector と同様に **実 route を再実行**する。

```text
TEMP preserve build + 127.0.0.1 server（既存 runScreenSpecCollect と同型）
→ setViewportSize(pc|sp)
→ goto(screen.path)
→ 当該 state の collect actions
→ screenshot
```

snapshot HTML を単独で「画像化」する方式は:

```text
media query / 実 CSSOM / 実 JS と乖離しやすい
→ 初期非推奨
```

コスト: 画面ごとに build server 相当が必要（単一 capture API でも短命 server または spec dev の既存 server を再利用する設計が必要 — 実装 Phase で決める）。

---

## 23. Capture 安定化（初期保証範囲）

初期にやる（7C-1A-1 実装）:

```text
BrowserContext viewport（pc|sp）
waitUntil: load（現行踏襲）
明示 wait action（Source 定義）
document.fonts.ready
images: load/error 待ち
Capture 直前に animation/transition を 0s にする style 注入
screenshot: fullPage PNG + animations: 'disabled'
deviceScaleFactor: 1（isMobile / touch / UA 変更なし）
```

初期に保証しない（過設計回避）:

```text
完全 networkidle（持続 polling 画面で timeout しやすい）
Date/random 固定
API mock 基盤
広告・外部 iframe
video/canvas 安定化
visual regression 差分エンジン
```

---

## 24. Viewer Tabs

```text
タブ UI は常に表示（利用可能なもの）
レンダラは選択中 provider のみ mount（lazy）
PC/SP 画像は選択時に load（browser cache 可）
```

| 項目 | 方針 |
|------|------|
| provider 間で state 維持 | **はい** |
| 画面移動後も provider 維持 | **はい**（sessionStorage） |
| refresh 後 | sessionStorage で維持 |
| タブ切替時の scroll | provider ごとに記憶できればなおよい。初期はベストエフォート |
| project スコープ | sessionStorage キーに projectName |

---

## 25. Image Renderer

初期:

```text
fit-to-width
縦スクロール
比率維持
zoom UI なし
```

Device Capture と Reference Image で **共通化できるもの:**

```text
image load / エラー UI / fit-to-width / 縦スクロール / viewport ラベル
```

**分離するもの:**

```text
inputRevision / stale / 再収集（Capture）
import source / upload（Reference）
```

plugin フレームワークは作らず、薄い共有コンポーネント + 薄い wrapper で足りる。

---

## 26. read-only

静的 Viewer:

```text
Live / PC / SP 表示可
再収集・削除・config 変更は不可
```

build 時: `spec/{project}/dist` へ captures をコピー（snapshots と同様）。production app `dist/{project}` には含めない。

---

## 27. 画面 CRUD

| 操作 | Capture |
|------|---------|
| 画面作成 | なし → 未収集 |
| 画面複製 | **複製しない** → 未収集 |
| DESIGN_ONLY 削除 | 通常 Capture 無し。孤児があれば残す（自動削除しない） |
| LINKED Description 削除 | **Capture 維持**（IMPLEMENTATION_ONLY で表示可） |
| implementation 削除 | 後続 cleanup（本範囲外）。孤児表示 or 明示掃除 |

Description DELETE と Capture DELETE は **束ねない**（7B-3B 契約と整合）。

---

## 28. State 削除

stateId 消滅・rename で Capture ディレクトリが孤児になり得る。

**初期安全策:**

```text
自動削除しない
Viewer / build は「未知 state」として無視または警告
明示的 cleanup（後続 CLI/UI）
```

---

## 29. Reference Image

| | Device Capture | Reference Image |
|--|----------------|-----------------|
| 目的 | 実装結果 | デザイン基準 |
| 生成 | Playwright | upload / Figma |
| stale | inputRevision | なし（または手動差替） |
| パス | `captures/` | `references/` |

将来比較（PC Capture vs PC Reference）を塞がないよう、viewport キーを揃える。比較 UI は後続。

---

## 30. Figma

```text
Figma Frame → Reference Image
Device Capture とは別物
```

---

## 31. Atomic Write

推奨単位: **viewport ディレクトリまたはファイル対（png+json）**

```text
1. TEMP に image 書込
2. metadata 生成・検証
3. 両方揃ってから rename で本番パスへ置換
4. 失敗時 TEMP 削除。旧 png+json を残す
```

避ける:

```text
新 png のみ / 旧 json
新 json のみ / 旧 png
```

Windows の `rename` 置換制約は既存 `writeFileAtomic` / `replaceDirAtomic` パターンに合わせる。

---

## 32. Git 管理

| 候補 | 評価 |
|------|------|
| **基本 Git 管理** | 静的 Viewer 共有・レビュー・納品に向く。**Screen Spec の納品用途では推奨** |
| 基本 ignore | CI 再生成前提。オフライン納品に弱い |
| config 選択 | 後続で可 |

binary 増加は PNG + 手動再収集（自動連打しない）で抑える。

---

## 33. Production 分離

```text
captures は Screen Spec 専用
production files pipeline の copy 対象外
preserve/strip 結果に影響しない
```

---

## 34. 実装 Phase

### Phase 7C-1A-1（実装済み）

```text
captures/ 契約（generation PNG + meta.json）
inputRevision / imageRevision / status（missing|current|stale|invalid）
Playwright PC/SP 単一 capture core（BrowserContext viewport + fullPage PNG）
実 route 再実行 + 既存 collect actions 再利用
fonts/images 待機・animation 無効化（networkidle なし）
meta.json atomic commit + orphan generation cleanup
同一結果 no-op / 失敗時は既存 Capture 維持
project 単位 Capture queue
内部 API: collectDeviceCapture / getDeviceCaptureStatus
（HTTP API・Viewer タブなし。既存 collect は自動 Capture しない）
```

実装: `jskim-screen-spec/src/device-capture/`

### Phase 7C-1A-2（未実装）

```text
spec dev POST collect API
runtime collecting / error
同一 key / API リクエスト直列化の公開面
watcher 後は stale のみ（自動 capture なし）
BUILD への captures コピー
```

### Phase 7C-1A-3

```text
Viewer [Live][PC][SP]
image renderer
状態表示（未収集/最新/stale/中/失敗）
現在 capture 再収集ボタン
sessionStorage
read-only 表示
```

### Phase 7C-1B（任意）

```text
project viewport config
optional debounce auto recapture
再収集範囲 dropdown
```

**分割必須:** capture core（1）と API（2）と Viewer（3）。
1+2 を同一 checkpoint にするとテストが重いが、**UI 無しの 1 を先に固める**のが安全。

---

## 35. リスク

| リスク | 緩和 |
|--------|------|
| Capture コスト | 手動・単一 viewport・project 直列 |
| font/OS 差 | DPR=1・保証範囲を文書化 |
| stale 計算漏れ | snapshot+resource+viewport 寸法 |
| 途中失敗で壊れた画像 | atomic・旧版保持 |
| Git binary 肥大 | PNG・手動再収集・必要なら後続 WebP |
| 実 server 依存 | TEMP build 再利用設計を 7C-1A-1 で検証 |
| Live と Capture の混同 | タブ文言・Live では再収集ボタン非表示 |

---

## 36. 未決事項

```text
spec dev 既存 server を Capture に再利用するか、短命 server を都度立てるか
images 待ちの具体セレクタ範囲
deviceScaleFactor を metadata 必須にするか
同期 POST のタイムアウト秒数
孤児 Capture の警告 UI 文言
7C-1B auto recapture の debounce 既定
```

---

## 37. 推奨案（最終）

```text
形式: PNG fullPage
パス: spec/{project}/src/captures/{screenId}/{stateId}/{viewport}/capture-<hash>.png + meta.json
Preset: PC 1440×900 / SP 375×812（viewport）
inputRevision: 既知プロジェクト入力の SHA-256（外部 runtime は保証外）
自動再収集: しない（stale 表示 + 手動）
初期再収集範囲: 現在 screen/state/viewport
API: POST device-captures:collect（同期、後で job 拡張可）
同時実行: project 直列
失敗: 旧 Capture 保持
Git: 基本コミット対象
Live: Shadow 維持・iframe なし・再収集ボタン非表示
PC/SP: Badge なしの検証画像
```

### シナリオ

| シナリオ | 結果 |
|----------|------|
| Live | Shadow + Badge |
| PC 最新 | 画像表示 |
| SP 未収集 | 未収集 + 再収集 |
| PC stale | 旧画像 + 更新必要 |
| SP 収集失敗 | 旧画像維持 + エラー |
| 現在 SP 再収集 | SP のみ更新 |
| source 変更後 | stale（自動撮影なし） |
| LINKED Description 削除 | Capture 維持 |
| 画面複製 | Capture なし |
| state 削除 | 孤児は自動削除せず |
| read-only | 表示可・再収集不可 |

---

## 付録. fullPage 選定

| 方式 | 評価 |
|------|------|
| **`page.screenshot({ fullPage: true })`** | 長いフォームに耐える。**初期採用** |
| viewport 高さのみ | 折りたたみ確認には有用だが全体検証に不足 |
| 特定 root element | screen root と一致しやすいが sticky/fixed 背景が欠ける場合あり。後続オプション |

fixed / sticky / modal は fullPage でも完全ではないことを文書化し、初期保証範囲に入れすぎない。
