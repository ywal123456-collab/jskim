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
- 推奨設定は `files` pipeline とし、`render` / `copy` は legacy mode として継続サポートする
- 同じ project で `files` と `render` / `copy` を同時に使わせない
- `sourceDir` / `outputDir` はワークスペースルート基準、`files[].from` / `render[].from` / `templates[]` / `copy[].from` は sourceDir 基準、`files[].to` / `render[].to` / `copy[].to` は outputDir 基準
- files mode では `*.njk` は末尾 `.njk` だけを外してレンダリングし、それ以外は byte copy する
- files mode では出力パス衝突を検出し、`templates[]` 配下を直接出力しない
- `data.rootPath` は予約語衝突として扱う
- Nunjucks は `autoescape: true` を維持する。JS/JSON 埋め込み用 filter は `SafeString` を返す
- `data` / sample / docs に secret、API key、token、内部 URL を含めない
- Windows と POSIX の両方で `node:path` を使う。HTML 内パスは `/` を使う

## build / watch / serve / dev

- `build` と `watch` / `dev` は同じ build core（`scripts/lib/build-project.js`）を使う
- `watch` と `dev` は同じ watcher core（`scripts/lib/create-project-watcher.js`）を使う
- `serve` と `dev` は同じ静的サーバー core（`scripts/lib/create-static-server.js`）を使う
- `bin/jskim.js` と既存 CLI（`scripts/*.js`）は同じ command runner（`scripts/commands/`）を使う
- CLI を `child_process` で組み合わせない。`watch.js` / `serve.js` を require して side effect を起こさない
- watch に files/render/copy パスやビルド規則をハードコードしない。監視パスもマージ済み config から計算する
- watch / dev 中の Nunjucks/レンダリングエラーでプロセスを不用意に終了させない
- `serve` は `outputDir` だけを提供する。build / watch ロジックを再実装しない
- `serve` のレスポンスは変換しない（ライブリロード script を入れない）
- `dev` は build/watch/serve の共通 core を再利用する
- ライブリロード用 script を `dist` に書き込まない。dev の HTML レスポンスだけに注入する
- ビルド成功時だけ reload event を送信する
- `outputDir` 外のファイルを絶対に提供しない
- `jskim.config.js` 変更の hot reload は `watch` / `dev` で行う
- `serve` / `build` は config を監視しない
- HTML import / migration 機能を JSKim core へ追加しない
- 既存 HTML の移行は利用者の責任範囲とする
- 必要な場合は独立 package として別途検討する
- core roadmap の未実装項目として扱わない
- ブラウザ自動起動や HMR は要求された段階でのみ検討する

## package 名と binary 名

- engine package 名は `@ywal123456/jskim` とする
- CLI binary 名は `jskim` のまま維持する
- `create-jskim` package 名は変更しない
- `npm create jskim@latest` の利用形態を維持する
- 生成 project の `devDependencies` には `@ywal123456/jskim` を設定する
- `@ywal123456/jskim` と `create-jskim` は npm registry で公開済みである
- README と docs で未公開または公開予定と表現しない
- engine package 名と CLI binary 名を区別する
- release 時は engine を creator より先に公開する
- 同じ name / version を再 publish できると仮定しない
- 文書のみの修正でも npm package README を更新する場合は patch version を使用する
- `v0.1.0` tag を移動または再作成しない
- scoped engine の publish では `--access public` を指定する
- root package の `publishConfig` は public npm registry と public access を指定する

## create-jskim

- `create-jskim` は JSKim engine とは独立した package として管理する
- root の engine package 構造を不要に移動しない
- 生成されたプロジェクトには `src/sample` を標準で含める
- 自動で `npm install` や `git init` を実行しない
- 既存の空ではないディレクトリを上書きしない
- `template/gitignore` を生成時に `.gitignore` へ変換する
- root の `src/sample` を変更した場合は `create-jskim/template` も確認する
- 生成 sample は files pipeline 構造（`src/sample/pages`、`layouts`、`components`）を標準にする
- 生成 project の標準ファイル名は `index.html.njk`、`style.css.njk`、`main.js.njk` のように最終拡張子 + `.njk` を推奨する
- create-jskim のコメント・文書・CLI メッセージは日本語で作成する
- 識別子と command は英語を使用する
- Cursor の完了報告は韓国語で作成する

## 実装原則

- `dist/` を手編集しない。常にビルドで生成する
- 不要な package と抽象化を追加しない
- CommonJS を維持する。`"type": "module"` を追加しない
- formatter 機能や自動整形フローを JSKim の機能として追加・記載しない
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
- Root full は `npm test` を使う（`pretest` で Companion dist を build してから実行する）
- Companion dist を消費する Root targeted test は `npm run test:root-file -- <test file...>` を使う
- `node --test` を直接実行した dist 消費テストは最新 Companion dist を保証しないため、release 検証の根拠にしない

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
- sample は files pipeline、data、filter/global、layout/include、ページ別 assets を小さく示す技術サンプルに留め、特定ドメインの業務画面のようにしない
- ユーザー依頼なしに Git コマンドを実行しない
