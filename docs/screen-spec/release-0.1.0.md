# Screen Spec companion v0.1.0 公開準備

この文書は **実際の npm publish 前** の準備・検証チェックリストです。
publish / Git tag / GitHub Release / push の実行手順は別 phase で行います。

## 1. Release package 組み合わせ

| package | version | 役割 |
|---------|---------|------|
| `@ywal123456/jskim` | **0.6.0** | Screen Spec optional integration を含む minor release |
| `@ywal123456/jskim-screen-spec` | **0.1.0** | companion 初回公開 MVP |
| `create-jskim` | **0.6.0** | JSkim 0.6.0 + Screen Spec sample/template |

Screen Spec Schema は package version と独立です。

```text
schemaVersion: 1.0
```

## 2. 互換範囲

```text
@ywal123456/jskim-screen-spec@0.1.0
  peerDependencies: @ywal123456/jskim ^0.6.0
```

- JSkim `0.5.x` は Screen Spec CLI 連携がないため **非対応**
- JSkim `0.6.x` と組み合わせる
- root は companion を dependency / optionalDependency にしない（通常利用者は Vue/Vite/Playwright を入れない）

## 3. インストール

### npm

```bash
npm install --save-dev @ywal123456/jskim
npm install --save-dev @ywal123456/jskim-screen-spec
npx playwright install chromium
```

### pnpm

```bash
pnpm add -D @ywal123456/jskim
pnpm add -D @ywal123456/jskim-screen-spec
pnpm exec playwright install chromium
```

## 4. 基本コマンド

```bash
npx jskim build sample
npx jskim spec collect sample
npx jskim spec build sample
npx jskim spec dev sample
```

- `/` … 実装画面
- `/spec/` … 画面設計書 viewer（full-page reload）

## 5. 現在の制限（正直に維持）

- Screen Spec は **optional** companion
- Chromium（Playwright）の別途インストールが必要
- local JSkim project のみ（remote URL 収集なし）
- 外部 CDN resource は収集しない
- Vite HMR なし（full reload）
- screen 単位の高度な incremental collect なし
- AI / screenshot OCR なし

## 6. npm publish 順序（次 phase）

```text
1. @ywal123456/jskim@0.6.0
2. @ywal123456/jskim-screen-spec@0.1.0 --access public
3. create-jskim@0.6.0
```

理由:

1. companion の peer が root `^0.6.0` を要求する
2. creator が生成 project に root `^0.6.0` を書く
3. registry に必要な package が揃ってから creator を公開する

コマンド草案（**実行しない**）:

```powershell
# 1. engine
npm.cmd publish --access public

# 2. companion（directory: jskim-screen-spec）
npm.cmd --prefix jskim-screen-spec publish --access public

# 3. creator（directory: create-jskim）
npm.cmd --prefix create-jskim publish --access public
```

## 7. Verification checklist（publish 前）

- [ ] `npm test`（root）
- [ ] companion `test` / `test:collector` / `test:resources` / `test:watch`
- [ ] companion `build` / `build:sample`
- [ ] `npm pack` 3 packages（OS TEMP）
- [ ] tarball に `node_modules` / browser binary / TEMP / token なし
- [ ] `npm publish --dry-run` 3 packages
- [ ] TEMP consumer（npm / pnpm）で tarball インストール
- [ ] fresh project: build / collect / build viewer / spec dev HTTP
- [ ] production: HTML11 / CSS4 / SVG1 / JS0 / no `data-jskim-spec-*`
- [ ] companion 未インストール時の明確な案内
- [ ] peer: root 0.5.2 との非互換が分かる

## 8. Tag / GitHub Release 方針（次 phase）

推奨:

```text
repository tag: v0.6.0
Release note:
  - JSKim 0.6.0（optional Screen Spec integration）
  - Screen Spec companion 0.1.0（initial public MVP）
  - create-jskim 0.6.0
```

companion 専用 tag（`screen-spec-v0.1.0`）は同一 commit への重複を避け、原則 **単一の `v0.6.0`** でまとめる。

## 9. Rollback / deprecate 原則

- 同じ name/version の再 publish はできない前提
- 重大不具合時は `npm deprecate` で案内し、次 patch/minor で修正
- companion だけを deprecate する場合も peer（`^0.6.0`）との組み合わせを明記

## 10. 公開後 smoke（次 phase）

```bash
npm create jskim@latest my-app
cd my-app
npm install
npm install -D @ywal123456/jskim-screen-spec
npx playwright install chromium
npx jskim build sample
npx jskim spec collect sample
npx jskim spec build sample
npx jskim spec dev sample
```
