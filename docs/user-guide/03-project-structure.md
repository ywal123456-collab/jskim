# プロジェクト構成

この章では、`create-jskim` が生成する project の directory 構成と、各要素の役割を説明します。

## 全体構成

生成直後のルート構成は次のとおりです。

```text
my-project/
├─ jskim.config.js
├─ package.json
├─ README.md
├─ .gitignore
├─ src/
│  └─ sample/
└─ dist/          ← build 後に生成されることがある
   └─ sample/
```

`dist/` は build を実行するまで存在しない場合があります。source は `src/sample/`、output は `dist/sample/` です。

`src/sample/` の概要は次のとおりです。

```text
src/sample/
├─ layouts/
│  └─ base.njk
├─ components/
│  ├─ header.njk
│  ├─ sidebar.njk
│  ├─ breadcrumb.njk
│  ├─ footer.njk
│  └─ wizard-steps.njk
└─ pages/
   ├─ index.html.njk
   ├─ assets/
   │  ├─ css/common.css
   │  └─ img/logo.svg
   ├─ dashboard/
   ├─ crud/
   └─ wizard/
```

## jskim.config.js

`jskim.config.js` は project の定義です。動作の基準はこのファイルにあります。

公式 sample では、おおむね次の考え方で設定されています。

- `sourceDir` — source のルート（例: `src/sample`）
- `outputDir` — output のルート（例: `dist/sample`）
- `files` — pages 配下をまとめて処理する pipeline（例: `{ from: 'pages', to: '' }`）
- `templates` — `extends` / `include` 用の検索パス（例: `layouts`, `components`）
- `data` — 全 template へ渡す共通データ（例: `site.name`）

設定の一部（概念）:

```js
defaults: {
  files: [{ from: 'pages', to: '' }],
  templates: ['layouts', 'components'],
  data: {
    site: {
      name: 'JSKim UI Sample',
      language: 'ja',
      themeColor: '#222222',
    },
  },
}
```

オプションの詳細は [設定](06-configuration.md) を参照してください。

## src/sample

`src/sample/` は公式 sample の source root です。  
この repository の sample と、creator が生成する sample は同じ構成です。

主な役割:

- `layouts/` — 文書全体の共通枠
- `components/` — header など再利用部品
- `pages/` — 実際に output されるページと asset

## layouts

共通 layout は次の file です。

- [`base.njk`](../../src/sample/layouts/base.njk)

HTML document の骨格（`title`、共通 CSS、header、sidebar、breadcrumb、footer）を定義します。  
各ページは `{% extends "layouts/base.njk" %}` でこの layout を継承し、`{% block content %}` などに本文を書きます。

`layouts` は template root のため、それ自体は output されません。

## components

components は次のとおりです。

| file | 役割 |
| ---- | ---- |
| [`header.njk`](../../src/sample/components/header.njk) | 上部ヘッダーとブランド表示 |
| [`sidebar.njk`](../../src/sample/components/sidebar.njk) | 画面グループへのナビ |
| [`breadcrumb.njk`](../../src/sample/components/breadcrumb.njk) | パンくずリスト |
| [`footer.njk`](../../src/sample/components/footer.njk) | フッター |
| [`wizard-steps.njk`](../../src/sample/components/wizard-steps.njk) | Wizard の手順表示 |

layout から `{% include "components/header.njk" %}` のように読み込みます。  
components も template root のため、独立した HTML ページとしては output されません。

## pages

`pages/` 配下が実際の output 対象です。

- `*.njk` は末尾の `.njk` だけを外して render されます（例: `index.html.njk` → `index.html`）
- CSS / SVG などそれ以外は copy されます
- `pages/` からの相対構造は output でも維持されます

公式 sample のページ構成:

| グループ | 内容 |
| -------- | ---- |
| Portal | `pages/index.html.njk` |
| dashboard/ | Dashboard 画面と page-local CSS |
| crud/ | 一覧・詳細・登録・編集・削除・完了などの画面群 |
| wizard/ | 入力・確認・完了の画面群 |

