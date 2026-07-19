# create-jskim

`create-jskim` は JSKim の作業空間を新規作成する **独立 scaffold package** です。

エンジン CLI（`jskim build` など）とは別 package として管理します。npm registry で公開済みです。

## 役割

- 新しい JSKim プロジェクトディレクトリを作る
- files pipeline 版の標準 `src/sample` と `jskim.config.js` を含める
- 生成後の `npm install` / `git init` は実行しない

## 名称の区別

| 名称 | 意味 |
|------|------|
| JSKim | 製品名 |
| `jskim` | CLI binary |
| `@ywal123456/jskim` | npm engine package |
| `create-jskim` | npm creator package |
| `npm create jskim@latest` | ユーザー向け生成コマンド |

## 使い方

```bash
npm create jskim@latest
pnpm create jskim
yarn create jskim
```

代替:

```bash
npx create-jskim my-project
```

生成完了後の案内は、実行した package manager に合わせて install / dev コマンドを表示します。検知できない実行方法では npm コマンドが表示されることがあります。

生成器は dependency を自動インストールしません。案内に従って手動で install してください。

既定の開発サーバー URL:

```text
http://127.0.0.1:3000/
```

## 生成結果

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
      │  │  ├─ index.html.njk
      │  │  └─ assets/css/dashboard.css
      │  ├─ crud/
      │  │  ├─ index.html.njk
      │  │  ├─ detail.html.njk
      │  │  ├─ create.html.njk
      │  │  ├─ edit.html.njk
      │  │  ├─ delete.html.njk
      │  │  ├─ complete.html.njk
      │  │  └─ assets/css/crud.css
      │  ├─ wizard/
      │  │  ├─ input.html.njk
      │  │  ├─ confirm.html.njk
      │  │  ├─ complete.html.njk
      │  │  └─ assets/css/wizard.css
      │  └─ assets/
      │     ├─ css/common.css
      │     └─ img/logo.svg
      ├─ layouts/base.njk
      └─ components/
         ├─ header.njk
         ├─ sidebar.njk
         ├─ breadcrumb.njk
         ├─ footer.njk
         └─ wizard-steps.njk
```

`jskim.config.js` は `files: [{ from: 'pages', to: '' }]` を使います。`.njk` は末尾の `.njk` だけを外してレンダリングし、平文 CSS / 画像などはそのままコピーします。公式 sample は静的 UI であり、application 処理は含みません。

`package.json` の scripts は bin 名 `jskim` を使います（package name ではありません）。既定の engine dependency は `@ywal123456/jskim`（`^0.7.0`）です。

```json
{
  "devDependencies": {
    "@ywal123456/jskim": "^0.7.0"
  },
  "scripts": {
    "build": "jskim build sample",
    "watch": "jskim watch sample",
    "serve": "jskim serve sample",
    "dev": "jskim dev sample"
  }
}
```

## 安全ポリシー

- 空ではない既存ディレクトリは上書きしない
- 隠しファイルがある場合も空ではないとみなす
- 生成失敗時は今回作ったファイルだけを片付ける
- template 内の `gitignore` を生成時に `.gitignore` へ変換する

## エンジン dependency

create package の `package.json` に `jskimEngine` metadata を持ち、生成プロジェクトの `devDependencies` に反映します。

```json
{
  "jskimEngine": {
    "packageName": "@ywal123456/jskim",
    "version": "^0.7.0"
  }
}
```

生成プロジェクトへ License は強制しません。

Maintainer 向けの release / publish 手順は [publishing.md](./publishing.md) を参照してください。
