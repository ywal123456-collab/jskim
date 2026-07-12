# Wizard例

この章では、公式 Wizard sample（3 ステップ）と共通の step component を説明します。

> **Warning**
>
> 入力内容の保存、画面間の引き継ぎ、送信処理はありません。  
> 確認画面の値も入力画面から渡されたものではありません。

> **Note**
>
> 以下のコードは核心部分だけの抜粋です。  
> 全体の source は各 link から確認できます。

## Sample の目的

- 情報入力 → 入力内容確認 → 完了という段階型の画面構成を示す
- layout / component / page-local CSS の使い方を確認する
- 実際の入力値の受け渡しや保存はしない

代表 source:

- [情報入力](../../src/sample/pages/wizard/input.html.njk)

## 関連 file

```text
components/wizard-steps.njk

pages/wizard/
├─ input.html.njk
├─ confirm.html.njk
├─ complete.html.njk
└─ assets/css/wizard.css
```

- [`wizard-steps.njk`](../../src/sample/components/wizard-steps.njk)
- [入力](../../src/sample/pages/wizard/input.html.njk)
- [確認](../../src/sample/pages/wizard/confirm.html.njk)
- [完了](../../src/sample/pages/wizard/complete.html.njk)

共通 layout は [Dashboard例](11-dashboard-example.md) と同じです。

## 画面の移動

```text
情報入力
   ↓
入力内容確認
   ↓
完了
```

戻り:

```text
入力内容確認 → 情報入力
完了 → 情報入力 / Portal
```

「送信する」も完了画面への静的な移動です。

## currentStep

各 page が静的にステップ番号を持ちます。

| page | 値 |
| ---- | -- |
| 情報入力 | `{% set currentStep = 1 %}` |
| 入力内容確認 | `{% set currentStep = 2 %}` |
| 完了 | `{% set currentStep = 3 %}` |

- browser / session の application state ではない
- `wizard-steps` component の表示切替のための値

## wizard-steps component

```nunjucks
<li
  class="wizard-steps__item{% if currentStep == 1 %} is-current{% elif currentStep > 1 %} is-complete{% endif %}"
  {% if currentStep == 1 %}aria-current="step"{% endif %}
>
  <span class="wizard-steps__number">1</span>
  <span class="wizard-steps__label">情報入力</span>
  ...
</li>
```

- ステップは 3 つ
- 現在 / 完了 / 未実施を class とテキストで表現
- 現在ステップには `aria-current="step"`
- component 自体は直接 output されない

## 情報入力

見た目だけの入力欄です。

| 項目 | name / 属性 |
| ---- | ----------- |
| 氏名 | `name` / `readonly` |
| メールアドレス | `email` / `readonly` |
| 電話番号 | `phone` / `readonly` |
| お問い合わせ種別 | `category` / `disabled` select |
| お問い合わせ内容 | `message` / `readonly` textarea |

- 実際の submit はない
- 「入力内容を確認する」は `confirm.html` へのリンク
- 入力内容は保存されない

## 入力内容確認

template 内の固定 object を表示します。

```nunjucks
{% set application = {
  name: "山田 太郎",
  email: "taro@example.com",
  phone: "090-0000-0000",
  category: "商品について",
  message: "sampleのお問い合わせ内容です。"
} %}
```

> **Note**
>
> `taro@example.com` は予約された example domain の例です。  
> 入力画面の内容が引き継がれた結果ではありません。

- 「入力画面へ戻る」→ `input.html`
- 「送信する」→ `complete.html`（実送信なし）

## 完了

静的な完了状態を示す画面です。

- 入力の送信・保存は行われていないと明記
- 「最初から確認する」→ `input.html`
- Portal へも戻れる

## Wizard CSS

| 項目 | パス |
| ---- | ---- |
| source | [`pages/wizard/assets/css/wizard.css`](../../src/sample/pages/wizard/assets/css/wizard.css) |
| output | `dist/sample/wizard/assets/css/wizard.css` |
| HTML | `assets/css/wizard.css` |

step indicator、form、確認リスト、完了パネルなどの見た目を担当します。  
共通部分は `common.css` です。

## アクセシビリティ

実際の sample が備えるもの:

- 手順は `<ol>`
- 現在ステップに `aria-current="step"`
- 各入力に `label`
- 状態テキスト（現在 / 完了 / 未実施）
- 色だけに頼らない状態表現

これ以上のアクセシビリティ機能を、sample が保証するわけではありません。

## ステップを増やす方法

4 ステップにする場合の概念的な順序:

1. 新しい page（`.html.njk`）を作る
2. `wizard-steps.njk` に項目を足す
3. 各 page の `currentStep` を調整する
4. navigation の link を直す
5. CSS を確認する
6. `dev` / `build` で link を検査する

自動 routing や共有 state の機能はありません。

## 実際の Wizard にする場合

JSKim の外で必要になる典型例:

- 入力値の保存
- validation
- 画面間の state
- submit / API / backend
- 直接 URL アクセスの制御
- 完了後の state クリア

具体的な application 実装コードは、このガイドでは扱いません。

## Sample の限界

- 入力の引き継ぎはない
- 送信・保存はない
- step は page ごとの静的値
- session / localStorage による状態管理はない

製品全体の境界は [制限事項](14-limitations.md) を参照してください。
