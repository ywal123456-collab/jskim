# Nunjucksの使い方

この章では、JSKim の静的ページ制作で実用的な Nunjucks 文法を説明します。  
Nunjucks 全体の公式 reference を置き換えるものではありません。

## JSKim と Nunjucks

| 役割 | 内容 |
| ---- | ---- |
| Nunjucks | template の記法と render engine |
| JSKim | project / 設定 / files / build / watch / serve / dev をまとめる実行環境 |

`{% ... %}` と `{{ ... }}` は Nunjucks の文法です。  
一方、`rootPath` は Nunjucks 固有の変数ではなく、JSKim が render context に注入する予約値です。

Nunjucks の機能すべてが JSKim 独自機能というわけではありません。  
この章は、公式 sample で使われている範囲を中心にします。

## Template inheritance

各ページは共通 layout を継承します。

```nunjucks
{% extends "layouts/base.njk" %}
```

パスは、page file からの相対パスではありません。  
Nunjucks loader が探す template root（`sourceDir` と `templates[]`）基準です。

layout 自体は template root のため、直接 HTML としては output されません。  
詳細は [files pipeline](07-files-pipeline.md) を参照してください。

- layout: [`base.njk`](../../src/sample/layouts/base.njk)
- 例: [Portal](../../src/sample/pages/index.html.njk)、[Dashboard](../../src/sample/pages/dashboard/index.html.njk)

## block

[`base.njk`](../../src/sample/layouts/base.njk) が定義する block は次の 3 つです。

| block | 用途 |
| ----- | ---- |
| `title` | `<title>` の内容 |
| `pageCss` | 画面群ごとの stylesheet など |
| `content` | 本文 |

Wizard 入力ページの例:

```nunjucks
{% block title %}情報入力 - {{ site.name }}{% endblock %}

{% block pageCss %}
  <link rel="stylesheet" href="assets/css/wizard.css">
{% endblock %}

{% block content %}
  ...
{% endblock %}
```

公式 sample に存在しない `script` block などはここでは扱いません。

## include

layout は共通 fragment を `include` します。

```nunjucks
{% include "components/header.njk" %}
{% include "components/sidebar.njk" %}
{% include "components/footer.njk" %}
```

breadcrumb は `breadcrumbs` があるときだけ読み込みます。

```nunjucks
{% if breadcrumbs %}
  {% include "components/breadcrumb.njk" %}
{% endif %}
```

Wizard ページでは手順表示も include します。

```nunjucks
{% include "components/wizard-steps.njk" %}
```

include 対象も独立 HTML としては output されません。

- [`header.njk`](../../src/sample/components/header.njk)
- [`wizard-steps.njk`](../../src/sample/components/wizard-steps.njk)
- 例: [Wizard 入力](../../src/sample/pages/wizard/input.html.njk)

## Variable output

config の `data` や page 内の値を出力します。

```nunjucks
{{ site.name }}
```

JSKim の Nunjucks 環境は `autoescape: true` です。  
HTML 特殊文字は既定で escape されます。

信頼できない入力を raw HTML として埋め込む例は、このガイドでは扱いません。

## set

page 内の静的な値を定義します。

```nunjucks
{% set currentSection = "dashboard" %}
{% set currentStep = 1 %}
```

CRUD 一覧では、表示用の配列も page 内で定義しています。

```nunjucks
{% set products = [
  { id: "P-001", name: "サンプル商品A", status: "公開" },
  ...
] %}
```

これは外部 API や mock server ではありません。  
application の状態管理機能でもありません。静的 UI sample のための値です。

例: [CRUD 一覧](../../src/sample/pages/crud/index.html.njk)

## for

繰り返し HTML を生成します。CRUD 一覧の抜粋:

```nunjucks
{% for product in products %}
  <tr>
    <td>{{ product.id }}</td>
    <td>{{ product.name }}</td>
    ...
  </tr>
{% endfor %}
```

空配列の特別処理など、sample にない高度な用法は省略します。

## if / elif / else

条件で class や表示文言を切り替えます。  
CRUD の status 表示:

```nunjucks
{% if product.status == "公開" %}
  <span class="badge badge--public">公開</span>
{% elif product.status == "非公開" %}
  <span class="badge badge--private">非公開</span>
{% else %}
  <span class="badge badge--draft">下書き</span>
{% endif %}
```

色だけで区別せず、テキストも残しています。

Wizard の手順表示でも `currentStep` を比較します。

