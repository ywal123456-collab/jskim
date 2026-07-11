# 公開手順（publishing）

この文書は **将来の実際の publish 手順** をまとめたものです。
開発リポジトリの通常作業では `npm publish` を実行しません。

## 前提

- npm アカウントと認証（2FA ポリシーを含む）
- 公開 package 名が空いていること
  - engine: `jskim`
  - creator: `create-jskim`

### 確定済み metadata

```text
license: MIT
author: Jeongsub Kim <ywal123456@gmail.com>
repository: https://github.com/ywal123456-collab/jskim
homepage: https://github.com/ywal123456-collab/jskim#readme
bugs: https://github.com/ywal123456-collab/jskim/issues
```

### 残りの運用判断

```text
- 実際の npm publish 時点
- npm アカウントのログイン状態
- npm 2FA 状態
- GitHub への初回 push
```

## 認証とセキュリティ

- 実際の publish には npm account 認証が必要です
- 2FA の有効化と運用ポリシーを確認してください
- token をソースコードや文書に記録しないでください
- `.npmrc` の認証情報を repository に含めないでください
- publish 直前に `npm whoami` でログイン状態を確認してください
- 公開前に会社固有情報・secret・内部 URL が残っていないことを確認してください

## 推奨順序

Engine を先に publish します。生成プロジェクトの `package.json` が `jskim` を参照するため、creator だけ先に公開すると生成直後の `npm install` が失敗し得ます。

1. npm account と認証状態を確認する
2. package 名を再確認する
3. リポジトリ root で `npm test` を実行する
4. engine の `npm pack` / `npm publish --dry-run` を確認する
5. creator の `npm pack` / `npm publish --dry-run` を確認する
6. **engine を先に publish** する
7. registry から engine をインストールできることを確認する
8. creator を publish する
9. `npm create jskim@latest` を検証する

## コマンド例（ユーザーが実行）

リポジトリ root:

```bash
npm whoami
npm view jskim name version --registry=https://registry.npmjs.org
npm view create-jskim name version --registry=https://registry.npmjs.org
npm test
npm publish --dry-run --registry=https://registry.npmjs.org
npm publish --registry=https://registry.npmjs.org
```

Creator:

```bash
cd create-jskim
npm publish --dry-run --registry=https://registry.npmjs.org
npm publish --registry=https://registry.npmjs.org
```

公開後の確認例:

```bash
npm install --save-dev jskim
npm create jskim@latest
npx create-jskim my-project
```

## 注意

- lifecycle script（`prepublishOnly` など）は、creator を別 cwd から publish する構成との相性を考えて必須化していません
- publish 前チェックリストとして **手動の `npm test`** を必須とします
- token 生成・login・owner / dist-tag 変更は運用者が責任を持って行います
- 生成プロジェクトへ License を強制しません（ユーザー側で決定）
