# エラーとトラブルシュート

この章では、よくある問題の症状、原因、JSKim の動作、確認方法、解決の手がかりを整理します。  
CLI の構文は [CLIリファレンス](05-cli-reference.md)、設定は [設定](06-configuration.md) も参照してください。

## エラー処理の概要

| 状況 | `build` | `watch` | `serve` | `dev` |
| ---- | ------- | ------- | ------- | ----- |
| template / render エラー | 終了（失敗） | process 維持 | — | process 維持 + overlay 可 |
| config エラー（起動時） | 終了（失敗） | 終了（失敗） | 終了（失敗） | 終了（失敗） |
| config エラー（実行中の再読込） | — | last-known-good を維持 | — | 維持 + overlay 可 |
| port 衝突 | — | — | 起動失敗で終了 | 起動失敗で終了 |

`—` はその command では通常起きない、または直接関係しないことを表します。

## 問題を調べる基本の順序

1. terminal のメッセージを読む
2. `dev` なら browser overlay も確認する
3. 直前に編集した file を見直す
4. `jskim.config.js` と path を確認する
5. port / 別 process の占有を確認する
6. restart-required の設定変更なら command を再起動する

いきなり依存関係の再インストールやキャッシュ削除から始めないでください。

## Unknown command / option

### 症状

コマンドや option が認識されない。

### 原因

- 存在しない command 名
- その command で使えない option
- `--port=4000` のような `=` 付き記法
- `--` 単独トークン
- option の重複や値の欠落

### JSKim の動作

引数解析の段階で失敗し、process は終了します（exit code `1`）。

代表メッセージ:

```text
[JSKim] 不明なコマンドです: <command>
```

```text
[JSKim] 不明なoptionです: <token>
```

### 確認・解決

- `jskim --help` で使える command を確認する
- `serve` に `--open` は無い（`dev --open` を使う）
- `--port 4000` のようにスペース区切りで書く

## Project 選択のエラー

### 症状

どの project を対象にするか決められない。

### 原因と動作

| 状況 | 結果 |
| ---- | ---- |
| `projects` が 0 件 | エラー |
| 1 件だけ | 名前省略可 |
| 2 件以上で省略 | エラー（候補一覧） |
| 存在しない名前 | エラー |
| project 名と `--all` の同時指定 | エラー |

代表メッセージ:

```text
[JSKim] projectを指定してください。
```

### 解決例

```bash
jskim build sample
jskim build --all
```

## Config file の読み込みエラー

### 症状

起動直後に設定を読めない。

### 原因の例

- ワークスペースに `jskim.config.js` が無い
- JavaScript の構文エラー
- `module.exports` がオブジェクトでない
- ESM（`export default`）形式を使っている
- require 時の例外

代表メッセージ:

```text
[JSKim] 設定ファイルが見つかりません: jskim.config.js
```

### 解決

- コマンドを project ルートで実行する
- CommonJS（`module.exports = { ... }`）で書く
- 構文エラーを修正する

## Config 検証エラー

### 症状

設定は読めたが、値が不正。

### よくある原因

- `projects` が無い / オブジェクトでない
- `sourceDir` / `outputDir` の欠落や未存在
- `files` と `render` / `copy` の同時設定
- `serve.port` / `watch.debounce` の型や範囲不正
- `data.rootPath`（予約語衝突）

> **Note**
>
> 認識していない余分な key は、必ずしもエラーになりません。  
> 無視されることがあります。

### 解決

[設定](06-configuration.md) の型と既定値を確認し、問題の key だけ直します。

## Template / render エラー

### 症状

Nunjucks の構文ミス、見つからない `extends` / `include`、filter 実行時エラーなど。

### JSKim の動作

| command | 動作 |
| ------- | ---- |
| `build` | 失敗して終了（exit code `1`） |
| `watch` / `dev` | terminal に表示。process は維持。`dev` では overlay 可 |

代表的な見出し:

```text
[JSKim] プロジェクト "<name>" の Nunjucks レンダリングに失敗しました。
```

### 確認・解決

1. 表示されたソース / テンプレート path を開く
2. `extends` / `include` のパスが template root 基準か確認する
3. 修正して保存する（`watch` / `dev` なら再 build）
4. 成功すれば overlay は消える

文法の基本は [Nunjucksの使い方](08-nunjucks.md) を参照してください。

## Output パスの衝突

### 症状

同じ output を複数の source が生成しようとする。

### 原因の例

- 複数の `files` entry が同じ出力先に重なる
- `main.js` と `main.js.njk` のように suffix 除去後に同名になる
- Windows で大文字小文字だけが違う path

### JSKim の動作

書き込み前の計画段階で検出し、build は失敗します。

### 解決

- `from` / `to` / ファイル名を分ける
- どちらかを `exclude` する
- 命名規則を揃える

詳細は [files pipeline](07-files-pipeline.md) を参照してください。

## 複数 project の outputDir 衝突

### 症状

`jskim build --all` が開始前に止まる。

### 原因

- 同じ `outputDir`
- 入れ子（祖先 / 子孫）の `outputDir`

これは files 内の output 衝突とは別です。project 間の互換性検査です。

### 解決

各 project の `outputDir` を重ならない場所に分けます。

```js
projects: {
  siteA: { sourceDir: 'src/a', outputDir: 'dist/a' },
  siteB: { sourceDir: 'src/b', outputDir: 'dist/b' },
}
```

## Port already in use