```nunjucks
{% if currentStep == 1 %} is-current{% elif currentStep > 1 %} is-complete{% endif %}
```

例: [`wizard-steps.njk`](../../src/sample/components/wizard-steps.njk)

## default

公式 sample では `default` filter を使っていません。  
Nunjucks 自体の機能として存在しますが、このガイドの代表例には含めません。

## Escaping

JSKim は環境作成時に次を固定しています。

- `autoescape: true`
- `noCache: true`

ユーザーが `jskim.config.js` の `nunjucks` で `autoescape` を切り替える設定はありません。  
`nunjucks` 配下で設定できるのは主に `filters` と `globals` です。

> **Warning**
>
> 信頼できる HTML だけを意図的に escape 解除したい場合は、  
> filter 側で Nunjucks の `SafeString` を返す方法があります（公式 config の `toJson` 例）。  
> 不特定の入力に対して安易に escape を外さないでください。

XSS 対策の包括ガイドは、この章の範囲外です。

## rootPath

`rootPath` は Nunjucks 固有の組み込み変数ではありません。  
JSKim が各ページの output 位置に応じて注入する予約 context です。

| output | `rootPath` |
| ------ | ---------- |
| `index.html` | `./` |
| `dashboard/index.html` | `../` |
| `crud/detail.html` | `../` |

共通 asset の例:

```nunjucks
{{ rootPath }}assets/css/common.css
```

> **Warning**
>
> page-local asset には `rootPath` を付けないでください。  
> 詳細と正しい例は [files pipeline](07-files-pipeline.md) を参照してください。

`data.rootPath` を設定すると予約語衝突エラーになります。

## Config data

`jskim.config.js` の `data` は、すべての render page の context に渡されます。

```js
data: {
  site: {
    name: 'JSKim UI Sample',
    language: 'ja',
    themeColor: '#222222',
  },
}
```

`{{ site.name }}` のように nested object を参照できます。

| 種類 | 違い |
| ---- | ---- |
| `data` | project 全体で共通。config に書く |
| `{% set %}` | その page（または template）内の局所値 |

設定の詳細は [設定](06-configuration.md) を参照してください。

## filters と globals

登録場所:

```js
nunjucks: {
  filters: { ... },
  globals: { ... },
}
```

- filter は **function** である必要があります
- global は function または通常の値を登録できます
- 非同期 function はサポートしていません

公式 config にはデモ用の `formatPrice` / `toJson` / `currentYear` があります。  
ただし公式 UI sample のページ本文は、これらに依存していません。  
starter project の理解に必須ではありません。

## nunjucks 設定でできること

現在の schema でユーザーが書く主な key:

| path | 内容 |
| ---- | ---- |
| `nunjucks.filters` | カスタム filter |
| `nunjucks.globals` | カスタム global |

JSKim が環境作成時に固定する値:

| option | 値 |
| ------ | -- |
| `autoescape` | `true` |
| `noCache` | `true`（loader / Environment） |

Nunjucks upstream のすべての Environment option が、そのまま config から指定できるわけではありません。

## 公式 sample の文法 mapping

| 文法 | sample file | 用途 |
| ---- | ----------- | ---- |
| `extends` | [`pages/index.html.njk`](../../src/sample/pages/index.html.njk) など | 共通 layout 継承 |
| `block` | [`layouts/base.njk`](../../src/sample/layouts/base.njk) | `title` / `pageCss` / `content` |
| `include` | [`layouts/base.njk`](../../src/sample/layouts/base.njk) | header / sidebar / footer など |
| `set` | [`pages/crud/index.html.njk`](../../src/sample/pages/crud/index.html.njk) | 静的データ・現在セクション |
| `for` | [`pages/crud/index.html.njk`](../../src/sample/pages/crud/index.html.njk) | 一覧行の繰り返し |
| `if` | [`pages/crud/index.html.njk`](../../src/sample/pages/crud/index.html.njk) | status badge 分岐 |
| `include` + `if` | [`components/wizard-steps.njk`](../../src/sample/components/wizard-steps.njk) | Wizard 手順表示 |

## この章で扱わない範囲

次は公式 sample の範囲外、または別途の高度なトピックです。

- macro
- 非同期 filter
- custom extension
- Nunjucks JavaScript API 全体
- backend での動的 template 実行
- ブラウザが Nunjucks を実行する方式（build 時に HTML へ展開されます）

開発中のエラー表示や reload は [開発機能](09-development-features.md)、  
エラー対処は [エラーとトラブルシュート](10-errors-and-troubleshooting.md) を参照してください。
