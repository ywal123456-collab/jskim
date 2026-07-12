# 設定

この章では、`jskim.config.js` で設定できる項目を説明します。  
既存の詳細 reference として [docs/configuration.md](../configuration.md) もありますが、ここでは初学者向けの順で整理します。

## 設定ファイル

ファイル名はワークスペースルートの `jskim.config.js` です。  
コマンドを実行したディレクトリ（`process.cwd()`）をルートとして読みます。

形式は CommonJS です。

```js
module.exports = {
  defaults: {
    // 全 project 共通の既定値
  },
  projects: {
    // project 名ごとの設定
  },
};
```

ESM（`export default`）はサポートしていません。

## 最小の設定例

必須なのは、少なくとも 1 件の project と、その `sourceDir` / `outputDir` です。  
加えて、files mode では `files`、legacy mode では `render` が必要です。

推奨の最小例（files mode）:

```js
module.exports = {
  defaults: {
    files: [{ from: 'pages', to: '' }],
    templates: ['layouts', 'components'],
  },
  projects: {
    sample: {
      sourceDir: 'src/sample',
      outputDir: 'dist/sample',
    },
  },
};
```

| key | 必須 | 備考 |
| --- | ---- | ---- |
| `projects` | 必須 | オブジェクト。1 件以上を推奨 |
| `defaults` | 任意 | 省略時は空オブジェクト扱い |
| `sourceDir` / `outputDir` | project ごとに必須 | `defaults` 側に置いても可 |
| `files` または `render` | mode に応じて必須 | 同時設定は不可 |

## 公式 sample の設定

この repository の設定は [jskim.config.js](../../jskim.config.js) です。  
理解に必要な部分だけ抜粋します（filter / global の実装全体は省略しています）。

```js
module.exports = {
  defaults: {
    files: [{ from: 'pages', to: '' }],
    templates: ['layouts', 'components'],
    data: {
      site: {
        name: 'JSKim UI Sample',
        language: 'ja',
        themeColor: '#222222',
      },
      samplePrice: 12000,
    },
    // nunjucks.filters / nunjucks.globals も定義できる
    build: { clean: true },
    watch: { debounce: 150 },
    serve: { host: '127.0.0.1', port: 3000 },
    dev: { liveReload: true },
  },
  projects: {
    sample: {
      sourceDir: 'src/sample',
      outputDir: 'dist/sample',
    },
  },
};
```

## トップレベルの構造

読み込み時に必須検査されるのは次です。

| key | 型 | 必須 | 説明 |
| --- | -- | ---- | ---- |
| `projects` | object | 必須 | project 名 → 設定 |
| `defaults` | object | 任意 | 全 project への共通既定値 |

それ以外のトップレベル key は、現在の loader では必須ではありません。  
実際の build 設定は `defaults` と各 `projects.*` をマージして使います。

## projects

`projects` は名前付き project の一覧です。

```js
projects: {
  sample: { sourceDir: 'src/sample', outputDir: 'dist/sample' },
  docs: { sourceDir: 'src/docs', outputDir: 'dist/docs' },
}
```

- 各 project は独立した `sourceDir` / `outputDir` を持てます
- CLI の project 引数はこのキー名を指します
- 空の `projects` だとコマンド実行時にエラーになります

名前の文字種に特別な禁止規則はありませんが、CLI 引数として扱いやすい英数字名を推奨します。

## sourceDir

| 項目 | 内容 |
| ---- | ---- |
| 型 | string |
| 必須 | はい（マージ後） |
| 既定値 | なし |
| 基準 | ワークスペースルート（`process.cwd()`） |
| 検証 | 空不可。実在するディレクトリであること |
| 役割 | source のルート |

## outputDir

| 項目 | 内容 |
| ---- | ---- |
| 型 | string |
| 必須 | はい（マージ後） |
| 既定値 | なし |
| 基準 | ワークスペースルート |
| 検証 | 空不可 |
| 役割 | build 結果のルート。`serve` / `dev` の公開ルートでもある |

注意点:

- `build.clean` が `true` のとき、build 前に削除されることがあります
- 手編集した output は次の build で上書きされることがあります
- `build --all` では、複数 project の `outputDir` が同一または入れ子だと開始前に中断します

## files

推奨の files pipeline 設定です。配列で、各 entry は次のフィールドを持ちます。

| field | 基準 | 必須 | 既定 | 説明 |
| ----- | ---- | ---- | ---- | ---- |
| `from` | `sourceDir` | 必須 | — | 探索開始ディレクトリ |
| `to` | `outputDir` | 任意 | `''` | 出力基準。空なら output ルート |
| `include` | `from` | 任意 | `['**/*']` | 取り込み glob |
| `exclude` | `from` | 任意 | `[]` | 除外 glob |

例:

```js
files: [
  {
    from: 'pages',
    to: '',
  },
]
```

- 複数 entry を書けます
- 同じ output path が複数 source から生成されるとエラーです
- `files` を空配列にすると files mode にはなりません（legacy 判定側へ）
- `files` と `render` / `copy` の同時設定はできません

処理の詳細は [files pipeline](07-files-pipeline.md) を参照してください。

## templates

| 項目 | 内容 |
| ---- | ---- |
| 型 | string の配列 |
| 必須 | 任意 |
| 既定値 | `[]` |
| 基準 | `sourceDir` |
| 役割 | Nunjucks loader の追加検索パス |

例:

```js
templates: ['layouts', 'components'],
```

