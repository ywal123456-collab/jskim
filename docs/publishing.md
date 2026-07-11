# 公開手順（publishing）

この文書は **maintainer 向けの release / publish 手順** です。
開発リポジトリの通常作業では `npm publish` を実行しません。

## 現在公開中

```text
engine: @ywal123456/jskim
creator: create-jskim
CLI binary: jskim / create-jskim
license: MIT
```

初回公開（v0.1.0）は完了しています。以降の patch / minor release でも、同じ手順で engine を先に、creator を後に公開します。

### 過去の失敗（参考）

unscoped 名での初回 engine publish は、npm の package name similarity ポリシーにより拒否されました。現在の engine 公開名は `@ywal123456/jskim` です。

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

scoped engine の publish では手動コマンドの `--access public` を省略しないでください。

## 認証とセキュリティ

- 実際の publish には npm account 認証が必要です
- 2FA の有効化と運用ポリシーを確認してください
- token をソースコードや文書に記録しないでください
- `.npmrc` の認証情報を repository に含めないでください
- publish 直前に `npm whoami` でログイン状態を確認してください
- 公開作業の前に会社固有情報・secret・内部 URL が残っていないことを確認してください

## 推奨順序（patch / minor）

Engine を先に publish します。生成プロジェクトの `package.json` が `@ywal123456/jskim` を参照するため、creator だけ先に公開すると生成直後の `npm install` が失敗し得ます。

1. version を決定する
2. リポジトリ root で `npm test` を実行する
3. engine / creator の `npm pack` を確認する
4. `npm publish --dry-run` を確認する
5. Git commit / push する
6. **engine を先に publish** する（`--access public`）
7. registry から engine をインストールできることを確認する
8. creator を publish する
9. `npm create jskim@latest` を検証する
10. Git tag と GitHub Release を作成する

同じ name / version を再 publish できると仮定しないでください。

## コマンド例（PowerShell）

Engine（リポジトリ root）:

```powershell
npm.cmd whoami --registry=https://registry.npmjs.org
npm.cmd test
npm.cmd publish --dry-run --access public --registry=https://registry.npmjs.org
npm.cmd publish --access public --registry=https://registry.npmjs.org
```

Registry / インストール確認:

```powershell
npm.cmd view @ywal123456/jskim name version dist-tags --registry=https://registry.npmjs.org
npm.cmd install --save-dev @ywal123456/jskim --registry=https://registry.npmjs.org
```

Creator:

```powershell
cd create-jskim
npm.cmd publish --dry-run --registry=https://registry.npmjs.org
npm.cmd publish --registry=https://registry.npmjs.org
```

最終ユーザー検証:

```powershell
npm.cmd create jskim@latest generated-project
```

## 注意

- unscoped engine 向けの旧 package 名では publish しません
- lifecycle script（`prepublishOnly` など）は必須化していません
- publish 前チェックリストとして **手動の `npm test`** を必須とします
- token 生成・login・owner / dist-tag 変更は運用者が責任を持って行います
- 生成プロジェクトへ License を強制しません（ユーザー側で決定）
- creator は unscoped public package のため、creator `package.json` に `access: public` は追加していません
- 文書のみの修正でも npm package README を更新する場合は patch version を使います
- 既存の公開 tag（例: `v0.1.0`）を移動または再作成しません