## 共通 asset

共通で使う asset の例:

| source | output |
| ------ | ------ |
| [`pages/assets/css/common.css`](../../src/sample/pages/assets/css/common.css) | `dist/sample/assets/css/common.css` |
| [`pages/assets/img/logo.svg`](../../src/sample/pages/assets/img/logo.svg) | `dist/sample/assets/img/logo.svg` |

深い階層のページからも同じ共通 asset を参照するため、layout では `rootPath` を使います。

```nunjucks
<link rel="stylesheet" href="{{ rootPath }}assets/css/common.css">
```

`rootPath` は output 上のページ位置に応じて、output root までの相対パスを表します。  
詳細は [files pipeline](07-files-pipeline.md) を参照してください。

## Page-local asset

画面グループ専用の CSS 例:

| source | output |
| ------ | ------ |
| [`dashboard/.../dashboard.css`](../../src/sample/pages/dashboard/assets/css/dashboard.css) | `dist/sample/dashboard/assets/css/dashboard.css` |
| [`crud/.../crud.css`](../../src/sample/pages/crud/assets/css/crud.css) | `dist/sample/crud/assets/css/crud.css` |
| [`wizard/.../wizard.css`](../../src/sample/pages/wizard/assets/css/wizard.css) | `dist/sample/wizard/assets/css/wizard.css` |

page-local CSS は、その画面グループからの相対パスで参照します。

```html
<link rel="stylesheet" href="assets/css/dashboard.css">
```

> **Warning**
>
> 次のように `rootPath` を付けて page-local CSS を参照しないでください。
>
> ```nunjucks
> {{ rootPath }}assets/css/dashboard.css
> ```
>
> `rootPath` は output root（`dist/sample/`）基準です。  
> Dashboard 用 CSS は `dist/sample/dashboard/assets/...` にあるため、  
> root 基準のパスでは見つかりません。

共通 asset と page-local asset の比較:

| 種類 | 置き場所の例 | 参照の考え方 |
| ---- | ------------ | ------------ |
| 共通 asset | `pages/assets/...` | `{{ rootPath }}assets/...` |
| page-local asset | `pages/dashboard/assets/...` など | 同一グループからの相対パス（`assets/...`） |

## dist/sample

`dist/sample/` は build の output です。

- 手で編集する source ではありません
- 次の build で上書き・再生成されることがあります
- 配布対象として使える通常の静的ファイルです
- `layouts` / `components` はここへ出力されません

## Source と output の対応

| source | 処理 | output |
| ------ | ---- | ------ |
| `pages/index.html.njk` | render | `index.html` |
| `pages/assets/css/common.css` | copy | `assets/css/common.css` |
| `layouts/base.njk` | template root | 直接 output なし |
| `components/header.njk` | template root | 直接 output なし |
| `pages/crud/detail.html.njk` | render | `crud/detail.html` |
| `pages/dashboard/assets/css/dashboard.css` | copy | `dashboard/assets/css/dashboard.css` |

## どこを編集するか

目的ごとの目安です。

| 目的 | 主な編集先 |
| ---- | ---------- |
| ページ本文 | `pages/**/*.html.njk` |
| 共通 layout | [`layouts/base.njk`](../../src/sample/layouts/base.njk) |
| 共通 component | `components/*.njk` |
| 全体の見た目 | [`pages/assets/css/common.css`](../../src/sample/pages/assets/css/common.css) |
| 画面グループの見た目 | 各グループの `assets/css/*.css` |
| build やサーバー設定 | `jskim.config.js` |

日常の開発の流れは [基本的な開発workflow](04-basic-workflow.md)、  
CLI と設定の詳細は [CLIリファレンス](05-cli-reference.md) / [設定](06-configuration.md) を参照してください。