### 症状

`serve` / `dev` が待ち受けできない。

### 原因

既定の `3000`（または指定 port）を他 process が使用中（`EADDRINUSE`）。

代表メッセージ:

```text
[JSKim] ポート <port> はすでに使用されています。
```

### JSKim の動作

自動で次の空き port を探しません。起動に失敗した process は終了します。

### 解決例

```bash
jskim dev sample --port 3001
```

または `jskim.config.js` の `serve.port` を変更します。  
占有している process を止める方法は OS によって異なります。

## 不正な host / port

### 症状

CLI または config の待ち受け設定が拒否される。

### 原因の例

- `--port` の値欠落
- `0` / `65536` / 小数 / 非数値
- 空の host

検出は CLI 解析または設定検証の段階です。

### 正しい例

```bash
jskim serve sample --host 127.0.0.1 --port 4000
```

## Browser open の失敗

### 症状

`dev --open` でブラウザが開かない。

### JSKim の動作

warning を出し、**開発サーバーは継続**します。process 失敗にはしません。

### 解決

terminal に表示された URL を手動で開きます。

```text
http://127.0.0.1:3000/
```

## CSS 変更が soft reload されない

### 確認順

1. `dev` で `liveReload: true` か
2. 変更が `.css` / `.css.njk` の `change` だけか
3. `templates[]` 配下の変更ではないか
4. page の `<link rel="stylesheet">` が same-origin か
5. href が実際の output を指しているか

よくある誤り（page-local）:

```nunjucks
{{ rootPath }}assets/css/crud.css
```

正しい例:

```html
<link rel="stylesheet" href="assets/css/crud.css">
```

条件を満たさない、または読み込みに失敗すると full reload になります。  
詳細は [開発機能](09-development-features.md) を参照してください。

## Browser overlay が表示されない

### 確認

- `jskim dev`（または `npm run dev`）で起動しているか
- `dev.liveReload` が `true` か
- terminal にはエラーが出ているか
- ブラウザが live reload に接続できているか（接続再試行のログ）
- Strict CSP などで注入 script が遮断されていないか（環境依存）

`serve` だけでは overlay は出ません。

## Config の修正が反映されない

### 確認

1. `watch` / `dev` で動かしているか（`build` / `serve` は監視しない）
2. 構文エラーや検証エラーで last-known-good のままになっていないか
3. restart-required（`outputDir` / `serve.host` / `serve.port` / `dev.liveReload`）ではないか
4. CLI の `--host` / `--port` が config より優先されていないか
5. terminal の warning を読んでいないか

必要なら command を止めて再起動します。

## build --all の一部失敗

### 症状

ログでは成功と失敗が混在し、最終的に失敗終了する。

### JSKim の動作

- 定義順に各 project を試す
- 途中失敗があっても次の project へ進む
- 1 件でも失敗があれば最終 exit code は `1`
- 成功した project の output は残ることがある

> **Warning**
>
> 途中の成功ログだけを見て、全体が成功したと誤解しないでください。

## 削除した source が output に残る

### 原因と動作

| `build.clean` | 削除した source の扱い |
| ------------- | ---------------------- |
| `true`（既定） | 再 build 前に `outputDir` を消すため、消えたファイルも output から無くなる |
| `false` | 上書き生成のみ。消えた source に対応する古い output が残ることがある |

`watch` / `dev` の再 build でも同様です。

### 解決

- 通常は `build.clean: true` を維持する
- `false` にしている場合は、不要ファイルを手動で整理するか、一度 clean 付き build を行う

## dist を直接編集したら消えた

### 原因

`dist/` は build の output です。次の clean / build で上書き・削除されることがあります。

### 解決

編集するのは `src/`（source）側です。  
見た目の確認用に `dist` を一時的に開くことはできますが、恒久的な修正場所にはしません。

## Internal link / asset が 404

### 確認

- source → output の対応（[files pipeline](07-files-pipeline.md)）
- 共通 asset は `{{ rootPath }}assets/...`
- page-local は `assets/...`
- 先頭 `/` の絶対パスが意図どおりか（serve の root は `outputDir`）
- Windows 以外も含め、ファイル名の大文字小文字
- そもそも build 済みか

公式 sample の例:

- 共通: `assets/css/common.css`
- CRUD: `crud/assets/css/crud.css`

## Exit code と process 維持の要約

| 状況 | process | 結果 |
| ---- | ------- | ---- |
| `build` 成功 | 終了 | exit `0` |
| `build` 失敗 | 終了 | exit `1` |
| `build --all` で 1 件以上失敗 | 終了 | exit `1` |
| `watch` / `dev` の再 build 失敗 | 維持 | エラー表示（`dev` は overlay 可） |
| `serve` / `dev` の port 衝突 | 起動失敗側は終了 | exit `1` |
| `dev --open` の失敗 | 維持 | warning |
| `Ctrl+C` での停止 | 終了 | exit `0` |

## 問い合わせ・報告に用意するとよい情報

- JSKim version（`jskim --version`）
- Node.js version
- package manager（npm / pnpm / yarn）
- OS
- 実行した command
- terminal のエラー全文（必要な範囲）
- `jskim.config.js` の関連部分
- 再現できる最小の directory 構成

> **Note**
>
> 報告前に、秘密情報、個人情報、社内専用 URL を取り除いてください。

公式の issue 先は、パッケージ / repository の案内に従ってください。  
（例: GitHub repository の Issues）
