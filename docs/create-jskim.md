# create-jskim

`create-jskim` は JSKim の作業空間を新規作成する **独立 scaffold package** です。

エンジン CLI（`jskim build` など）とは別 package として管理します。

## 役割

- 新しい JSKim プロジェクトディレクトリを作る
- 標準 `src/sample` と `jskim.config.js` を含める
- 生成後の `npm install` / `git init` は **実行しない**

## 生成結果

```text
project/
├─ package.json
├─ jskim.config.js
├─ README.md
├─ .gitignore
└─ src/sample/
```

`package.json` の scripts は bin 名 `jskim` を使います（package name ではありません）。
既定の engine dependency は `jskim`（`^0.1.0`）です。

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
    "packageName": "jskim",
    "version": "^0.1.0"
  }
}
```

生成プロジェクトへ License は強制しません。

## 公開コマンド（publish 後）

```bash
npm create jskim@latest
npx create-jskim my-project
```

Package 名・CLI 構造は上記に合わせて準備済みです。registry への実際の publish は別手順です（[publishing.md](./publishing.md)）。
