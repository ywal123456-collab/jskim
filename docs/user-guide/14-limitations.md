# 制限事項

この章では、JSKim が提供しないことと、その意味を整理します。  
ツールの境界を理解し、別途何が必要かを判断するための章です。

## 静的サイトの build 環境である

**提供しないもの:** server-side runtime、SSR framework、SPA framework。

**意味:** build 結果は静的な HTML / CSS / 画像などです。サーバー上で template を都度実行する製品ではありません。

**必要な場合:** SSR や SPA が必要なら、その目的に合う別のツールを検討します。

> **Note**
>
> JavaScript file 自体の render / copy は可能です。  
> ただし JSKim は JavaScript bundler ではありません（後述）。

## Backend 機能はない

**提供しないもの:**

- API server
- database
- 認証 / 認可
- session
- 業務ロジック
- 実際の CRUD
- Wizard の入力 state 管理

**意味:** 公式 sample の CRUD / Wizard も画面構成の例です。

**必要な場合:** backend とフロントエンド連携は、利用者が別途実装します。  
画面例は [CRUD例](12-crud-example.md) / [Wizard例](13-wizard-example.md) を参照してください。

## HTML の自動 import / migration はない

**提供しないもの:** 既存 HTML の自動解析、分割、変換。

**意味:** 既存サイトの移行は、利用者が project に合わせて手作業（または別ツール）で行います。  
JSKim core の責任範囲ではありません。

将来の提供をこのガイドで約束しません。

## Bundler ではない

**提供しないもの:**

- JavaScript module bundling
- npm 依存の解決を伴う bundle
- transpile
- minify
- tree shaking
- code splitting

**意味:** `.js` / `.js.njk` は files pipeline で copy または Nunjucks render できますが、webpack / Vite のような変換パイプラインではありません。

**必要な場合:** bundling が必要なら専用の bundler を併用します。

## CSS preprocessor ではない

**提供しないもの:** Sass / Less / PostCSS などの組み込み処理、autoprefix、CSS minify。

**意味:** `.css.njk` は Nunjucks で文字列を生成するだけで、CSS compiler ではありません。平文 `.css` は byte copy です。

**必要な場合:** preprocessor が必要なら、別工程で生成した CSS を JSKim の source に置く方法を検討します。

## 独自の plugin システムはない

**提供しないもの:** JSKim 専用の plugin / extension 機構。

**意味:** 拡張の主な手段は `jskim.config.js` の `nunjucks.filters` / `nunjucks.globals` です。  
これは Nunjucks への登録であり、汎用 plugin marketplace ではありません。

## Build は依存グラフに基づく増分 build ではない

**提供しないもの:** file 単位の依存解析による incremental build。

**意味:** 変更検知後は、設定に従い clean（既定）付きの全体再 build が基本です。  
大規模 project では、変更のたびに全体を作り直す前提で設計します。

速度の優劣を数値で断定はしません。

## Multi-project の command 制限

| command | `--all` |
| ------- | ------- |
| `build` | 対応 |
| `watch` | 非対応 |
| `serve` | 非対応 |
| `dev` | 非対応 |

複数 project を同時に `watch` / `serve` / `dev` したい場合は、別 process で個別に起動する必要があります。

## Port の扱い

- 既定は `127.0.0.1:3000`
- 衝突時に次の空き port を自動選択しない
- `--port` または `serve.port` で変更する
- process manager 機能はない

詳細は [エラーとトラブルシュート](10-errors-and-troubleshooting.md) を参照してください。

## Browser open

- `dev --open` のみ
- `serve --open` は非対応
- OS の既定ブラウザ起動に依存
- 失敗時は warning で、開発サーバーは継続

## CSS soft reload の範囲

対象になり得る条件（概要）:

- `.css` / `.css.njk` の `change`
- `templates[]` 配下ではない
- same-origin の `<link rel="stylesheet">`

対象外・制限の例:

- external stylesheet
- `<style>` inline
- 動的挿入 stylesheet（保証なし）
- soft reload 失敗時は full reload

詳細は [開発機能](09-development-features.md) を参照してください。

## Live reload は HMR ではない

- page の full reload、または CSS の差し替え
- JavaScript module の実行状態保持は保証しない
- React / Vue などの HMR と同種の機能ではない

## Browser overlay と環境依存

- `dev` + live reload 時に HTML へ script を注入
- overlay は Shadow DOM を使用

Strict な Content-Security-Policy など、ブラウザや page のセキュリティ設定によっては、注入や接続が制限される可能性があります。  
すべての CSP 設定での動作を保証するものでも、必ず失敗すると断定するものでもありません。

## Config と Nunjucks の境界

- 余分な config key は無視されることがある（厳密 schema ではない）
- `autoescape` / `noCache` は JSKim が固定
- `data.rootPath` は予約
- `dev` では一部設定変更に process 再起動が必要

Nunjucks 全体の機能を JSKim の契約として保証しません。  
公式ガイドは sample で有用な文法が中心です（[Nunjucksの使い方](08-nunjucks.md)）。

## Output directory

- `dist` は source ではない
- `build.clean` が `true`（既定）なら build 前に削除される
- `false` の場合、消えた source に対応する古い output が残ることがある
- 手編集の維持は保証しない

## Platform / path

- Windows では大文字小文字違いの output 衝突を検出する
- path は Node の `path` で扱い、HTML 内は `/` を使う
- Windows / macOS / Linux を特別に排除していない
- `--open` の挙動は OS の handler に依存する

## 公式 sample の範囲

- 学習用の静的 UI sample
- production-ready な application template ではない
- デザインシステム / UI ライブラリではない
- セキュリティや業務要件を満たすことを保証しない

## ツール選択の目安

| 必要 | 判断 |
| ---- | ---- |
| Nunjucks で静的 page を生成したい | JSKim が適合しやすい |
| API / database server | 別途 backend が必要 |
| JS bundling / transpile | 別途 bundler が必要 |
| 既存 HTML の自動 migration | 別作業 / 別ツールが必要 |
| 本格的な SPA | 目的に合う application framework を検討 |

特定製品の推奨や比較評価は、この章の範囲外です。

関連する運用上の確認は [エラーとトラブルシュート](10-errors-and-troubleshooting.md)、  
画面例は [Dashboard例](11-dashboard-example.md) 以降を参照してください。
