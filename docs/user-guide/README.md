# JSKim ユーザーガイド

このドキュメントは、JSKim を初めて利用する方向けの公式ガイドです。

対象 version は **v0.5.1** です。説明は現在の実装と公式 sample source に基づきます。

## このガイドについて

主な読者は次のとおりです。

> HTML、CSS、JavaScript の基本的な知識はあるが、  
> JSKim および Nunjucks を初めて利用するユーザー

このガイドでは、次のことを学べます。

- JSKim が何をするツールか
- project の作り方と build / 開発サーバーの動かし方
- 公式 sample の構成と Dashboard / CRUD / Wizard の読み方
- CLI、設定、files pipeline、Nunjucks の使い方
- 開発機能と代表的なエラーの対処
- JSKim の適用範囲と制限

説明は公式の静的 UI sample（`src/sample/`）とあわせて読む前提です。  
creator（`create-jskim`）で生成した project にも、同じ sample が含まれます。

## 章一覧

1. [JSKimとは](01-introduction.md)
2. [はじめ方](02-getting-started.md)
3. [プロジェクト構成](03-project-structure.md)
4. [基本的な開発workflow](04-basic-workflow.md)
5. [CLIリファレンス](05-cli-reference.md)
6. [設定](06-configuration.md)
7. [files pipeline](07-files-pipeline.md)
8. [Nunjucksの使い方](08-nunjucks.md)
9. [開発機能](09-development-features.md)
10. [エラーとトラブルシュート](10-errors-and-troubleshooting.md)
11. [Dashboard例](11-dashboard-example.md)
12. [CRUD例](12-crud-example.md)
13. [Wizard例](13-wizard-example.md)
14. [制限事項](14-limitations.md)

## 読み方

### 初めて使う場合

次の順がわかりやすいです。

1. [JSKimとは](01-introduction.md)
2. [はじめ方](02-getting-started.md)
3. [プロジェクト構成](03-project-structure.md)
4. [基本的な開発workflow](04-basic-workflow.md)
5. 公式 sample を見ながら [Dashboard例](11-dashboard-example.md) 以降

必要に応じて CLI / 設定 / files pipeline / Nunjucks の章を参照してください。

### 必要なときだけ参照する場合

| 知りたいこと | 章 |
| ------------ | -- |
| コマンドと option | [CLIリファレンス](05-cli-reference.md) |
| `jskim.config.js` | [設定](06-configuration.md) |
| render / copy / `rootPath` | [files pipeline](07-files-pipeline.md) |
| template 文法 | [Nunjucksの使い方](08-nunjucks.md) |
| live reload / overlay | [開発機能](09-development-features.md) |
| エラー対処 | [エラーとトラブルシュート](10-errors-and-troubleshooting.md) |
| できること / できないこと | [制限事項](14-limitations.md) |

### 公式 sample とあわせて読む

入口:

- [Portal](../../src/sample/pages/index.html.njk)

画面例:

- [Dashboard例](11-dashboard-example.md)
- [CRUD例](12-crud-example.md)
- [Wizard例](13-wizard-example.md)

## このガイドの範囲

### JSKim が提供するもの

- Nunjucks に基づく静的 HTML の render
- CSS や画像などの asset copy
- `build` / `watch` / `serve` / `dev` の workflow
- 開発サーバーと、開発中の reload / エラー表示の支援

### JSKim が提供しないもの

- backend
- API
- database
- 実際の CRUD 処理
- 実際の Wizard state 管理
- 既存 HTML の自動取り込みや移行ツール

詳細は [制限事項](14-limitations.md) を参照してください。
