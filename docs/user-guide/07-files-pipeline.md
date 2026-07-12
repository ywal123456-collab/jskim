# files pipeline

この章では、JSKim が source を output に変換する files pipeline の規則を説明します。  
公式 sample の配置は [プロジェクト構成](03-project-structure.md) もあわせて参照してください。

## pipeline の概要

推奨設定では、`files` の各 entry から処理計画を作ります。

```text
files[].from 配下を探索
        │
        ├─ 末尾が .njk ── Nunjucks render ── output（.njk を外す）
        └─ それ以外 ──── byte copy ──────── output
```

`templates` に指定した実在ディレクトリ配下は、計画から除外され、直接 output されません。

## files entry

公式 sample の設定:

```js
files: [
  {
    from: 'pages',
    to: '',
  },
]
```

| field | 意味 |
| ----- | ---- |
| `from: 'pages'` | `sourceDir/pages` を探索する |
| `to: ''` | `outputDir` ルートへ出す |

そのため、例えば次のように対応します。

```text
src/sample/pages/index.html.njk
→ dist/sample/index.html
```

## render 対象

判定は **パス末尾が `.njk`（小文字）かどうか** です。

| source | 処理 |
| ------ | ---- |
| `index.html.njk` | render → `index.html` |
| `style.css.njk` | render → `style.css` |
| `main.js.njk` | render → `main.js` |
| `common.css` | copy |
| `logo.svg` | copy |
| `note.NJK` | copy（末尾が `.njk` ではない） |

> **Note**
>
> 判定は case-sensitive です。`.NJK` や `.Njk` は render しません。

ディレクトリ自体は出力対象ではなく、配下のファイルが対象です。

## output のファイル名

render 時は、末尾の `.njk` **4 文字だけ** を外します。

```text
index.html.njk → index.html
style.css.njk  → style.css
main.js.njk    → main.js
```

> **Note**
>
> `example.njk.njk` のように二重になっている場合も、末尾の 1 回分だけ外します。  
> 結果のファイル名は `example.njk` になります。

## copy 対象

末尾が `.njk` でないファイルは byte copy します。

- 内容を変換しません
- 文字コード変換も行いません
- 公式 sample の平文 CSS や SVG がこれに当たります

例:

- [common.css](../../src/sample/pages/assets/css/common.css)
- [logo.svg](../../src/sample/pages/assets/img/logo.svg)

## directory 構造の維持

`from` 配下の相対パスは、`to` 基準で output 側にも維持されます。

```text
pages/crud/detail.html.njk
→ dist/sample/crud/detail.html

pages/dashboard/assets/css/dashboard.css
→ dist/sample/dashboard/assets/css/dashboard.css
```

## template root

次の設定があるとき、`layouts` と `components` は template root です。

```js
templates: [
  'layouts',
  'components',
]
```

用途:

- `{% extends "layouts/base.njk" %}`
- `{% include "components/header.njk" %}`

これらは配布用 HTML としては直接生成されません。  
例: [base.njk](../../src/sample/layouts/base.njk)

## rootPath

各 render ページには、output 上の位置から `outputDir` ルートへ戻る相対パス `rootPath` が入ります。

計算の考え方:

1. output ファイルのディレクトリから `outputDir` への相対パスを取る
2. HTML 用に `/` 区切りにする
3. 空なら `./` にする（末尾に `/` を付ける）

公式 sample（`outputDir = dist/sample`）での例:

| output page | `rootPath` |
| ----------- | ---------- |
| `index.html` | `./` |
| `dashboard/index.html` | `../` |
| `crud/detail.html` | `../` |
| さらに深い階層（例: `a/b/c.html`） | `../../` |

共通 asset の参照例（layout）:

```nunjucks
<link rel="stylesheet" href="{{ rootPath }}assets/css/common.css">
```

`data.rootPath` で上書きすることはできません。

## 共通 asset と page-local asset

### 共通 asset

```text
pages/assets/css/common.css
→ assets/css/common.css
```

深い階層のページからも同じ場所を指すため、`rootPath` を使います。

```nunjucks
{{ rootPath }}assets/css/common.css
```

### page-local asset

```text
pages/crud/assets/css/crud.css
→ crud/assets/css/crud.css
```

同じ画面グループからの相対パスで参照します。

