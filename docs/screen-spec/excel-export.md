# Screen Spec Excel Export 設計

この文書は、JSKim Screen Spec データを **日本語納品用 Excel（`.xlsx`）へ片方向 Export** するための調査・設計である。
**実装は Phase 7F**（ローカル版管理の後）。本文書単体では production 未実装。

**v1 は Export のみ**。既存の手作業による画面設計書の Import、Excel 修正の再取込、Nunjucks / Vue source への自動 patch は対象外とする。

| 項目 | 値 |
|------|-----|
| 状態 | 設計（未実装） |
| 実装 Phase | **7F-1〜7F-3**（版管理は [local-version-control.md](./local-version-control.md) の 7E） |
| 対象 package | companion `@ywal123456/jskim-screen-spec` + root CLI `jskim spec export` |
| 参考 | 既存の手作業による画面設計書（構造・視覚規則のみ参照。workbook 自体は template として複製しない） |
| 基本設計単位 | **Screen**（Feature は分類・出力束ね。内部 entity を置換しない） |

---

## 1. 目的

- Screen Spec の確定済みデータ（Description / Source / Feature Group / Reference Image / Device Capture、および版管理 revision）から、**顧客・社内へ渡せる日本語の画面設計書 workbook** を生成する。
- 出力 scope は **Screen / Feature / Project** の 3 種（いずれも中身の基本単位は画面設計シート）。
- 既存の手作業文書と **見た目の共通言語**（A4 横、色、表見出し）を共有しつつ、**クリーンな新規 workbook** をゼロから組み立てる。

## 2. スコープ（Export v1 / Phase 7F）

- `jskim spec export`（`--format xlsx`）による片方向 Export
- Screen / Feature / Project scope、および `--revision`（版管理導入後）
- 改訂履歴シートは **ローカル版管理の commit log** から生成（export 実行時刻の捏造ではない）
- 画面ごとの `画面設計` シート、Project 時は `機能一覧`
- PC / SP の参照画像・実装キャプチャ埋め込み（存在する範囲）
- 項目定義表（`itemOrder` 順）と interaction（遷移・外部 URL）の要約
- atomic write、日本語エラー、secret / path 非露出
- companion 内 domain / renderer + root CLI 薄い接続

## 3. 非目標（Export v1）

- 既存の手作業 Excel の Import
- Excel → Description / Source の双方向同期
- 設計書編集 → Nunjucks / Vue / Screen Spec attribute の自動挿入
- API 業務規則・入力検証ルール・処理フローの **推測生成**
- 画像上への任意座標 marker / コネクタ線の自動描画（安定 bbox が無いため）
- 他社フォーマットの網羅サポート
- byte-for-byte 同一 xlsx（ZIP / Core Properties 時刻の完全固定は非保証）
- VBA / macro / external workbook link
- Figma token / fileKey / nodeId / signed URL の記載
- Feature を内部の基本設計 entity として扱うこと（Excel の束ね方と混同しない）

将来の制限的 Import を検討する場合でも、**JSKim が生成した workbook にのみ** `schemaVersion` と stable ID を埋め込む **別 Phase** とする。本設計の v1 には含めない。

---

## 4. 参考Excelの分析

既存の手作業による画面設計書を **構造調査のみ** 実施した（値・個人情報・契約情報は設計へ転記しない）。
当該文書は **Feature Export（機能に属する複数画面を 1 workbook にまとめる）の参考例** として分類する。JSKim 内部の基本 entity を機能単位へ置き換える根拠にはしない。

### 4.1 構造サマリ（確認値）

| 項目 | 観測 |
|------|------|
| シート数 | 11（改訂履歴 1 + 画面設計 5 + 処理設計 5） |
| 画像 | embedded media 19 |
| 印刷 | paperSize=9（A4）、orientation=landscape、showGridLines=0 |
| used range | 画面設計で概ね `A1:BS*`。処理設計の一部は `DB` 列まで広い |
| マージ | 画面設計シートに数十〜百超。処理設計は 0 |
| definedName | 多数。うち `#REF!` を含む壊れた名前が半数前後 |
| VBA | なし |
| 図形 | drawing 多数。コネクタ（`cxnSp`）は一部のみ |

