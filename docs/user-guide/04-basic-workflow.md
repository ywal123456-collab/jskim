# 基本的な開発workflow

この章では、`build` / `watch` / `serve` / `dev` の違いと、日常開発での選び方を説明します。  
個別 option の詳細は [CLIリファレンス](05-cli-reference.md) を参照してください。

## 全体の流れ

開発の基本的な流れは次のとおりです。

```text
src/sample/ を編集
        ↓
   build または watch
        ↓
   dist/sample/ へ output
        ↓
   serve または dev で確認
```

`dev` は、初回の build、変更監視（watch）、静的サーバー（serve）、開発用の live reload をまとめて行う統合コマンドです。  
日常の画面確認では、まず `dev` を使うのが簡単です。

## build

`build` は、いまの source から output を **1 回** 生成して終了します。

用途の例:

- production 向け output の確認
- 配布前の最終生成
- CI など、一度だけ成果物が欲しい場面

生成 project では次を使います。

```bash
npm run build
```

これは `jskim build sample` と同じです。

成功すると process は終了します（exit code `0`）。  
設定や render の失敗などがあると、エラーを出して終了します（exit code `1`）。

既定では `build.clean` が `true` のため、build 前に `outputDir` を削除してから再生成します。  
詳細は [設定](06-configuration.md) と [files pipeline](07-files-pipeline.md) を参照してください。

## watch

`watch` は source の変更を監視し、変更のたびに output を更新します。

```bash
npm run watch
```

これは `jskim watch sample` と同じです。

特徴:

- 初回に build を行い、その後も監視を続ける
- 開発用の静的サーバーは起動しない
- ブラウザへの配信や live reload は行わない
- `jskim.config.js` の変更も検知できる（概要。詳細は [開発機能](09-development-features.md)）

「output だけを更新し続けたい」「サーバーは別手段で見る」場合に向きます。

## serve

`serve` は、すでに生成された `outputDir` を静的サーバーとして公開します。

```bash
npm run serve
```

これは `jskim serve sample` と同じです。

特徴:

- build や watch は自動では行わない
- source を編集しても自動では再 build しない
- 既定の host / port は `127.0.0.1` / `3000`
- CLI で `--host` / `--port` を指定できる
- `--open` は **サポートしていない**

既存の `dist/` を手元で確認したいときに使います。  
最新の source を反映したい場合は、先に `build` するか、`dev` を使ってください。

## dev

`dev` は開発用の統合コマンドです。

```bash
npm run dev
```

これは `jskim dev sample` と同じです。

実際には次をまとめて行います。

1. 初回 build
2. source / config の監視と再 build
3. `outputDir` の静的サーバー
4. 開発用 live reload（既定で有効）

既定の URL:

```text
http://127.0.0.1:3000/
```

使える option の例:

```bash
jskim dev sample --host 127.0.0.1 --port 4000 --open
```

- `--host` / `--port` — 待ち受け設定（config より優先）
- `--open` — サーバー起動後にブラウザを開く（`dev` のみ）

source や設定の誤りがあっても、開発中の process をすぐ終了させない設計です。  
error overlay や CSS soft reload の詳細は [開発機能](09-development-features.md) を参照してください。

## コマンドの選び方

| 目的 | 推奨コマンド |
| ---- | ------------ |
| 一度だけ output を作る | `build` |
| 変更を監視して output を更新し続ける | `watch` |
| 既存の `dist/` をブラウザで確認する | `serve` |
| 編集しながらブラウザで開発する | `dev` |

## 一般的な開発の順序

1. dependency を入れる

```bash
npm install
```

2. 開発サーバーを起動する

```bash
npm run dev
```

3. `src/sample/` を編集し、ブラウザで確認する

4. 配布用に最終 build する

```bash
npm run build
```

5. `dist/sample/` を確認する

配置先の手順は hosting 環境ごとに異なるため、このガイドでは扱いません。

## process の終了

`watch` / `serve` / `dev` は foreground で動き続けます。  
終了するときは端末で `Ctrl+C` を送ります。

終了時は、サーバーや watcher を止めてから process が終わります。  
成功時の停止では exit code `0` になります。

JSKim 自体に、外部 process manager のような常駐管理機能はありません。

## project が複数ある場合

`jskim.config.js` の `projects` に複数の名前がある場合は、コマンドに project 名を付けます。

```bash
jskim build siteA
jskim watch siteB
```

project が **1 件だけ** のときは、名前を省略できます。  
**2 件以上** あるときに省略するとエラーになります。

例外として、`build` だけは次で全 project を実行できます。

```bash
jskim build --all
```

`watch` / `serve` / `dev` に `--all` はありません。  
詳細な構文は [CLIリファレンス](05-cli-reference.md) を参照してください。
