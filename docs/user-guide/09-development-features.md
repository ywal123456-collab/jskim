# 開発機能

この章では、主に `dev` 実行中の開発支援機能を説明します。  
コマンドの選び方は [基本的な開発workflow](04-basic-workflow.md) も参照してください。

## dev の構成

`dev` は次の順で起動します。

```text
config を読み project を解決
        ↓
config 監視を開始
        ↓
live reload を準備
        ↓
静的サーバーを準備
        ↓
初回 build
        ↓
静的サーバーを listen
        ↓
source 監視を開始
        ↓
（--open 指定時）ブラウザを開く
```

| command | build | 監視 | サーバー | live reload |
| ------- | ----- | ---- | -------- | ----------- |
| `watch` | する | する | しない | しない |
| `serve` | しない | しない | する | しない |
| `dev` | する | する | する | する（既定） |

`dev.liveReload` を `false` にすると、live reload 注入と SSE は無効になります。

## Live reload

`dev` かつ `liveReload: true` のとき、ブラウザは開発サーバーと接続します。

- HTML レスポンスにだけクライアント script が注入されます（`dist` には書き込みません）
- source 変更後の再 build 成功に応じて、ブラウザへ通知します
- 接続が切れた場合、クライアントは再接続を試みます

すべての変更が page 全体の reload になるわけではありません。  
CSS の一部は soft reload になります。

内部エンドポイントは `/_jskim/live-reload` です。  
`serve` や `liveReload: false` では利用できません。

## Full reload

次のような変更では、通常 page 全体を再読み込みします。

- HTML / Nunjucks（`.html.njk` など）の変更
- 画像や JS などの非 CSS 変更
- layout / component（`templates[]` 配下）の変更
- CSS でも `add` / `unlink` など `change` 以外のイベント
- CSS soft reload が失敗したときの fallback
- config の再読み込み後に成功した再 build（概要）

## CSS soft reload

条件を満たすとき、page 全体を再読み込みせず、stylesheet だけを差し替えます。

```text
CSS soft reload
→ 現在の page を保ったまま stylesheet を読み直す

Full reload
→ page 全体を読み直す
```

### 対象になる条件

再 build 成功時の変更イベントが **すべて** 次を満たす場合です。

- イベント種別が `change`
- 対象パスの末尾が `.css` または `.css.njk`（大文字小文字を区別しない）
- `templates[]` 配下ではない

公式 sample の page-local CSS（平文 `.css`）も対象になり得ます。

### ブラウザ側の制限

クライアントは次だけを更新します。

- `<link rel="stylesheet">`（`rel` に `stylesheet` を含むもの）
- **same-origin** の URL

次は soft reload の対象外です。

- 外部 CDN の stylesheet
- `<style>` の inline CSS
- 動的に後から挿入した stylesheet（保証なし）
- same-origin の stylesheet link が 1 つもない場合 → full reload

読み込み失敗やタイムアウト時も full reload にフォールバックします。

> **Note**
>
> form 入力内容やスクロール位置などの「状態保持」を、  
> あらゆるケースで保証するものではありません。

## Browser error overlay

template / config / build のエラーを、開発中のブラウザ上に表示できます。

主な特徴:

- 現在表示中の page の上に重ねて表示
- Shadow DOM を使い、page の CSS から隔離
- メッセージはテキストとして表示（タイトルは `JSKim dev error`）
- `Close` ボタンで一時的に閉じられる
- エラーが解消され、成功通知を受けると自動で消える

stack trace 全体をそのまま出す UI ではありません。  
サーバーが送るメッセージ本文が中心です。

## Last error replay

ブラウザがエラー発生後に接続した場合や、再接続した直後でも、  
まだエラー状態が残っていれば、サーバーが最後のエラーを再送します。

複数のブラウザクライアントが接続している場合、同じ通知を受け取れます。

## Recovery

エラーを直して再 build が成功すると、おおむね次の流れになります。

1. サーバー側のエラー状態が解除される
2. overlay が消える（`clear-error`）
3. 変更種別に応じて full reload または CSS soft reload

config エラー中は、source 側の成功だけでは overlay を消さない優先順位があります。  
config を直して有効な設定に戻す必要があります。

process 自体は、個別の再 build 失敗だけでは終了しません。

## Config hot reload

| command | `jskim.config.js` を監視するか |
| ------- | ------------------------------ |
| `build` | しない |
| `serve` | しない |
| `watch` | する |
| `dev` | する |

読み込みや検証に失敗した場合:

- 直前まで有効だった設定（last-known-good）を継続
- terminal にエラーを表示
- `dev` では browser overlay にも表示できる

一時的に設定ファイルが消えた場合も、以前の正常な設定を継続します。

成功して再読み込みできた場合は、監視対象を更新し、再 build します。

## Restart-required 設定

`dev` では、次の値が変わると **process の再起動が必要** です。

- `outputDir`
- `serve.host`
- `serve.port`
- `dev.liveReload`

この場合、warning を出し、以前の正常な設定を継続します。  
process を自動終了はしません。手動で `dev` を再起動してください。

それ以外の多くの設定は、hot reload で反映を試みます。

## CLI override の維持

例:

```bash
jskim dev sample --host 127.0.0.1 --port 4000 --open
```

- `--host` / `--port` は config hot reload 後も CLI 指定が優先されます
- `--open` は起動時に **1 回だけ** ブラウザを開きます（reload のたびに開き直しません）

## Browser open

`dev --open` は、サーバーの listen 成功後に OS の既定ブラウザで URL を開きます。

失敗した場合:

- warning を出す
- 開発サーバー自体は継続する

手動で次の URL を開けば確認できます（既定時）。

```text
http://127.0.0.1:3000/
```

> **Note**
>
> `serve` に `--open` はありません。

## Strict CSP について

JSKim は live reload 用 script を HTML レスポンスへ注入します。  
overlay は Shadow DOM を使います。

Strict な Content-Security-Policy 環境で、注入 script や接続が制限される可能性はあります。  
ただし、現時点の公式 test で CSP ごとの動作を保証してはいません。

## 開発機能の選び方

| 必要 | 使い方 |
| ---- | ------ |
| output だけ継続更新 | `watch` |
| 既存 `dist` をブラウザで確認 | `serve` |
| reload 込みの統合開発 | `dev` |
| 起動時にブラウザを開く | `dev --open` |
| CSS 変更時に page 全体 reload を減らす | `dev`（条件付き soft reload） |

## この章に関連する制限

- JavaScript HMR ではありません
- JS module の実行状態保持は保証しません
- external / inline stylesheet は soft reload 対象外です
- browser / OS 環境に依存する部分があります（`--open` など）

全体の製品制限事項は [制限事項](14-limitations.md) を参照してください。  
エラー別の対処は [エラーとトラブルシュート](10-errors-and-troubleshooting.md) を参照してください。