### 4.2 セクション構成（画面設計）

典型的な見出し階層（ラベル構造）:

1. 基本情報（システム名 / 画面名 など）
2. 概要
3. 画面出力イメージ（PC / SP）
4. 画面表示項目定義（No / 項目名 / リンク / 必須 / 属性 / 文字数 など）
5. 処理説明（処理概要、API 一覧、入力チェック詳細、エラーメッセージ）

### 4.3 セクション構成（処理設計）

Input / Process / Output の三層。API 名・遷移・チェック詳細を手書きで維持している。

### 4.4 採用する視覚規則

- A4 landscape、gridline 非表示
- 薄い緑（参考: `FF92D050` 系）を section / table header に使用
- 入力制約・検証ヘッダには薄いオレンジ系を割り当て可能（v1 で検証列が空でも枠だけ用意しない）
- 細い黒ボーダーの表、wrap text、日本語可読フォント（例: `Yu Gothic` / `Meiryo` / `Yu Gothic UI` の順でフォールバック）
- PC / SP 画像を別枠で配置

### 4.5 意図的に捨てる legacy

- definedName / `#REF!` 名の継承
- BS/DB までの無意味に広い used range
- 数百マージセルへの依存
- コネクタ線・自由図形による番号導線の再現
- printer binary / 個人名 / 顧客固有文字列 / ローカル絶対パス
- 実データが無い API・検証・IPO のプレースホルダ大量生成
- 参考 workbook のメディア・セル値のコピー

---

## 5. 現行データ契約

### 5.1 Source of truth

| データ | 場所 | 備考 |
|--------|------|------|
| project 名 | `jskim.config.js` の project + manifest `projectName` | |
| Description | `spec/{project}/src/data/{screenId}.json` | schema 1.0 / 1.1 / 1.2（読込互換。保存は 1.2） |
| Source | `src/{project}/pages/**/*.spec.json` | `screen.id` / `path` / `states` / `interactions` |
| Viewer ScreenData | `spec/{project}/dist/data/screens/*.json` | collect+build 成果（正本ではない） |
| Manifest | `spec/{project}/dist/data/manifest.json` | 画面一覧・status（正本ではない） |
| Snapshot HTML | `spec/{project}/src/snapshots/{screenId}/{stateId}.html` | Preview 正本 |
| Reference Image | `spec/{project}/src/references/{screenId}/{pc\|sp}/` | meta + PNG。dist 公開 path は `reference-images/...` |
| Device Capture | `spec/{project}/src/captures/{screenId}/{stateId}/{pc\|sp}/` | meta + PNG。Viewer では state の `deviceCaptures` |

### 5.2 Description item（v1.2）

各 item: `name`, `type`, `description`, `note` のみ。
**必須 / 最小・最大文字数 / 入力形式 / 動的表示変数** の構造化フィールドは **存在しない**。

### 5.3 Source / interactions

- `state-transition` / `screen-transition` / `external-link`（および category）
- API エンドポイント一覧、HTTP メソッド、業務検証ルールは **無い**
- Input / Process / Output 処理設計の構造化表現は **無い**

### 5.4 status

`design-only` / `implementation-only` / `linked`（`hasDescription` / `hasImplementation` / `hasPreview`）

### 5.5 Reference / Capture / Figma

- Reference: PC/SP、`status`、寸法、`source?: upload | figma{frameName,importedAt} | unknown`
- Device Capture: PC/SP（state 単位）、`current` / `stale` / `missing`
- Excel / Viewer 向けは **browser-safe のみ**（token / fileKey / nodeId / signed URL を書かない）
- 版管理 object 側の canonical meta（Reimport 用 `fileKey`/`nodeId` 等）は [local-version-control.md](./local-version-control.md) §5.1a。Excel はそれを出力しない

### 5.6 座標

collector / Viewer は DOM item の **安定した bounding box を永続化しない**。
したがって画像上の番号 marker 自動配置は v1 では行わない。

### 5.7 Excel 領域ごとの生成可否

