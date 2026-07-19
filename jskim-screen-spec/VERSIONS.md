# jskim-screen-spec installed versions

Recorded for Phase 5A (Playwright collector) / Phase 5B (CSS·asset auto-collection).

| Package | Role | Notes |
|---------|------|-------|
| playwright | dependency | Chromium collector（stable） — installed 1.61.1 |
| postcss | dependency | CSS @import / url() / Shadow 互換 rewrite — **8.5.18** |
| postcss-selector-parser | dependency | Shadow 互換セレクタのトークン書き換え — **7.1.4** |
| postcss-value-parser | dependency | url() 値の解析 — **4.2.0** |
| vue | dependency | viewer |
| vue-router | dependency | viewer |
| vite | dependency | viewer build + Node builder runtime |
| @vitejs/plugin-vue | dependency | vite config |
| typescript | devDependency | `tsc` for dist entry |
| vitest / jsdom / @vue/test-utils | devDependency | tests |

Browsers are **not** downloaded on `npm install`. Run:

```bash
npm --prefix jskim-screen-spec run install:browsers
```

Public npm package (`publishConfig.access: public`). Peer: `@ywal123456/jskim` **^0.7.0**.

Root `@ywal123456/jskim` and `create-jskim` have no vue/vite/playwright/postcss deps.
