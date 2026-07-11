# 公開手順（publishing）

この文書は **将来の実際の publish 手順** をまとめたものです。
開発リポジトリの通常作業では `npm publish` を実行しません。

## 前提

- npm アカウントと認証（2FA ポリシーを含む）
- 公開 package 名
  - engine: `@ywal123456/jskim`（scoped・公開 MIT）
  - creator: `create-jskim`（unscoped）

### 過去の失敗（参考）

unscoped 名 `jskim@0.1.0` の初回 publish は、npm の package name similarity ポリシーにより **E403** で拒否されました。registry には反映されていません。現在の engine 公開名は `@ywal123456/jskim` です。

### 確定済み metadata

```text
engine package: @ywal123456/jskim
creator package: create-jskim
CLI binary: jskim / create-jskim
license: MIT
author: Jeongsub Kim <ywal123456@gmail.com>
repository: https://github.com/ywal123456-collab/jskim
homepage: https://github.com/ywal123456-collab/jskim#readme
bugs: https://github.com/ywal123456-collab/jskim/issues
```

Root `package.json` の `publishConfig`:

```json
{
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org"
  }
}
```

`publishConfig` があっても、scoped engine の初回 publish では手動コマンドの `--access public` を省略しないでください。

### 残りの運用判断

```text
- 実際の npm publish 時点
- npm アカウントのログイン状態
- npm 2FA 状態
```

## 認証とセキュリティ

- 実際の publish には npm account 認証が必要です
- 2FA の有効化と運用ポリシーを確認してください
- token をソースコードや文書に記録しないでください
- `.npmrc` の認証情報を repository に含めないでください
- publish 直前に `npm whoami` でログイン状態を確認してください
- 公開前に会社固有情報・secret・内部 URL が残っていないことを確認してください

## 推奨順序

Engine を先に publish します。生成プロジェクトの `package.json` が `@ywal123456/jskim` を参照するため、creator だけ先に公開すると生成直後の `npm install` が失敗し得ます。

1. npm account と認証状態を確認する
2. package 名を再確認する（`@ywal123456/jskim` / `create-jskim`）
3. リポジトリ root で `npm test` を実行する
4. engine の `npm pack` / `npm publish --dry-run --access public` を確認する
5. creator の `npm pack` / `npm publish --dry-run` を確認する
6. **engine を先に publish** する（`--access public` 必須）
7. registry から engine をインストールできることを確認する
8. creator を publish する
9. `npm create jskim@latest` を検証する

## コマンド例（ユーザーが実行）

リポジトリ root（PowerShell）:

```powershell
npm.cmd whoami --registry=https://registry.npmjs.org
npm.cmd view @ywal123456/jskim name version --registry=https://registry.npmjs.org
npm.cmd view create-jskim name version --registry=https://registry.npmjs.org
npm.cmd test
npm.cmd publish --dry-run --access public --registry=https://registry.npmjs.org
npm.cmd publish --access public --registry=https://registry.npmjs.org
```

期待する成功出力:

```text
+ @ywal123456/jskim@0.1.0
```

Registry 確認:

```powershell
npm.cmd view @ywal123456/jskim@0.1.0 name version license bin repository --registry=https://registry.npmjs.org
```

外部インストール:

```powershell
npm.cmd install --save-dev @ywal123456/jskim@0.1.0 --registry=https://registry.npmjs.org
```

Creator:

```powershell
cd create-jskim
npm.cmd publish --dry-run --registry=https://registry.npmjs.org
npm.cmd publish --registry=https://registry.npmjs.org
```

期待する成功出力:

```text
+ create-jskim@0.1.0
```

最終ユーザー検証:

```powershell
npm.cmd create jskim@latest generated-project
npx create-jskim my-project
```

## 注意

- unscoped engine 向けの `npm publish`（`--access public` なし・旧 package 名）は使わないでください
- lifecycle script（`prepublishOnly` など）は、creator を別 cwd から publish する構成との相性を考えて必須化していません
- publish 前チェックリストとして **手動の `npm test`** を必須とします
- token 生成・login・owner / dist-tag 変更は運用者が責任を持って行います
- 生成プロジェクトへ License を強制しません（ユーザー側で決定）
- creator は unscoped public package のため、creator `package.json` に `access: public` は追加していません
- dry-run 成功は、creator の similarity 審査通過を保証しません