| Excel 領域 | 判定 | 根拠 |
|------------|------|------|
| 改訂履歴（commit log） | 版管理導入後に正確生成可能 | Screen/Feature/Project filter。未導入時は「未初期化」行または空表 |
| 基本情報（画面名, screenId, path, status, feature） | 正確に生成可能 | Description + Source + features（status は算出） |
| 概要 | 正確に生成可能 | `screen.description` |
| 参照画像 PC/SP | 一部生成可能 | Reference がある場合のみ |
| 実装キャプチャ PC/SP | 一部生成可能 | Device Capture がある場合のみ |
| 項目定義（No, itemId, 名称, 種別, 概要, note） | 正確に生成可能 | itemOrder + items |
| リンク有無 / リンク先 | 一部生成可能 | interactions から要約。API 一覧ではない |
| 必須 / 文字数 / 入力形式 / 動的変数 | 生成不可 | schema に無い。推測しない |
| 実装状況 | 正確に生成可能 | screen status + item は description/source 有無の範囲で表示 |
| 状態一覧 | 正確に生成可能 | states（visible/order） |
| API 一覧 | 生成不可 | schema 無し |
| 入力チェック詳細 / エラーメッセージ表 | 生成不可 | schema 無し（note 自由記述への転記はしない） |
| 処理設計 IPO | 生成不可 | schema 無し。空テンプレ大量生成もしない |

---

## 6. Workbook構成

### 6.1 基本方針

- 内部の基本設計単位は **Screen**
- 1 回の Export で **1 workbook**（scope により中身が変わる）
- ファイルは毎回新規生成（参考 Excel の複製禁止）
- シート順は決定的
- 入力の正本は **working tree の src SoT**、または `--revision` の commit tree。`dist` 単独を正本にしない

### 6.2 出力 scope

| scope | CLI | シート構成 |
|-------|-----|------------|
| **Screen Export** | `--screen <screenId>` | `改訂履歴` + `画面設計(<画面名>)` |
| **Feature Export** | `--feature <featureId>` | `改訂履歴` + 所属画面の `画面設計` × N（機能内 `screenIds` 順） |
| **Project Export** | 両方未指定（既定） | `改訂履歴` + `機能一覧` + 全画面の `画面設計`（feature 順 → 各 screenIds → Ungrouped） |

- `--screen` と `--feature` の同時指定は **エラー**
- 既存の手作業 Excel に近いのは **Feature Export**
- **処理設計シートは Export v1 では生成しない**

### 6.3 画面順

1. Feature あり: 一意な `displayOrder` 昇順 → 各 `screenIds` 順 → Ungrouped は既存 screen canonical 順
2. Feature 無し（現行 project）: `loadScreenSpecProject` と同一の画面順（既定案 screenId 昇順）
3. `--revision` 時は **その commit 時点の features.json membership / order** を使う

### 6.4 シート名規則（Excel 制限）

| 制約 | 扱い |
|------|------|
| 最大 31 文字 | 超過時は truncate |
| 禁止文字 `: \ / ? * [ ]` | `_` に置換 |
| 先頭 / 末尾の単一引用符 | 除去 |
| 空名・空白のみ | `画面設計` + screenId にフォールバック |
| 重複 | 同一表示名が衝突したら `…(<短縮名>_<screenId短縮>)` 形式で一意化 |

推奨アルゴリズム（決定的）:

1. 基名 = `画面設計(` + 画面名 + `)`
2. 禁止文字置換
3. 31 文字超なら、接尾に `_` + `screenId`（必要なら screenId 側も短縮）を残すよう画面名側を Truncate
4. それでも衝突するなら screenId 全体を使った `画面設計(<screenId>)` にフォールバック
5. 衝突解消不能なら `SPEC_EXCEL_EXPORT_SHEET_NAME_FAILED`

- `改訂履歴` は常に先頭・固定名
- 画面設計シートのみ（処理設計は v1 なし）のため、画面名同士の衝突だけを考慮すればよい
- 同一入力 → 同一シート名集合・同一順序を保証する

---

## 7. Sheet構成

### 7.1 改訂履歴（version commit log）

公式納品の既定は **HEAD（または `--revision`）時点の版管理履歴** から行を生成する。
export 実行時刻を改訂日時として捏造しない。