- `extends` / `include` の解決に使います
- 実在するディレクトリ配下は、files mode では **直接 output しません**
- `sourceDir` 自体も loader root に含まれます

## data

| 項目 | 内容 |
| ---- | ---- |
| 型 | plain object（`null` 可） |
| 必須 | 任意 |
| 既定値 | 空に近い扱い（マージ結果） |
| 役割 | すべての Nunjucks render context に渡す共通データ |

公式 sample では `site.name` などを渡しています。

> **Warning**
>
> `data.rootPath` は予約語です。設定するとエラーになります。  
> `rootPath` は JSKim が各ページへ自動注入します。

## build 設定

| path | 型 | 既定 | 説明 |
| ---- | -- | ---- | ---- |
| `build.clean` | boolean | `true` | build 前に `outputDir` を削除する |

## watch 設定

| path | 型 | 既定 | 説明 |
| ---- | -- | ---- | ---- |
| `watch.debounce` | number（0 以上） | `150` | 最後の変更から再 build までの待ち時間（ミリ秒） |

## serve 設定

| path | 型 | 既定 | 説明 |
| ---- | -- | ---- | ---- |
| `serve.host` | string（空不可） | `'127.0.0.1'` | 待ち受け host |
| `serve.port` | 整数 1〜65535 | `3000` | 待ち受け port |

CLI の `--host` / `--port` がある場合は、CLI が優先されます。

## dev 設定

| path | 型 | 既定 | 説明 |
| ---- | -- | ---- | ---- |
| `dev.liveReload` | boolean | `true` | 開発中の live reload を有効にする |

## filters と globals

カスタム Nunjucks 機能は `nunjucks` 配下に書きます。

```js
nunjucks: {
  filters: {
    formatPrice(value) {
      return `${Number(value).toLocaleString('ja-JP')}円`;
    },
  },
  globals: {
    currentYear() {
      return new Date().getFullYear();
    },
  },
}
```

- `filters` の値は **function** である必要があります
- JavaScript の関数として定義します（JSON では書けません）
- 公式 sample はデモ用に定義していますが、必須ではありません
- 非同期 filter は現在サポートしていません

書き方の詳細は [Nunjucksの使い方](08-nunjucks.md) を参照してください。

## 全体 option reference

### トップレベル

| path | 型 | 必須 | 既定 | 説明 |
| ---- | -- | ---- | ---- | ---- |
| `projects` | object | 必須 | — | project 定義 |
| `defaults` | object | 任意 | `{}` | 共通既定値 |

### project / defaults で使う主な key

| path | 型 | 必須 | 既定 | 説明 |
| ---- | -- | ---- | ---- | ---- |
| `sourceDir` | string | 必須 | — | source ルート |
| `outputDir` | string | 必須 | — | output ルート |
| `files` | object[] \| 未設定 | mode 依存 | 未設定は `null` | files pipeline |
| `templates` | string[] | 任意 | `[]` | template 検索パス |
| `render` | object[] | legacy 時 | `[]` | legacy render |
| `copy` | object[] | 任意 | `[]` | legacy copy |
| `data` | object \| null | 任意 | — | 共通 template データ |
| `nunjucks.filters` | object | 任意 | `{}` | カスタム filter |
| `nunjucks.globals` | object | 任意 | `{}` | カスタム global |
| `build.clean` | boolean | 任意 | `true` | output を clean |
| `watch.debounce` | number | 任意 | `150` | 監視の debounce（ms） |
| `serve.host` | string | 任意 | `'127.0.0.1'` | サーバー host |
| `serve.port` | number | 任意 | `3000` | サーバー port |
| `dev.liveReload` | boolean | 任意 | `true` | live reload |

legacy の `render` / `copy` 詳細は [docs/configuration.md](../configuration.md) も参照してください。  
新規 project では `files` を推奨します。

## 検証と unknown key

主な検証例:

- 必須 key の欠落
- 型不正（例: `serve.port` が範囲外）
- `files` と `render` / `copy` の同時設定
- `data.rootPath` の予約衝突
- path traversal（`sourceDir` / `outputDir` の外へ出る設定）

認識していない余分な key は、現在の実装ではエラーにせず無視されることがあります。  
厳密な schema エンジンではありません。

エラー時の具体メッセージと復旧手順は [エラーとトラブルシュート](10-errors-and-troubleshooting.md) を参照してください。

## 設定変更の反映

| command | config の読み方 |
| ------- | ---------------- |
| `build` | 開始時に 1 回 |
| `serve` | 開始時に 1 回（監視しない） |
| `watch` / `dev` | 開始時に読み、実行中の変更も検知できる |

`dev` では、次の値が変わると process 再起動が必要です。

- `outputDir`
- `serve.host`
- `serve.port`
- `dev.liveReload`

CLI で指定した `--host` / `--port` は、reload 後も維持されます。  
不正な config を書いた場合は、直前まで有効だった設定を維持する動作があります。

詳細な hot reload の挙動は [開発機能](09-development-features.md) を参照してください。

## 複数 project の例

`outputDir` が衝突しないように分けます。

```js
module.exports = {
  defaults: {
    files: [{ from: 'pages', to: '' }],
    templates: ['layouts', 'components'],
    serve: { host: '127.0.0.1', port: 3000 },
  },
  projects: {
    siteA: {
      sourceDir: 'src/site-a',
      outputDir: 'dist/site-a',
    },
    siteB: {
      sourceDir: 'src/site-b',
      outputDir: 'dist/site-b',
    },
  },
};
```

```bash
jskim build siteA
jskim build --all
jskim dev siteB --port 4000
```
