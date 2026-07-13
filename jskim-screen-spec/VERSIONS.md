# jskim-screen-spec installed versions

Recorded for Phase 5A (Playwright collector).

| Package | Role | Notes |
|---------|------|-------|
| playwright | dependency | Chromium collector（stable） — installed 1.61.1 |
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

Package remains `"private": true` — do not publish.

Root `@ywal123456/jskim` and `create-jskim` have no vue/vite/playwright deps.