| 列（案） | 内容 |
|----------|------|
| 版 | short commit hash、または通し番号（hash を正とする） |
| 日時 | commit の author/committer `when`（UTC または JST 表示を固定） |
| 内容 | commit message |
| 変更概要 | 変更 feature / screen の短い列挙（任意） |
| 備考 | tag 名など |

scope 別 filter:

| scope | 含める commit |
|-------|----------------|
| Screen | 当該 `screenId` の logical paths が変化した commit |
| Feature | その revision 時点の feature 定義、または当時所属していた screen が変化した commit。**現在所属だけで過去を再解釈しない**。画面の機能間移動は screen history 側でも追える |
| Project | project の全 commit |

| 入力 | 扱い |
|------|------|
| 版管理未初期化 | シートは残し、案内行「版管理未初期化」 |
| `--working-tree`（任意） | 許可する場合、表紙相当に **未コミット / commit hash なし / 公式 revision 再現不可の可能性** を明示 |
| 利用者の project Git | 改訂履歴の正本にしない（Screen Spec 版管理と混同しない） |

著者・承認者・顧客名を推測で入れない（commit author のみ）。

### 7.2 機能一覧（Project Export のみ）

| 列 | 内容 |
|----|------|
| No | displayOrder |
| featureId | |
| 機能名 | |
| 画面数 | |
| 画面 ID 一覧 | `screenIds` を読点区切り等 |

Ungrouped は最終行または別セクション「未分類」。

### 7.3 画面設計(<画面名>)

上から順:

1. **タイトル** … `画面設計書` / projectName
2. **基本情報表**
   - projectName
   - 画面名 / screenId
   - 所属機能（featureId / 名。Ungrouped 可）
   - path（実装 path。無い場合は空）
   - status（日本語ラベル: 設計のみ / 実装のみ / 連携済み）
   - hasDescription / hasImplementation / hasPreview
   - source 相対パス（分かる場合のみ。絶対パス禁止）
   - export 元 revision（short hash。working-tree 時は「未コミット」）
3. **概要** … description（wrap）
4. **参照画像** … PC / SP の 2 枠（無い側は「未登録」）
5. **実装キャプチャ** … PC / SP（Device Capture。無い側は「未取得」。stale は注記）
6. **Figma 出典（browser-safe）** … `frameName` / `importedAt` のみ。無い場合は行省略可
7. **画面表示項目定義** … 下表
8. **状態一覧** … state id / name / visible / order
9. **遷移・リンク要約** … interactions を表形式（API 一覧と呼ばない）

### 7.4 処理設計

Export v1: **シート自体を出力しない**。
理由: Input/Process/Output と API/検証の source of truth が無く、空シートは「未記入の納品」と誤解される。

---

## 8. 画像

### 8.1 候補と役割

| 種別 | 意味 | 混同防止ラベル |
|------|------|----------------|
| Reference Image | 設計基準画像（upload / Figma import） | 参照画像 |
| Device Capture | 実装の収集キャプチャ | 実装キャプチャ |
| live Preview | Viewer 上の一時表示 | **v1 Export 対象外**（成果ファイルが無い） |

### 8.2 優先と同時表示

- **同時表示**を推奨（別セクション）。どちらか一方を「勝者」にして他方を捨てない。
- 各セクション内の PC/SP は並置（上: PC、下: SP、または左右）。紙面は A4 横のため **上下並置**を既定とする。

### 8.3 欠落時

- 画像セルに日本語プレースホルダ: `未登録` / `未取得` / `無効（invalid）` / `stale（再収集推奨）`
- 空の巨大画像枠は作らず、固定高さの案内セルに留める

### 8.4 サイズ・形式

画像上限は **役割ごとに分離**する。

