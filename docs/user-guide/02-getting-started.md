# はじめ方

この章では、JSKim の project を作成し、ブラウザで公式 sample を確認し、production build まで実行する手順を説明します。

## 事前準備

JSKim engine（`@ywal123456/jskim`）と creator（`create-jskim`）は、いずれも Node.js **18 以上**を想定しています（`package.json` の `engines.node` が `>=18`）。

package manager は npm / pnpm / yarn を公式に案内しています。OS として Windows / macOS / Linux を特別に制限してはいません。パス処理は Node の `path` を使います。

あらかじめ Node.js と、利用する package manager がコマンドとして認識できる状態にしてください。

## Project の作成

推奨の作成コマンドは次のとおりです。

```bash
npm create jskim@latest my-project
```

他の package manager の例:

| package manager | 作成コマンド |
| --------------- | ------------ |
| npm | `npm create jskim@latest my-project` |
| pnpm | `pnpm create jskim my-project` |
| yarn | `yarn create jskim my-project` |

代替として、次も利用できます。

```bash
npx create-jskim my-project
```

ディレクトリ名を省略すると、プロジェクト名を尋ねます。空のまま Enter すると既定値 `jskim-project` を使います。

空ではない既存ディレクトリは上書きしません。

## 生成結果

生成直後の主要な構成は次のとおりです。

```text
my-project/
├─ package.json
├─ jskim.config.js
├─ README.md
├─ .gitignore
└─ src/
   └─ sample/
      ├─ layouts/
      ├─ components/
      └─ pages/
```

`package.json` は creator が生成します。engine dependency は `@ywal123456/jskim`（`^0.7.0`）です。
`src/sample/` には公式の静的 UI sample（Portal / Dashboard / CRUD / Wizard）が含まれます。

## Dependency のインストール

creator は **自動で install を実行しません**。また `git init` も実行しません。

生成完了時の案内は、実行した package manager に合わせて install / 開発コマンドを表示します。検知できない場合は npm 向けの案内になることがあります。

project ディレクトリへ移動してから、次を実行してください。

```bash
npm install
```

```bash
pnpm install
```

```bash
yarn install
```

## 開発サーバーの実行

生成された `package.json` の `dev` script は `jskim dev sample` です。

```bash
npm run dev
```

package manager ごとの例:

| package manager | 開発コマンド |
| --------------- | ------------ |
| npm | `npm run dev` |
| pnpm | `pnpm dev` |
| yarn | `yarn dev` |

既定の開発サーバー URL は次です。

```text
http://127.0.0.1:3000/
```

ブラウザでは Portal が表示されます。sidebar やカードから Dashboard / CRUD / Wizard へ移動できます。

source を保存すると再 build され、ブラウザへ反映されます。template などに誤りがあると、ブラウザ上の overlay に表示されることがあります。  
詳細は [開発機能](09-development-features.md) を参照してください。

## 最初の修正

まずは Portal の説明文を変更してみます。

編集する file:

- [src/sample/pages/index.html.njk](../../src/sample/pages/index.html.njk)

次の lead 文を探します。

```nunjucks
<p class="lead">
  JSKim の files pipeline で画面構成、template 分割、asset 配置を確認できる
  静的 UI sample です。
</p>
```

文言を少し変えて保存し、ブラウザを確認してください。Portal の説明が更新されていれば、source から output への流れを確認できています。

## Production build

配布用の output を作るには次を実行します。

```bash
npm run build
```

生成 script は `jskim build sample` です。結果は次のディレクトリに出力されます。

```text
dist/sample/
```

ここには通常の HTML / CSS / SVG などの静的ファイルが並びます。  
どこへ配置するかは hosting 環境によって異なるため、特定の提供元の手順はこのガイドでは扱いません。

## 主なコマンドのまとめ

| 目的 | 例（npm） |
| ---- | --------- |
| dependency のインストール | `npm install` |
| 開発サーバー | `npm run dev` |
| production output の生成 | `npm run build` |

`watch`（監視して再 build）と `serve`（output の静的配信のみ）も生成 script に含まれます。  
使い分けは [基本的な開発workflow](04-basic-workflow.md)、構文の詳細は [CLIリファレンス](05-cli-reference.md) を参照してください。

## うまく動かないとき

よくある原因は次のとおりです。

- 既定 port（`3000`）が他のプロセスで使われている
- install を実行していない
- project ルート以外のディレクトリでコマンドを実行している
- Node.js / package manager が PATH 上で認識されていない

エラーメッセージごとの対処は [エラーとトラブルシュート](10-errors-and-troubleshooting.md) を参照してください。
