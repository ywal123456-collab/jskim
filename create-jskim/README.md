# create-jskim

JSKim プロジェクトを作成する scaffold CLI です。

Package 名は `create-jskim` です。npm registry で公開済みです。生成されるプロジェクトの engine dependency は `@ywal123456/jskim` です。

## 使い方

推奨:

```bash
npm create jskim@latest
```

他の package manager:

```bash
pnpm create jskim
yarn create jskim
```

代替:

```bash
npx create-jskim my-project
```

必要に応じて:

```bash
npm install --global create-jskim
create-jskim my-project
```

ディレクトリ名を省略すると、プロジェクト名を尋ねます。空のまま Enter すると既定値 `jskim-project` を使います。

生成完了後の案内は、実行した package manager に合わせて install / dev コマンドを表示します。検知できない実行方法では npm コマンドが表示されることがあります。

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
└─ src/
   └─ sample/
      ├─ pages/
      │  ├─ index.html.njk
      │  ├─ dashboard/
      │  ├─ crud/
      │  ├─ wizard/
      │  └─ assets/
      ├─ layouts/base.njk
      └─ components/
```

生成プロジェクトは `@ywal123456/jskim`（`^0.5.2`）を `devDependencies` に持ちます。scripts の実行名は binary `jskim` のままです。
インストール後の公式ユーザーガイド PDF は、生成 project が入れる `@ywal123456/jskim` package の `docs/` 配下で確認できます（creator package 本体には PDF を含めません）。

標準 sample は公式の静的 UI sample（Portal / Dashboard / CRUD / Wizard）です。application 処理は含みません。`pages` 配下の `.html.njk` はレンダリングされ、平文 CSS や画像はそのままコピーされます。

## 生成後の手順

生成器は **自動で `npm install` や `git init` を実行しません**。完了案内に表示されたコマンドを実行してください。

例（npm で create した場合）:

```bash
cd my-project
npm install
npm run dev
```

既定の開発サーバー URL:

```text
http://127.0.0.1:3000/
```

## 安全ポリシー

- 空ではない既存ディレクトリには書き込みません（上書きなし）
- 隠しファイルがある場合も「空ではない」とみなします
- 生成失敗時は、今回作った部分だけを片付けます

## リポジトリ

- Repository: https://github.com/ywal123456-collab/jskim/tree/main/create-jskim
- Issues: https://github.com/ywal123456-collab/jskim/issues

## ライセンス

`create-jskim` は MIT License のもとで提供されます。詳細は [`LICENSE`](./LICENSE) を確認してください。

生成されるユーザープロジェクトの License はユーザー側で決定してください。このツールの MIT License を生成プロジェクトへ強制しません。