| 層 | 契約 |
|----|------|
| Reference **保存入力** | 既存どおり **20 MiB**（`reference-image.md`）。Export がこれより低い「受理拒否」をしてはならない |
| Excel **埋め込み変換** | workbook 肥大防止の **出力最適化**。最大辺 **4096 px** へ縦横比維持で resize（long-page Capture も aspect 維持） |
| 旧稿の 8 MiB / 画像上限 | **廃止**。それは Excel 埋め込み前の誤った受理拒否だった。Reference 保存上限でも原画像永久制限でもない |
| 原画像 | `spec/.../src/references|captures` の PNG / meta を **変更しない** |
| 一時変換 | workbook 生成用の縮小画像は temp に置き、生成後に削除 |
| workbook 目安 | 推奨合計 64 MiB 未満（超過は警告） |
| 秘密・パス | fileKey / nodeId / token / signed URL 非露出。外部リンク画像なし |

### 8.5 Figma

- `source.type === 'figma'` のとき `frameName` と `importedAt` のみ表示
- Reimport 用識別子は **一切書かない**

---

## 9. 項目マッピング

### 9.1 番号と画像の対応

| 方式 | 判定 |
|------|------|
| A. 画像上 marker overlay | **不採用**（安定 bbox 無し。任意座標は禁止） |
| B. 表の No 列のみ | **採用**（`itemOrder` の 1 始まり） |
| C. annotated 画像生成 | v1 非採用（後続検討） |
| D. marker 省略 | bbox が無い現状では **必須** |

No 列と項目定義表だけで対応関係を示す。参考 Excel の引き出し線は再現しない。

### 9.2 項目定義表（推奨列）

| 列 | ソース | 備考 |
|----|--------|------|
| No | itemOrder index | 1 始まり |
| 項目名 | items[id].name | |
| itemId | key | |
| 種別 | items[id].type | |
| 概要 | items[id].description | |
| 備考 | items[id].note | |
| リンク種別 | interactions | `state-transition` / `screen-transition` / `external-link` / なし |
| リンク先 | targetStateId / targetScreenId / url | url は `http:` `https:` のみ。他 scheme は空＋備考 |
| 画面status | screen.status | 行ごとではなく表外でも可。行に載せるなら全行同値 |

### 9.3 参考 Excel にあって v1 で載せない列

- 動的表示 / 動的表示変数名（schema 無し）
- 必須 / 属性（業務属性）/ 入力形式 / 最小・最大文字数（schema 無し）
- API 名・チェック詳細・エラーメッセージ専用列（schema 無し）

これらを空列として残すと「未記入バグ」に見えるため、**列自体を設けない**。

### 9.4 excludedItems

- 既定: 項目定義表に **含めない**（設計対象外）
- オプション `--include-excluded` で末尾セクション「除外項目」に別表出力（実装 Phase で決定）

---

## 10. CLI

### 10.1 推奨コマンド

```bash
jskim spec export [<project>] --format xlsx
jskim spec export [<project>] --format xlsx --screen <screenId>
jskim spec export [<project>] --format xlsx --feature <featureId>
jskim spec export [<project>] --format xlsx --revision <commitHash>
jskim spec export [<project>] --format xlsx --output <path> --force
```

| 候補 | 評価 |
|------|------|
| `jskim spec export … --format xlsx` | **採用**。将来 CSV/PDF 等へ `--format` 拡張しやすい |
| `jskim spec export excel <project>` | format が増えるとサブコマンドが散る |
| `jskim spec build --xlsx` | build と責務が混線。不採用 |

### 10.2 解析

現行 `parse-cli-args.js` は `spec` の subcommand を `build|collect|dev` に限定している。
実装時（Phase 7F-2）は `export` を追加し、`--format` / `--output` / `--force` / `--screen` / `--feature` / `--revision` /（任意）`--working-tree` を許可する。

### 10.3 責任分界

| 層 | 責任 |
|----|------|
| root CLI | argv、project 解決、companion 解決、exitCode、信号 |
| companion | workbook 組み立て、画像読込、atomic 手前までの Buffer/File 生成 API |
| root command runner | output パス検証、atomic rename、日本語エラー表示 |
| 版管理 | revision tree 解決は version モジュール（Phase 7E）に委譲 |

CLI を `child_process` で組み合わせない（既存方針）。

### 10.4 project 省略

既存 `build` / `spec *` と同様、config 内 project が 1 件のときのみ省略可。

### 10.5 入力データ（正本）

