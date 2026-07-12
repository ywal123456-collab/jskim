# CLIリファレンス

この章では、現在の JSKim CLI（binary 名 `jskim`）がサポートするコマンドと option をまとめます。  
日常の選び方は [基本的な開発workflow](04-basic-workflow.md) を参照してください。

## 基本構文

```bash
jskim <command> [project] [options]
```

`project` と option の順序は入れ替えられます。

```bash
jskim serve --port 4000 sample
jskim serve sample --port 4000
jskim dev sample --open --host 127.0.0.1
```

ヘルプと version:

```bash
jskim --help
jskim -h
jskim help
jskim --version
jskim -v
```

## コマンド一覧

| command | 概要 |
| ------- | ---- |
| `build` | source から output を生成して終了する |
| `watch` | 初回 build のあと、変更を監視して再 build する |
| `serve` | 既存の `outputDir` を静的サーバーで公開する |
| `dev` | build + watch + serve + live reload の開発サーバー |

## project 引数

`project` は `jskim.config.js` の `projects` にあるキー名です。

例:

```js
projects: {
  sample: {
    sourceDir: 'src/sample',
    outputDir: 'dist/sample',
  },
}
```

このとき `jskim build sample` は `projects.sample` を対象にします。

| 状況 | 動作 |
| ---- | ---- |
| project が 1 件 | 名前を省略できる |
| project が 0 件 | エラー |
| project が 2 件以上で省略 | エラー（候補一覧を表示） |
| 存在しない名前を指定 | エラー |

エラーメッセージの詳細な読み方は [エラーとトラブルシュート](10-errors-and-troubleshooting.md) を参照してください。

## build

```bash
jskim build sample
jskim build --all
```

| 項目 | 内容 |
| ---- | ---- |
| project | 1 件指定、または 1 件だけのとき省略可 |
| `--all` | `projects` の全キーを定義順に実行 |
| project と `--all` の併用 | **不可** |
| 実行順（`--all`） | `Object.keys(projects)` の順 |
| 途中失敗 | resolve / build 失敗があっても次の project へ続行 |
| 最終 exit code | 1 件でも失敗があれば `1`、すべて成功なら `0` |
| 同一 / 入れ子の `outputDir` | `--all` では build 開始前に検査し、衝突なら中断 |

`--all` の衝突検査は、同じ path（Windows では大文字小文字を区別しない）や、厳密な祖先・子孫関係を拒否します。  
似た prefix（例: `dist/site` と `dist/site-admin`）は許可されます。

> **Tip**
>
> project 名が `all` のときは `jskim build all` が 1 件 build です。  
> 全件実行は必ず `jskim build --all` を使います。

## watch

```bash
jskim watch sample
```

| 項目 | 内容 |
| ---- | ---- |
| project | `build` と同じ選択規則 |
| 追加 option | なし |
| `--all` | **非対応** |
| 動作 | 初回 build 後、監視を継続 |
| 終了 | `Ctrl+C` など |

静的サーバーは起動しません。

## serve

```bash
jskim serve sample
jskim serve sample --host 127.0.0.1 --port 4000
```

| 項目 | 内容 |
| ---- | ---- |
| project | `build` と同じ選択規則 |
| `--host` | 待ち受け host |
| `--port` | 待ち受け port |
| 既定値 | config の `serve.host` / `serve.port`（未設定時は `127.0.0.1` / `3000`） |
| CLI と config | CLI 指定が優先 |
| `--open` | **非対応** |
| `--all` | **非対応** |
| build | 自動では行わない |

`port` は整数 `1`〜`65535` である必要があります。  
`host` は空でない文字列である必要があります。

## dev

```bash
jskim dev sample
jskim dev sample --host 127.0.0.1 --port 4000 --open
```

| 項目 | 内容 |
| ---- | ---- |
| project | `build` と同じ選択規則 |
| `--host` / `--port` | `serve` と同じ |
| `--open` | 起動後にブラウザを開く（listen 成功後に 1 回） |
| `--all` | **非対応** |
| CLI と config | host / port は CLI が優先 |

`--open` でブラウザ起動に失敗した場合は warning を出し、開発サーバー自体は継続します。  
listen に失敗した場合はブラウザ起動を試みず、process は失敗終了します。

## option 要約

| option | 使える command | 値 | 説明 |
| ------ | -------------- | -- | ---- |
| `--all` | `build` | なし | 全 project を順に build |
| `--host` | `serve`, `dev` | string | 待ち受け host |
| `--port` | `serve`, `dev` | string（検証後に整数） | 待ち受け port |
| `--open` | `dev` | なし | 起動後にブラウザを開く |

短縮形の option alias（例: `-p`）はありません。  
`--help` / `-h`、`--version` / `-v` はコマンド前のグローバル用途です。

## 引数解析の規則

次の場合はエラーになります。

- 不明な option
- その command で使えない option（例: `serve` に対する `--open`）
- option 値の欠落（例: `--port` の直後が無い）
- option の重複
- `--port=4000` のような `=` 付き記法
- `--` 単独トークン
- positional 引数が 2 件以上
- `build` で project 名と `--all` の同時指定

option は project 名の前後どちらに置いても同じ結果です。

不正な port 値（`0`、`65536`、小数、非数値など）は拒否されます。

## exit code

| 状況 | exit code |
| ---- | --------- |
| help / version | `0` |
| 引数解析エラー | `1` |
| build 失敗（単一 / `--all` で 1 件以上失敗） | `1` |
| watch / serve / dev の起動失敗 | `1` |
| `Ctrl+C` などでの正常停止 | `0` |
| `dev --open` のブラウザ起動失敗 | process 自体は継続（失敗終了にはしない） |

長時間稼働中の `watch` / `dev` では、個別の再 build 失敗があっても process を維持します。  
詳細なエラー表示は [エラーとトラブルシュート](10-errors-and-troubleshooting.md) と [開発機能](09-development-features.md) を参照してください。

## package script から使う

`create-jskim` が生成する `package.json` は、次の scripts を持ちます。

```json
{
  "scripts": {
    "build": "jskim build sample",
    "watch": "jskim watch sample",
    "serve": "jskim serve sample",
    "dev": "jskim dev sample"
  }
}
```

そのため、日常作業では次で足ります。

```bash
npm run build
npm run watch
npm run serve
npm run dev
```

CLI option を足すときは、package manager の引数渡し規則に従ってください。  
例（npm）:

```bash
npm run serve -- --port 4000
npm run dev -- --open --port 4000
```
