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
npx create-jskim my-project
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
      │  ├─ assets/
      │  │  ├─ css/style.css.njk
      │  │  ├─ js/main.js.njk
      │  │  └─ image/logo.svg
      │  └─ request/
      │     ├─ index.html.njk
      │     └─ assets/
      ├─ layouts/base.njk
      └─ components/
         ├─ header.njk
         └─ footer.njk
```

`jskim.config.js` は `files: [{ from: 'pages', to: '' }]` を使います。`.njk` は末尾の `.njk` だけを外してレンダリングし、画像などはそのままコピーします。

`package.json` の scripts は bin 名 `jskim` を使います（package name ではありません）。既定の engine dependency は `@ywal123456/jskim`（`^0.3.0`）です。

```json
{
  "devDependencies": {
    "@ywal123456/jskim": "^0.3.0"
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
    "version": "^0.3.0"
  }
}
```

生成プロジェクトへ License は強制しません。

Maintainer 向けの release / publish 手順は [publishing.md](./publishing.md) を参照してください。