- **既定（公式）**: 版管理の **HEAD**（または `--revision`）の tree を読む。未初期化なら working tree の **src SoT**（Description / Source / features / references / captures）を読む
- **`dist` は正本にしない**（stale・再生成・browser 投影のため）。必要なら src からその場で ScreenData 相当を合成する
- collect の自動実行は **しない**（長い Playwright を踏まない）。snapshot / Capture が無い画面は欠落表示
- Preview 用に dist が必要なケースがあっても、Export の文言・項目・membership の正は src / revision

### 10.6 複数 project

Export v1 は 1 回の呼び出しで 1 project。`--all` は入れない。

### 10.7 exit code

| 結果 | code |
|------|------|
| 成功 | 0 |
| 利用誤り（argv / project / scope 衝突） | 1 |
| データ・I/O・生成失敗 | 1（`err.code` をログ） |

---

## 11. 出力先

### 11.1 既定パス（scope 別）

```text
spec/{projectName}/export/{projectName}-screen-spec.xlsx
spec/{projectName}/export/{projectName}-{featureId}-screen-spec.xlsx
spec/{projectName}/export/{projectName}-{screenId}-screen-spec.xlsx
```

- `--revision` 指定時はファイル名に short hash を付与してよい（例: `...-a1b2c3d4e5f6.xlsx`）
- `export/` は gitignore 推奨
- directory が無ければ作成する

### 11.2 `--output`

- 相対パスは `process.cwd()` 基準
- 絶対パス可。ただしエラーメッセージには絶対パスを出さない（相対化またはファイル名のみ）
- 親 directory が無ければ作成

### 11.3 衝突

- 既存ファイルがある場合: 既定は失敗（`SPEC_EXCEL_EXPORT_OUTPUT_EXISTS`）
- `--force` で上書き

### 11.4 atomic 書き込み

1. 同一 directory に `.{name}.{random}.tmp.xlsx` を書く
2. flush 後 `rename` で置換（Windows は既存削除が必要な実装パターンを既存 `writeFileAtomic` 系に合わせる）
3. 失敗時は tmp を削除

### 11.5 read-only

- output 先が書けなければ失敗。Viewer read-only モードとは独立（export はローカル成果物生成）

### 11.6 Windows ファイル名

- 最終ファイル名から `<>:"/\|?*` と制御文字を除去
- 予約名（`CON` 等）を避け suffix

---

## 12. Library選定

### 12.1 比較（公式 README / repository ベース）

| 項目 | ExcelJS | SheetJS CE (`xlsx`) | xlsx-populate |
|------|---------|---------------------|---------------|
| license | MIT | Apache-2.0 | MIT |
| npm 配布 | 安定 | 公式は CDN 移行・npm 旧版停滞の経緯あり | あり |
| CJS/ESM | CJS 主（companion は ESM。dynamic import / 互換層で可） | 両方 | CJS 寄り |
| TypeScript | 型定義あり | コミュニティ型 | 弱め |
| スタイル | 充実 | 書き込みスタイルは限定的 / 有料機能境界に注意 | 中程度 |
| 画像埋め込み | **対応** | コミュニティ版の書き込みは弱い | 対応 |
| merge / 行高 / 列幅 | 対応 | 限定 | 対応 |
| pageSetup A4 landscape | **対応**（paperSize=9） | 限定 | 一部 |
| freeze pane | 対応 | 限定 | 対応 |
| 図形・コネクタ | **非対応に近い** | 非対応 | 弱い |
| deterministic | ZIP 時刻で byte が変わり得る | 同様 | 同様 |
| browser 必須 | 不要 | 不要 | 不要 |
| 保守 | 利用実績多い。issue は多いが機能は十分 | 配布形態が運用負荷 | メンテ低調 |

### 12.2 推奨

**ExcelJS（`exceljs`）を companion の dependency として採用する（実装 Phase で追加）。**

根拠:

- 納品 Excel に必須の **画像埋め込み・セルスタイル・pageSetup** が OSS で揃う
- MIT で engine / companion の MIT 方針と整合
- 図形コネクタは諦めても v1 要件（表 + 画像）は満たせる

