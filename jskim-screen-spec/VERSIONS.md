# jskim-screen-spec installed versions

Recorded for Phase 4A (after moving vite / @vitejs/plugin-vue to dependencies).

| Package | Role | Notes |
|---------|------|-------|
| vue | dependency | viewer |
| vue-router | dependency | viewer |
| vite | dependency | viewer build + Node builder runtime |
| @vitejs/plugin-vue | dependency | vite config |
| typescript | devDependency | `tsc` for dist entry |
| vitest / jsdom / @vue/test-utils | devDependency | tests |

Package remains `"private": true` — do not publish.

Root `@ywal123456/jskim` and `create-jskim` have no vue/vite deps.
