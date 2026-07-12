# Dashboard例

この章では、公式 Dashboard sample を通じて、共通 layout、component、template 内データ、共通 / page-local asset の使い方を確認します。

> **Note**
>
> 以下のコードは核心部分だけの抜粋です。  
> 全体の source は各 link から確認できます。

## Sample の目的

Dashboard は、管理画面でよく見かける構成を、1 画面にまとめた静的 UI sample です。

- 共通 layout / component / page の関係を確認できる
- summary card、table、notice などの見た目を確認できる
- 実際のデータ取得や chart 機能はない
- 表示値は template 内の静的値

Source:

- [`pages/dashboard/index.html.njk`](../../src/sample/pages/dashboard/index.html.njk)

## 関連 file

```text
src/sample/
├─ layouts/base.njk
├─ components/
│  ├─ header.njk
│  ├─ sidebar.njk
│  ├─ breadcrumb.njk
│  └─ footer.njk
└─ pages/
   ├─ assets/css/common.css
   └─ dashboard/
      ├─ index.html.njk
      └─ assets/css/dashboard.css
```

共通 layout の詳細は [プロジェクト構成](03-project-structure.md) と [Nunjucksの使い方](08-nunjucks.md) も参照してください。

## Page 構成

実際の Dashboard には次があります。

| 領域 | 内容 |
| ---- | ---- |
| page heading | 「Dashboard」と説明文 |
| breadcrumb | Portal → Dashboard |
| summary card | 4 枚（登録商品数 / 公開中 / 非公開 / 今月の更新） |
| 最近の更新 table | 5 行の静的データと status badge |
| お知らせ | notice リスト |
| 画面ナビ | Portal / CRUD / Wizard への移動 |

## Layout 継承

```nunjucks
{% extends "layouts/base.njk" %}
```

- 共通の HTML document 構造を使う
- header / sidebar / footer は layout 側で include
- page は `title` / `pageCss` / `content` block を埋める
- layout 自体は直接 output されない

Layout:

- [`layouts/base.njk`](../../src/sample/layouts/base.njk)

## Page 変数

```nunjucks
{% set currentSection = "dashboard" %}
{% set breadcrumbs = [
  { label: "Portal", href: rootPath + "index.html" },
  { label: "Dashboard" }
] %}
```

| 変数 | 役割 |
| ---- | ---- |
| `currentSection` | sidebar の現在位置表示 |
| `breadcrumbs` | breadcrumb component の表示データ |
| `block title` | `<title>`（`Dashboard - {{ site.name }}`） |

## Summary と table

summary と最近の更新は、template 内の配列です。

```nunjucks
{% set summaryCards = [
  { label: "登録商品数", value: "120" },
  { label: "公開中", value: "98" },
  { label: "非公開", value: "22" },
  { label: "今月の更新", value: "15" }
] %}

{% for card in summaryCards %}
  <article class="summary-card">
    <p class="summary-card__label">{{ card.label }}</p>
    <p class="summary-card__value">{{ card.value }}</p>
  </article>
{% endfor %}
```

- 外部 API の応答ではない
- 繰り返す HTML を短く書く例
- 実際の application では、backend や build 前のデータ生成など、別の仕組みが必要

JSKim 自体は API を提供しません。

## Status 分岐

```nunjucks
{% if item.status == "公開" %}
  <span class="badge badge--public">公開</span>
{% elif item.status == "非公開" %}
  <span class="badge badge--private">非公開</span>
{% else %}
  <span class="badge badge--draft">下書き</span>
{% endif %}
```

class とテキストの両方で状態を示します。色だけに頼らない書き方です。

## Asset

共通 CSS（layout）:

```nunjucks
{{ rootPath }}assets/css/common.css
```

Dashboard CSS（page）:

```html
<link rel="stylesheet" href="assets/css/dashboard.css">
```

| source | 処理 | output |
| ------ | ---- | ------ |
| `pages/assets/css/common.css` | copy | `assets/css/common.css` |
| `pages/dashboard/assets/css/dashboard.css` | copy | `dashboard/assets/css/dashboard.css` |

`rootPath` の詳細は [files pipeline](07-files-pipeline.md) を参照してください。

## Build output

```text
dist/sample/dashboard/index.html
dist/sample/dashboard/assets/css/dashboard.css
dist/sample/assets/css/common.css
```

## 修正例

| 変えたいもの | 編集先 |
| ------------ | ------ |
| summary の label / value | `pages/dashboard/index.html.njk` の `summaryCards` |
| table の行 | 同 file の `recentUpdates` |
| お知らせ文 | 同 file の `notices` |
| Dashboard 専用の見た目 | `pages/dashboard/assets/css/dashboard.css` |

保存後、`npm run dev` で確認できます。

## 新しい Dashboard page への拡張

最小の手順例:

1. 新しい `.html.njk` を `pages/` 配下に作る（または既存 page を参考にする）
2. `{% extends "layouts/base.njk" %}` する
3. `currentSection` / `breadcrumbs` を設定する
4. `content` block を書く
5. 必要なら page-local CSS を置く
6. `dev` または `build` で確認する

自動 generator や専用のコピーコマンドはありません。

## Sample の限界

- 実際の統計計算はない
- API / database はない
- chart library はない
- 認証はない
- 値は静的 sample

製品としての制限は [制限事項](14-limitations.md) を参照してください。  
類似の画面構成として [CRUD例](12-crud-example.md) と [Wizard例](13-wizard-example.md) もあります。