### 12.3 捨てる機能（library 制約）

- 画像上の自動番号図形・コネクタ
- 高度な drawingML 編集
- byte-identical xlsx

### 12.4 本 Phase

dependency 追加は **行わない**（設計のみ）。

---

## 13. Style・印刷

| 項目 | 契約 |
|------|------|
| 紙 | A4（9）landscape |
| gridline | 非表示 |
| ヘッダ塗り | 薄緑 `#92D050` 系（section / 表ヘッダ） |
| 制約ヘッダ | v1 で検証列が無いため未使用。将来列追加時に薄橙 |
| 罫線 | thin / black |
| フォント | 日本語 UI フォントスタック |
| wrap | 概要・description・note で有効 |
| マージ | タイトル行と画像キャプション程度に限定（参考 Excel の大量マージはしない） |
| used range | 実データがある矩形のみ |
| print scale | シートごと 60–70% を初期値にできるが、v1 は ExcelJS pageSetup.scale=65 を既定案とする |
| freeze | 項目表ヘッダ行を freeze 推奨 |

---

## 14. Determinism

### 14.1 保証する（semantic determinism）

同一の **revision tree（または同一 working tree スナップショット）** と同一 CLI オプションに対し:

- シート名集合と順序
- 各セルの文字列・数値の意味
- 画像の採用ファイル（content hash / revision）
- 項目行順（itemOrder）
- 改訂履歴に載る commit 集合（filter 後）

が一致する。

### 14.2 保証しない（byte hash）

- ZIP entry timestamp
- Core Properties の created / modified
- ExcelJS 内部の一時 id

テストは **再オープンしての semantic assertion** を主とし、xlsx バイナリの黄金ファイル全文比較は必須にしない。

### 14.3 改訂履歴の時刻

- commit に記録された日時を使う（export 時刻ではない）
- working-tree export では改訂履歴に未コミット行を載せるか、履歴のみ HEAD までとするかを実装 Phase で固定（推奨: 履歴は HEAD まで＋表紙に未コミット警告）

---

## 15. Security

- Figma token / fileKey / nodeId / signed URL を書かない
- ローカル絶対パスを書かない（source は project-relative のみ）
- 参考手作業 Excel のセル・画像をコピーしない
- macro / VBA / external link を作らない
- hyperlink は `http:` `https:` のみ（それ以外はテキスト化）
- **formula injection**: セル文字列が `=`, `+`, `-`, `@` で始まる場合は先頭に `'` を付ける、または ExcelJS で plain text 強制（実装で一方に固定しテストする）
- エラーメッセージに秘密・絶対パスを含めない

---

## 16. Error

既存の `SPEC_*` スタイルに合わせ、Excel Export は `SPEC_EXCEL_EXPORT_*` とする。

| code | 日本語メッセージ（案） |
|------|------------------------|
| `SPEC_EXCEL_EXPORT_PROJECT_NOT_FOUND` | 指定した project が見つかりません。 |
| `SPEC_EXCEL_EXPORT_SCREEN_NOT_FOUND` | 指定した画面が見つかりません。 |
| `SPEC_EXCEL_EXPORT_FEATURE_NOT_FOUND` | 指定した機能グループが見つかりません。 |
| `SPEC_EXCEL_EXPORT_SCOPE_CONFLICT` | `--screen` と `--feature` は同時に指定できません。 |
| `SPEC_EXCEL_EXPORT_REVISION_NOT_FOUND` | 指定した revision が見つかりません。 |
| `SPEC_EXCEL_EXPORT_DATA_MISSING` | Export に必要な画面設計データがありません。 |
| `SPEC_EXCEL_EXPORT_OUTPUT_EXISTS` | 出力先に既にファイルがあります。`--force` で上書きできます。 |
| `SPEC_EXCEL_EXPORT_OUTPUT_NOT_WRITABLE` | 出力先に書き込めません。 |
| `SPEC_EXCEL_EXPORT_INVALID_OUTPUT_PATH` | 出力パスが不正です。 |
| `SPEC_EXCEL_EXPORT_FORMAT_UNSUPPORTED` | 未対応の format です。`xlsx` を指定してください。 |
| `SPEC_EXCEL_EXPORT_IMAGE_INVALID` | 埋め込みできない画像です。 |
| `SPEC_EXCEL_EXPORT_IMAGE_TOO_LARGE` | 画像サイズが上限を超えています。 |
| `SPEC_EXCEL_EXPORT_SHEET_NAME_FAILED` | シート名を一意に決められませんでした。 |
| `SPEC_EXCEL_EXPORT_WRITE_FAILED` | workbook の書き込みに失敗しました。 |
| `SPEC_EXCEL_EXPORT_RENAME_FAILED` | 出力ファイルの確定（rename）に失敗しました。 |
| `JSKIM_SCREEN_SPEC_NOT_FOUND` | 既存どおり companion 未インストール時 |

