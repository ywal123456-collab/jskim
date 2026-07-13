# ユーザーガイド PDF 生成手順

この文書は maintainer 向けです。公式ユーザーガイド本文（`docs/user-guide/`）とは別の運用手順です。

## 目的

分割 Markdown を source of truth として、A4 の PDF を再生成します。

```text
docs/user-guide/*.md
  → HTML
  → Chromium（Edge / Chrome）
  → JSKim_User_Guide_vX.Y.Z.pdf
```

## Source of truth

- `docs/user-guide/README.md`
- `docs/user-guide/01-*.md` ～ `14-*.md`

統合 HTML は生成物です。手編集の対象ではありません。

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

確認用 PDF（`dist/`、Git 非管理）:

```bash
npm run docs:pdf
```

既定の確認用出力先:

```text
dist/docs/JSKim_User_Guide_v0.5.2.pdf
```

npm package / release 用 PDF（`docs/`、Git 管理対象）:

```bash
npm run docs:pdf:package
```

既定の package 用出力先:

```text
docs/JSKim_User_Guide_v0.5.2.pdf
```

filename の version は `package.json` から読み取ります。script へ version を重複 hardcode しません。

## 成果物の扱い

| 成果物 | 用途 | Git |
| ------ | ---- | --- |
| `dist/docs/**` | 一時 / 検食用 | 含めない |
| `docs/JSKim_User_Guide_vX.Y.Z.pdf` | npm package / release 添付候補 | 含める |
| TEMP HTML / screenshot | 検食用 | 含めない |

engine package（`@ywal123456/jskim`）をインストールした利用者は、次の場所で PDF を開けます。

```text
node_modules/@ywal123456/jskim/docs/JSKim_User_Guide_v0.5.2.pdf
```

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
| `--package-output` | `docs/JSKim_User_Guide_v${version}.pdf` へ出力 |
| `--output <path>` | PDF の任意出力先 |
| `--browser <path>` | 使用する Chromium 系 executable |
| `--keep-html` | 将来拡張用（現状は HTML を一時ディレクトリへ出力） |

`--package-output` と `--output`、`--html-only` と `--package-output` は同時に指定できません。

## 方針

- font file を repository に追加しない（system 日本語 font を使用）
- generated HTML は OS の一時ディレクトリへ出力
- 確認用 PDF は `dist/docs/`、release 用 PDF は `docs/`
- 公式 guide 本文の Markdown を PDF 用に書き換えない

## 関連

- 公式ガイド: [docs/user-guide/README.md](user-guide/README.md)
- 実装: `scripts/docs/build-user-guide-pdf.js`
