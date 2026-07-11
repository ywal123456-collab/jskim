# create-jskim

JSKim プロジェクトを作成する scaffold CLI です。

Package 名は `create-jskim` です。生成されるプロジェクトの engine dependency は `@ywal123456/jskim` です。コマンド構造は公開後の利用を想定して整えていますが、**このリポジトリ作業では registry への publish は行っていません**。実際の `npm create` / registry インストールは publish 後に利用できます。

## 使い方（公開後）

```bash
npm create jskim@latest
# または
npx create-jskim my-project
```

ローカル検証では binary / tarball 経由で同じ CLI を実行します。

```bash
create-jskim my-project
```

ディレクトリ名を省略すると、プロジェクト名を尋ねます。

```text
プロジェクト名:
```

空のまま Enter すると既定値 `jskim-project` を使います。

## ヘルプ / バージョン

```bash
create-jskim --help
create-jskim --version
```

## 生成されるファイル

```text
project/
├─ package.json
├─ jskim.config.js
├─ README.md
├─ .gitignore
└─ src/sample/
```

生成プロジェクトは `@ywal123456/jskim` を `devDependencies` に持ちます（公開後は `npm install` で registry から取得）。scripts の実行名は binary `jskim` のままです。

## 生成後の手順

生成器は **自動で `npm install` や `git init` を実行しません**。

```bash
cd my-project
npm install
npm run dev
```

## 安全ポリシー

- 空ではない既存ディレクトリには書き込みません（上書きなし）
- 隠しファイルがある場合も「空ではない」とみなします
- 生成失敗時は、今回作った部分だけを片付けます

## 公開後の目標コマンド

```bash
npm create jskim@latest
```

## リポジトリ

- Repository: https://github.com/ywal123456-collab/jskim/tree/main/create-jskim
- Issues: https://github.com/ywal123456-collab/jskim/issues

## ライセンス

`create-jskim` は MIT License のもとで提供されます。
詳細は [`LICENSE`](./LICENSE) を確認してください。

生成されるユーザープロジェクトの License はユーザー側で決定してください。このツールの MIT License を生成プロジェクトへ強制しません。