companion 未解決は既存コードを再利用する。

---

## 17. Test

### 17.1 方針

- `.xlsx` を unzip / ExcelJS で読み直し **semantic assertion**
- media 件数・sheet 順・主要セル・formula injection・秘密スキャン
- golden binary 全文は必須にしない。入れる場合は最小 1 ファイル＋更新手順を README に書く

### 17.2 ケース一覧（実装 Phase）

- Screen / Feature / Project 各 scope
- Feature 無し（全 Ungrouped） / Feature あり
- `--revision` 再現（同一 hash → semantic 同一）
- 改訂履歴 filter（screen 移動を含む）
- 空に近い project / 画面 0 件
- PC only / SP only / both（Reference・Capture。long-page Capture）
- 20 MiB 級 Reference の縮小埋め込み
- Figma browser-safe 行の有無
- item 0 件 / 多数 / 長い日本語
- excluded 既定除外
- 長い画面名のシート名 truncate + screenId suffix
- 既存 output / `--force`
- `--screen` と `--feature` 同時指定エラー
- invalid `--output`
- atomic rename 失敗のシミュレーション
- formula injection 文字列
- secret / absolute path が出力に無いこと
- package files 境界（Excel 実装が companion に閉じること）
- packed consumer で `jskim spec export`
- Windows path

### 17.3 Manual smoke

- Windows Excel または LibreOffice で A4 横・画像・日本語折り返しを目視（Phase 7F-3）

---

## 18. 実装Phase

ローカル版管理（Phase **7E**）の後に実施する。旧稿の 7E-1〜3（Excel）は **7F** に改番した。

### Phase 7F-1 — domain + workbook generation

- workbook domain model（純関数）
- ExcelJS 導入（companion dependency）
- Screen/Feature/Project シート組み立て、スタイル、画像埋め込み
- commit log 改訂履歴（版管理 API 利用）
- semantic unit tests
**完了条件**: 一時 directory で 3 scope の xlsx 再読込 assertion が green。CLI 未接続で可。

### Phase 7F-2 — CLI + atomic output / errors

- `parse-cli-args` に `spec export`
- `--screen` / `--feature` / `--revision` / `--output` / `--force`
- atomic rename、エラーコード、package boundary
**完了条件**: 一時 workspace で scope 別 export 成功。既存 spec コマンド回帰が green。

### Phase 7F-3 — image / packed / Windows / 文書

- 長尺・大容量画像、workbook 警告、packed consumer、目視、README
**完了条件**: packed 検証と秘密スキャン付きテストが通る。

---

## 19. 未決事項（ユーザー確認）

1. 版管理未初期化時に Project Export を許可するか（推奨: src SoT で許可し改訂履歴は案内行）
2. `--working-tree` を公式 CLI に出すか（推奨: 出すが表紙に未コミット警告）
3. `--include-excluded` を Export v1 に入れるか（推奨: 後回し）
4. Device Capture が state 複数あるとき、載せる state は **viewer 先頭 visible** でよいか
5. `export/` と `.jskim/version/` を create-jskim `.gitignore` に最初から入れるか（推奨: 両方入れる）
6. 処理設計シートを空見出しで出す需要があるか（推奨: 出さない）

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-07-20 | 初版（設計のみ） |
| 2026-07-20 | 画面中心・Feature/Project scope・版管理改訂履歴・src 正本・Phase 7F 改番 |