```html
<link rel="stylesheet" href="assets/css/crud.css">
```

> **Warning**
>
> page-local CSS に `rootPath` を付けないでください。
>
> ```nunjucks
> {{ rootPath }}assets/css/crud.css
> ```
>
> これは output root の `assets/css/crud.css` を指します。  
> 実際のファイルは `crud/assets/css/crud.css` にあるため、パスがずれます。

| 種類 | 置き場所 | 参照 |
| ---- | -------- | ---- |
| 共通 | `pages/assets/...` | `{{ rootPath }}assets/...` |
| page-local | `pages/<group>/assets/...` | `assets/...`（相対） |

実例:

- 共通: [common.css](../../src/sample/pages/assets/css/common.css)
- Dashboard: [dashboard.css](../../src/sample/pages/dashboard/assets/css/dashboard.css)
- CRUD: [crud.css](../../src/sample/pages/crud/assets/css/crud.css)
- Wizard: [wizard.css](../../src/sample/pages/wizard/assets/css/wizard.css)

## 複数の files entry

複数の entry を書くと、それぞれの計画が結合されます。

```js
files: [
  { from: 'pages', to: '' },
  { from: 'shared-images', to: 'assets/img' },
]
```

別々の source を、異なる output 位置へ出せます。  
ただし最終的な output path が同じになると衝突エラーになります。

## output の衝突

次のような場合、build は失敗します。

- 2 つの source が同じ output path を生成する
- `main.js` と `main.js.njk` のように、suffix 除去後に同じパスになる
- Windows で大文字小文字だけが違う path（同一扱いになり衝突）

衝突は、ファイルを書き始める前の計画段階で検出されます。  
エラーメッセージの読み方は [エラーとトラブルシュート](10-errors-and-troubleshooting.md) を参照してください。

## clean

`build.clean` の既定値は `true` です。

| 値 | 動作 |
| -- | ---- |
| `true` | build 前に `outputDir` を削除してから再生成 |
| `false` | 既存ファイルを残したまま上書き生成 |

`watch` / `dev` の再 build でも、`clean: true` なら毎回フル clean + 全体再 build です。  
そのため、source から消したファイルは、次の成功 build で output からも消えます。

危険な `outputDir`（ワークスペースルート全体など）への clean は拒否されます。

## watch 中の変更・削除

概要のみ示します。

| 変化 | 結果の考え方 |
| ---- | ------------ |
| ファイル修正 | 再 build で output 更新 |
| 新規ファイル | 再 build で追加 |
| 削除 | `clean: true` なら output からも消える |
| layout / component 変更 | 依存ページも含めて再 build |
| config 変更 | `watch` / `dev` では検知できる（詳細は [開発機能](09-development-features.md)） |

debounce や live reload の詳細は [開発機能](09-development-features.md) を参照してください。

## 安全な asset 配置の目安

| 目的 | 置き場所 / 命名 |
| ---- | ---------------- |
| 全ページ共通 | `pages/assets/` |
| 特定画面群だけ | その画面群の `assets/` |
| Nunjucks で生成したい CSS / JS | 末尾に `.njk`（例: `style.css.njk`） |
| そのままコピーしたいファイル | 平文の拡張子（例: `common.css`, `logo.svg`） |
| layout / component | `templates` に指定した root |

## 公式 sample の対応表

| source | 処理 | output |
| ------ | ---- | ------ |
| `pages/index.html.njk` | render | `index.html` |
| `pages/dashboard/index.html.njk` | render | `dashboard/index.html` |
| `pages/dashboard/assets/css/dashboard.css` | copy | `dashboard/assets/css/dashboard.css` |
| `pages/crud/detail.html.njk` | render | `crud/detail.html` |
| `pages/crud/assets/css/crud.css` | copy | `crud/assets/css/crud.css` |
| `pages/wizard/assets/css/wizard.css` | copy | `wizard/assets/css/wizard.css` |
| `pages/assets/css/common.css` | copy | `assets/css/common.css` |
| `pages/assets/img/logo.svg` | copy | `assets/img/logo.svg` |
| `layouts/base.njk` | template | 直接 output なし |
| `components/header.njk` | template | 直接 output なし |

設定の全体像は [設定](06-configuration.md)、コマンド操作は [CLIリファレンス](05-cli-reference.md) を参照してください。
