# JSKimとは

この章では、JSKim がどのようなツールか、何を解決し、どのような用途に向くかを説明します。

## JSKim の概要

JSKim は、Nunjucks を使って静的 HTML を生成する開発環境です。

source（`sourceDir`）を管理し、build によって output（`outputDir`）を生成します。layout や component を再利用でき、CSS や画像などの asset もまとめて扱えます。開発中は `watch` / `serve` / `dev` を使い、配布結果は通常の静的ファイルです。

「framework」と呼ぶこともできますが、backend framework や SPA framework ではありません。テンプレートと静的ファイルを整理し、build 結果を作るためのツールです。

## 解決しようとする問題

静的な HTML サイトを手作業だけで増やすと、次のような問題が起きやすくなります。

- 複数ページで header / footer などの共通部分が重複する
- ページ数が増えると、共通箇所の修正漏れが起きやすい
- 編集用の source と、配布用の output が混ざりやすい
- 静的 asset のパス管理が煩雑になる
- build / watch / 開発サーバーの手順が統一されない
- template の誤りに気づくのが遅れる

JSKim は、これらの作業を `jskim.config.js` を基準にした一連のコマンドとしてまとめます。

## 基本的な処理の流れ

推奨設定である files pipeline では、大まかに次の流れで処理します。

```text
src/sample/
   │
   ├─ pages/ 配下の *.njk ── render（末尾 .njk を外す）──┐
   ├─ pages/ 配下の CSS / 画像 ── copy ──────────────────┤
   └─ layouts / components ── template root（直接出力しない）│
                                                           ▼
                                                     dist/sample/
```

`layouts` や `components` は `extends` / `include` 用の template root です。それ自体は output されません。  
詳細な規則は [files pipeline](07-files-pipeline.md) を参照してください。

## JSKim に向いている project

次のような project に向いています。

- 複数の静的 HTML ページを持つ website
- 共通 layout / component を使う project
- build 結果を静的 hosting や既存サーバーへ配置する project
- frontend bundler を使わず、HTML / CSS / JS asset を整理したい project

## JSKim の範囲外

次の用途は JSKim の範囲外です。

- backend application framework ではない
- database 機能はない
- API server 機能はない
- React / Vue のような SPA framework ではない
- JavaScript bundler ではない
- 既存 HTML の自動取り込みや移行ツールではない
- 実際の CRUD / Wizard 業務ロジックは提供しない

公式 sample の CRUD / Wizard は、画面構成を示す静的 UI sample です。保存や送信などの application 処理はありません。

## JSKim と Nunjucks の関係

役割を分けると次のとおりです。

- **Nunjucks** — template の記法と render engine
- **JSKim** — project / 設定 / files / build / watch / serve / dev をまとめる実行環境

Nunjucks の文法すべてが JSKim 独自機能というわけではありません。  
このユーザーガイドでは、JSKim の利用で実務的に必要な文法を中心に扱います。

## 公式 sample の紹介

公式 sample は次の画面グループで構成されています。

| 画面グループ | 役割 |
| ------------ | ---- |
| Portal | sample 全体の入口。各画面グループへの導線をまとめる |
| Dashboard | 共通 layout と静的データを使った管理画面の見た目例 |
| CRUD | 一覧・詳細・登録・編集・削除確認などの画面構成例 |
| Wizard | 入力・確認・完了の 3 ステップ画面構成例 |

いずれも静的 UI です。API 通信や入力の永続化はありません。

代表的な source:

- [Portal](../../src/sample/pages/index.html.njk)
- [Dashboard](../../src/sample/pages/dashboard/index.html.njk)
- [CRUD](../../src/sample/pages/crud/index.html.njk)
- [Wizard（入力）](../../src/sample/pages/wizard/input.html.njk)

読み方は [Dashboard例](11-dashboard-example.md)、[CRUD例](12-crud-example.md)、[Wizard例](13-wizard-example.md) を参照してください。

次の章では、project を作成して sample をブラウザで確認する手順を説明します。
