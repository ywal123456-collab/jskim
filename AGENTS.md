# AGENTS.md — JSKim 開発用ルール

このファイルは **JSKim 開発リポジトリ専用** です。将来の npm 配布対象からは除外する予定です。

JSKim 製品自体は AI フレームワークではありません。Cursor でこのリポジトリを開発するときにエージェントが従う原則を書きます。

## 言語ポリシー

- コード識別子（ファイル名、変数名、関数名、設定 key、CLI コマンドなど）は **英語** のままにする
- 人が読む説明（コメント、ドキュメント、ログ、エラー、sample 画面）は **日本語** にする
- Cursor の作業完了報告は **韓国語** で書く

## 製品の位置づけ

- JSKim は汎用の Nunjucks 静的 HTML ビルド環境である
- 特定の業務構造、会社/顧客画面、管理 UI を追加しない
- API、バックエンド、認証、DB、状態管理、業務ロジックをフレームワークに入れない
- CSS/JS 設計方式と Git 運用方式を強制しない

## 設定とパス

- すべての動作は `jskim.config.js` を基準にする
- npm パッケージとして実行する場合も `process.cwd()` をプロジェクトルートとして扱う
- パッケージのインストール先をユーザーのプロジェクトルートとして扱わない
- パスを build / watch / serve / dev コードにハードコードしない
- `sourceDir` / `outputDir` はワークスペースルート基準、render/templates/copy の from は sourceDir 基準、to は outputDir 基準
- Windows と POSIX の両方で `node:path` を使う。HTML 内パスは `/` を使う

## build / watch / serve / dev

- `build` と `watch` / `dev` は同じ build core（`scripts/lib/build-project.js`）を使う
- `watch` と `dev` は同じ watcher core（`scripts/lib/create-project-watcher.js`）を使う
- `serve` と `dev` は同じ静的サーバー core（`scripts/lib/create-static-server.js`）を使う
- `bin/jskim.js` と既存 CLI（`scripts/*.js`）は同じ command runner（`scripts/commands/`）を使う
- CLI を `child_process` で組み合わせない。`watch.js` / `serve.js` を require して side effect を起こさない
- watch に render/copy パスやビルド規則をハードコードしない。監視パスもマージ済み config から計算する
- watch / dev 中の Nunjucks/レンダリングエラーでプロセスを不用意に終了させない
- `serve` は `outputDir` だけを提供する。build / watch ロジックを再実装しない
- `serve` のレスポンスは変換しない（ライブリロード script を入れない）
- `dev` は build/watch/serve の共通 core を再利用する
- ライブリロード用 script を `dist` に書き込まない。dev の HTML レスポンスだけに注入する
- ビルド成功時だけ reload event を送信する
- `outputDir` 外のファイルを絶対に提供しない
- `jskim.config.js` 変更の hot reload はこの段階では行わない。watch / dev は再起動する
- ブラウザ自動起動や HMR は要求された段階でのみ検討する

## package 名と binary 名

- engine package 名は `@ywal123456/jskim` とする
- CLI binary 名は `jskim` のまま維持する
- `create-jskim` package 名は変更しない
- `npm create jskim@latest` の利用形態を維持する
- 生成 project の `devDependencies` には `@ywal123456/jskim` を設定する
- scoped engine の初回 publish では `--access public` を指定する
- root package の `publishConfig` は public npm registry と public access を指定する
- package 名と binary 名を混同しない

## create-jskim

- `create-jskim` は JSKim engine とは独立した package として管理する
- root の engine package 構造を不要に移動しない
- 生成されたプロジェクトには `src/sample` を標準で含める
- 自動で `npm install` や `git init` を実行しない
- 既存の空ではないディレクトリを上書きしない
- `template/gitignore` を生成時に `.gitignore` へ変換する
- root の `src/sample` を変更した場合は `create-jskim/template` も確認する
- create-jskim のコメント・文書・CLI メッセージは日本語で作成する
- 識別子と command は英語を使用する
- Cursor の完了報告は韓国語で作成する

## 実装原則

- `dist/` を手編集しない。常にビルドで生成する
- 不要な package と抽象化を追加しない
- CommonJS を維持する。`"type": "module"` を追加しない
- reusable core（`scripts/lib`）から `process.exit` を呼び出さない。終了は CLI entry が決める
- process signal（SIGINT/SIGTERM）は CLI entry / command runner で管理する
- 配布対象は `package.json` の `files` で明示する
- `AGENTS.md`、`.cursor`、`src`、`dist`、`test` はエンジンパッケージへ含めない
- 実装後は実際に `npm run build -- <project>` / 必要なら `watch` / `serve` / `dev` / `npm test` を実行して検証する

## テスト

- 新しい機能を追加した場合は関連する回帰テストを追加する
- 新しい CLI 機能には回帰テストを追加する
- テストでは実際の `src/sample` と `dist/sample` を直接変更しない。一時ワークスペースを使う
- テスト名と説明は日本語、識別子は英語とする
- 外部テスト framework を増やさず、Node 標準の `node:test` を優先する

## 開発専用ファイル

次のファイルは開発用であり、npm パッケージ配布対象ではない。

- `AGENTS.md`
- `.cursor/`（ルール含む）
- `src/`
- `dist/`
- `test/`
- `jskim.config.js`（開発用サンプル設定）

## 公開 metadata / License

- `@ywal123456/jskim` と `create-jskim` は MIT License で公開する
- `LICENSE` の標準文面を省略または変更しない
- Copyright 表記は `2026 Jeongsub Kim` とする
- 生成されるユーザープロジェクトへ License を強制しない
- package metadata の author email は `ywal123456@gmail.com` とする
- repository は `https://github.com/ywal123456-collab/jskim` を使用する
- 公開前に会社固有情報、顧客情報、secret、内部 URL を確認する
- 検出した secret らしき値を完了報告へそのまま出力しない

## 変更時の注意

- 範囲を超える改善は実装せず提案だけにする
- sample は技術ドキュメント型を維持し、特定ドメインの業務画面のようにしない
- ユーザー依頼なしに Git コマンドを実行しない
