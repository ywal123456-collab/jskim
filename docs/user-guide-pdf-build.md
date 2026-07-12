# ユーザーガイド PDF 生成手順

この文書は maintainer 向けです。公式ユーザーガイド本文（`docs/user-guide/`）とは別の運用手順です。

## 目的

分割 Markdown を source of truth として、A4 の PDF を再生成します。

```text
docs/user-guide/*.md
  → HTML
  → Chromium（Edge / Chrome）
  → dist/docs/JSKim_User_Guide_vX.Y.Z.pdf
```

## Source of truth

- `docs/user-guide/README.md`
- `docs/user-guide/01-*.md` ～ `14-*.md`

統合 HTML / PDF は生成物です。手編集の対象ではありません。

## Dependency

開発用 dependency:

```bash
npm install
```

PDF 生成に使う package:

- `markdown-it`
- `playwright-core`

`playwright-core` は browser 本体を download しません。  
PC にインストール済みの Microsoft Edge または Google Chrome を使います。

## コマンド

HTML のみ（browser 不要）:

```bash
npm run docs:pdf:html
```

PDF 生成:

```bash
npm run docs:pdf
```

既定の PDF 出力先:

```text
dist/docs/JSKim_User_Guide_v0.5.1.pdf
```

`dist/` は Git 管理対象外です。生成 PDF を通常の commit に含めません。  
GitHub Release への添付は別の release 手順で行います。

## Browser の指定

探索優先順位:

1. `--browser <path>`
2. 環境変数 `JSKIM_PDF_BROWSER`
3. OS ごとの既定候補（Edge / Chrome）

例:

```bash
npm run docs:pdf -- --browser "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

```bash
set JSKIM_PDF_BROWSER=C:\Path\To\msedge.exe
npm run docs:pdf
```

## Option

| option | 説明 |
| ------ | ---- |
| `--html-only` | HTML 生成のみ。PDF は作らない |
| `--output <path>` | PDF の出力先（`--html-only` とは併用不可） |
| `--browser <path>` | 使用する Chromium 系 executable |
| `--keep-html` | 将来拡張用（現状は HTML を一時ディレクトリへ出力） |

## 方針

- font file を repository に追加しない（system 日本語 font を使用）
- generated HTML は OS の一時ディレクトリへ出力
- PDF は `dist/docs/` へ出力し、Git commit しない
- 公式 guide 本文の Markdown を PDF 用に書き換えない

## 関連

- 公式ガイド: [docs/user-guide/README.md](user-guide/README.md)
- 実装: `scripts/docs/build-user-guide-pdf.js`
