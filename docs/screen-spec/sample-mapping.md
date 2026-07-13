# Sample mapping — Screen Spec v1

この文書は公式 sample（`src/sample`）を調査した結果に基づく、最初の適用設計です。  
仮想の file / element は使いません。

## 調査日基準

- project: `sample`（`sourceDir: src/sample`, `outputDir: dist/sample`）
- pipeline: `files: [{ from: 'pages', to: '' }]`

---

## 1. 選択した CRUD 代表画面

| 項目 | 値 |
|------|----|
| 画面 | 商品登録 |
| source | `src/sample/pages/crud/create.html.njk` |
| output | `/crud/create.html`（`dist/sample/crud/create.html`） |
| 提案 screen ID | `crud-create` |

### 選択理由

- form 見た目の入力要素が多い（text / select / textarea）
- 一覧・完了への静的 navigation がある
- 他 CRUD 画面（list / detail / edit / delete）との関係を示す起点になる
- 静的 UI sample として「見た目のみ」が明示されている

### 提案 item ID

| item ID | 対応ラベル / 要素 | DOM の目安 |
|---------|-------------------|------------|
| `product-id` | 商品ID | `#create-id` を含む form-field |
| `product-name` | 商品名 | `#create-name` |
| `product-category` | カテゴリ | `#create-category` |
| `product-price` | 価格 | `#create-price` |
| `product-status` | ステータス | `#create-status` |
| `product-description` | 商品説明 | `#create-description` |
| `back-to-list` | 一覧へ戻る | `a.button` → `index.html` |
| `submit-create` | 登録する | `a.button` → `complete.html` |

### 提案 action ID

現在の公式 sample は JavaScript がなく、入力状態を変える操作もありません。  
collector がリンクを辿るための action は次を提案します。

| action ID | 用途 |
|-----------|------|
| `back-to-list` | 一覧リンクをクリック |
| `submit-create` | 登録リンクをクリック |

（item と同一 ID。同じ element に `data-jskim-spec-item` と `data-jskim-spec-action` を併記する想定）

### 提案 screen-transition

| itemId | targetScreenId | 実リンク |
|--------|----------------|----------|
| `back-to-list` | `crud-list` | `index.html` → `/crud/index.html` |
| `submit-create` | `crud-complete` | `complete.html` → `/crud/complete.html` |

関連 stub example:

- `docs/screen-spec/examples/source/crud-list.spec.json`
- `docs/screen-spec/examples/source/crud-complete.spec.json`

---

## 2. Wizard の実際の構造

| page | source | output | 提案 screen ID |
|------|--------|--------|----------------|
| 情報入力 | `src/sample/pages/wizard/input.html.njk` | `/wizard/input.html` | `wizard-input` |
| 入力内容確認 | `src/sample/pages/wizard/confirm.html.njk` | `/wizard/confirm.html` | `wizard-confirm` |
| 完了 | `src/sample/pages/wizard/complete.html.njk` | `/wizard/complete.html` | `wizard-complete` |

共通:

- `src/sample/components/wizard-steps.njk`（ステップ表示のみ。リンクなし）
- `currentStep` は各 page の Nunjucks 変数（1 / 2 / 3）
- `<script>` なし、`<form>` なし、状態 machine なし

### 結論: Wizard は独立 screen（静的 multi-page）

公式 sample の Wizard は **1 page 内の state-transition ではない**。  
各ステップは独立 HTML であり、画面間は静的 `<a href>` で移動する。

### page 間 transition（実リンク）

| from | 操作テキスト | to | 提案 |
|------|--------------|----|------|
| wizard-input | 入力内容を確認する | wizard-confirm | `screen-transition` |
| wizard-input | Portal へ戻る | portal (`/index.html`) | `screen-transition` |
| wizard-confirm | 入力画面へ戻る | wizard-input | `screen-transition` |
| wizard-confirm | 送信する | wizard-complete | `screen-transition` |

### wizard-input 提案 item ID

| item ID | ラベル |
|---------|--------|
| `applicant-name` | 氏名 |
| `applicant-email` | メールアドレス |
| `applicant-phone` | 電話番号 |
| `inquiry-category` | お問い合わせ種別 |
| `inquiry-message` | お問い合わせ内容 |
| `back-to-portal` | Portal へ戻る |
| `go-to-confirm` | 入力内容を確認する |

---

## 3. state-transition を公式 sample で検証できるか

**現状では検証できません。**

理由:

1. CRUD / Wizard ともに JavaScript output が 0
2. 入力は `readonly` / `disabled`
3. modal / tab / accordion の表示切替 DOM がない
4. Wizard の「ステップ」は別 HTML の見た目であり、同一 screen の state ではない

したがって:

- 公式 sample の example は `screen-transition` を中心にする
- `state-transition` / `external-link` / collect `click`+`wait` の契約検証には **合成 fixture** を使う

合成 fixture:

- `docs/screen-spec/examples/source/synthetic-help-demo.spec.json`
- `docs/screen-spec/examples/description/synthetic-help-demo.json`

この fixture は公式 sample には存在しません。contract / schema 検証専用です。

---

## 4. 今後の別途 synthetic fixture の必要性

| 目的 | 必要性 |
|------|--------|
| state-transition の収集・viewer 検証 | **必要**（公式 sample だけでは不足） |
| fill / select / check の collect 検証 | **必要**（現 sample は操作不可） |
| screen-transition のみ | 公式 sample で十分 |

次段階で collector / viewer を実装する際は、小さな synthetic HTML fixture（test 専用 TEMP）を併用してください。

---

## 5. パイロット適用状況（phase 2・適用済み）

次は **適用済み** です。

1. production build での `data-jskim-spec-*` 除去
2. 内部 spec collection mode（`preserveScreenSpecAttributes`）での attribute 保持
3. `crud-create` と Wizard 3 page への attribute 適用
4. sidecar `*.spec.json`（`src/sample/pages/**`）
5. `spec/sample/src/data/*.json`
6. `create-jskim/template` への sample / spec mirror

### 補足

- `$schema` は公式 sidecar / Description で GitHub raw の絶対 URI を使用する（相対 path は examples 向け）
- `layouts/base.njk` はページ側の `jskimSpecScreen` 変数で `data-jskim-spec-screen` を付与する
- `state-transition` の検証は公式 sample では不足するため、引き続き **合成 fixture**（`synthetic-help-demo`）が必要
