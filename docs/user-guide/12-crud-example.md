# CRUD例

この章では、公式 CRUD sample（商品管理の 6 画面）の構造と、静的な画面間 navigation を説明します。

> **Warning**
>
> これは静的 UI sample です。  
> JSKim が実際の登録・更新・削除機能を提供するわけではありません。

> **Note**
>
> 以下のコードは核心部分だけの抜粋です。  
> 全体の source は各 link から確認できます。

## Sample の目的

- 一覧 / 詳細 / 登録 / 編集 / 削除確認 / 完了という一般的な画面構成を示す
- page 単位の静的 HTML として確認できる
- 実際の登録・修正・削除は行わない
- 入力値の保存や画面間引き渡しはない

代表 source:

- [商品一覧](../../src/sample/pages/crud/index.html.njk)

## 関連 file

```text
pages/crud/
├─ index.html.njk
├─ detail.html.njk
├─ create.html.njk
├─ edit.html.njk
├─ delete.html.njk
├─ complete.html.njk
└─ assets/css/crud.css
```

各 page:

- [一覧](../../src/sample/pages/crud/index.html.njk)
- [詳細](../../src/sample/pages/crud/detail.html.njk)
- [登録](../../src/sample/pages/crud/create.html.njk)
- [編集](../../src/sample/pages/crud/edit.html.njk)
- [削除確認](../../src/sample/pages/crud/delete.html.njk)
- [完了](../../src/sample/pages/crud/complete.html.njk)

共通 layout / component の詳細は [Dashboard例](11-dashboard-example.md) と [Nunjucksの使い方](08-nunjucks.md) を参照してください。

## 画面の移動

```text
商品一覧
├─ 商品詳細
│  ├─ 商品編集 ──→ 処理完了
│  └─ 商品削除確認 ──→ 処理完了
└─ 商品登録 ──→ 処理完了

処理完了
├─ 商品一覧へ戻る
└─ Portal へ戻る
```

主な戻り先:

| 画面 | 戻るリンク |
| ---- | ---------- |
| 詳細 | 一覧 |
| 登録 | 一覧 |
| 編集 | 詳細 |
| 削除確認 | 詳細（削除せずに戻る） |
| 完了 | 一覧 / Portal |

## 商品一覧

template 内の `products` 配列を `for` で表示します。

```nunjucks
{% for product in products %}
  <tr>
    <td>{{ product.id }}</td>
    <td><a href="detail.html">{{ product.name }}</a></td>
    ...
  </tr>
{% endfor %}
```

- table に caption / `scope="col"` がある
- 商品名と「詳細」はどちらも `detail.html` へ
- 「商品を登録する」は `create.html` へ
- status は `if` で badge を切替

## 商品詳細

単一の `product` object を page 内で定義し、表示します。

```nunjucks
{% set product = {
  id: "P-001",
  name: "サンプル商品A",
  ...
} %}
```

- URL パラメータに応じた動的な取得ではない
- 編集 / 削除 / 一覧への navigation がある

## 商品登録

form の見た目だけを持つ画面です。

| 項目 | 属性の例 |
| ---- | -------- |
| 商品ID / 商品名 / カテゴリ / 価格 | `readonly` の text input |
| ステータス | `disabled` の select |
| 商品説明 | `readonly` の textarea |

- 実際の submit はない
- 「登録する」は `complete.html` への静的リンク
- validation も入力保存もない

## 商品編集

登録画面に近い構成で、静的な初期値が入っています。

- 詳細画面の固定商品を編集する体裁
- 「更新する」も `complete.html` への静的リンク
- 実際の更新処理はない

> **Note**
>
> 登録と編集で form を macro / include にまとめていません。  
> 静的 UI sample として、画面ごとの構成を追いやすくするためです。

## 商品削除確認

削除対象の静的情報と注意文を示します。

- heading / 本文で「削除は実行されない」ことを明示
- 「削除する」は色付きボタンだが、実際の削除は行わず `complete.html` へ移動

## 処理完了

登録・更新・削除の流れから共通で使う静的な完了 page です。

- どの操作が成功したかを判定しない
- 一覧または Portal へ戻れる

## Nunjucks 文法 mapping

| 文法 | file | 用途 |
| ---- | ---- | ---- |
| `set` array | `index.html.njk` | 商品一覧 |
| `for` | `index.html.njk` | table row |
| `if` | `index.html.njk` | status badge |
| `set` object | `detail.html.njk` など | 静的な商品 |
| variable output | 複数 page | 商品情報の表示 |

基礎文法は [Nunjucksの使い方](08-nunjucks.md) を参照してください。

## CRUD CSS

| 項目 | パス |
| ---- | ---- |
| source | [`pages/crud/assets/css/crud.css`](../../src/sample/pages/crud/assets/css/crud.css) |
| output | `dist/sample/crud/assets/css/crud.css` |
| HTML | `assets/css/crud.css` |

共通の見た目は `common.css`、CRUD 画面群の差分は `crud.css` が担当します。

## 新しい CRUD 画面への拡張

例:

- 一覧の column を増やす
- 詳細の項目を増やす
- 確認 page を分ける
- 完了 page を操作ごとに分ける
- CRUD 専用 CSS を拡張する

実際の backend 連携は JSKim の外（application 側）の作業です。

## Backend とつなぐ場合

概念だけ示します。

- JSKim の build 結果は静的ファイル
- API を呼ぶ JavaScript は利用者が別途書く
- server-side でデータを注入する framework ではない
- database / 認証 / 認可も JSKim の範囲外

特定の backend framework の実装例は、このガイドでは扱いません。

## Sample の限界

- 実際の CRUD 処理はない
- form submit はない
- validation はない
- persistence はない
- URL パラメータ別の詳細表示はない
- 外部 mock data file はない

詳細は [制限事項](14-limitations.md) を参照してください。
