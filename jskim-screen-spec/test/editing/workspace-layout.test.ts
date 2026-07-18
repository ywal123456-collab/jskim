import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import type { Socket } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chromium,
  type Browser,
  type BrowserServer,
  type Page,
} from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.resolve(here, '../../src/viewer/styles/viewer.css');
const htmlPath = path.resolve(here, 'fixtures/workspace-layout.html');

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * 全体 Vitest suite 負荷下では Chromium の graceful 終了が 10s 超かかることがある
 * （計測: browser.close ≈ 10187ms、sockets=0、HTTP server.close ≈ 1ms）。
 * keep-alive / socket リークではなく、並列 jsdom 負荷下のプロセス終了遅延。
 * launchServer で PID を握り、テスト終了時は kill / SIGKILL で確実に落とす。
 */
async function closePlaywrightSession(options: {
  browser: Browser | undefined;
  browserServer: BrowserServer | undefined;
}): Promise<void> {
  const { browser, browserServer } = options;

  if (browser) {
    for (const ctx of browser.contexts()) {
      void ctx.close().catch(() => undefined);
    }
    void browser.close().catch(() => undefined);
  }

  if (!browserServer) {
    return;
  }

  const proc = browserServer.process();
  await Promise.race([
    browserServer.kill().catch(() => undefined),
    delay(3000),
  ]);
  if (proc && !proc.killed) {
    try {
      proc.kill('SIGKILL');
    } catch {
      // 既に終了済み
    }
  }
}

/** keep-alive 残りを破棄してから listen を止める */
async function closeHttpServer(
  server: http.Server | undefined,
  sockets: Set<Socket>,
): Promise<void> {
  if (!server) {
    return;
  }
  if (typeof server.closeIdleConnections === 'function') {
    server.closeIdleConnections();
  }
  for (const socket of sockets) {
    socket.destroy();
  }
  sockets.clear();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

describe('Viewer workspace 狭幅レイアウト', () => {
  let server: http.Server | undefined;
  let port: number;
  let browserServer: BrowserServer | undefined;
  let browser: Browser | undefined;
  const sockets = new Set<Socket>();

  beforeAll(async () => {
    const css = fs.readFileSync(cssPath);
    const html = fs.readFileSync(htmlPath);

    server = http.createServer((req, res) => {
      const url = req.url || '/';
      // テスト用静的配信。keep-alive を残さない
      const headers: Record<string, string> = {
        Connection: 'close',
      };
      if (url === '/viewer.css') {
        res.writeHead(200, {
          ...headers,
          'Content-Type': 'text/css; charset=utf-8',
        });
        res.end(css);
        return;
      }
      res.writeHead(200, {
        ...headers,
        'Content-Type': 'text/html; charset=utf-8',
      });
      res.end(html);
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => {
        sockets.delete(socket);
      });
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('server address missing');
    }
    port = address.port;

    // connect クライアントと server プロセスを分離し、終了時に kill 可能にする
    browserServer = await chromium.launchServer({ headless: true });
    browser = await chromium.connect(browserServer.wsEndpoint());
  }, 30000);

  // graceful Chromium 終了が 10s 超になる実測があるため 15s。
  // 本体の片付けは 8s で打ち切り、残プロセスは SIGKILL する（リーク隠しではない）。
  afterAll(async () => {
    const browserRef = browser;
    const browserServerRef = browserServer;
    const serverRef = server;

    await Promise.race([
      Promise.all([
        closePlaywrightSession({
          browser: browserRef,
          browserServer: browserServerRef,
        }),
        closeHttpServer(serverRef, sockets),
      ]),
      delay(8000),
    ]);

    try {
      const proc = browserServerRef?.process();
      if (proc && !proc.killed) {
        proc.kill('SIGKILL');
      }
    } catch {
      // ignore
    }
    for (const socket of sockets) {
      socket.destroy();
    }
    sockets.clear();
    if (serverRef?.listening) {
      serverRef.close(() => undefined);
    }

    browser = undefined;
    browserServer = undefined;
    server = undefined;
  }, 15000);

  async function openAt(width: number): Promise<Page> {
    if (!browser) {
      throw new Error('browser is not initialized');
    }
    const page = await browser.newPage({
      viewport: { width, height: 900 },
    });
    await page.goto(`http://127.0.0.1:${port}/`, {
      waitUntil: 'load',
    });
    return page;
  }

  async function measure(page: Page) {
    return page.evaluate(() => {
      const preview = document.getElementById('preview')!;
      const doc = document.getElementById('doc')!;
      const workspace = document.getElementById('workspace')!;
      const previewStyle = getComputedStyle(preview);
      const workspaceStyle = getComputedStyle(workspace);
      const pr = preview.getBoundingClientRect();
      const dr = doc.getBoundingClientRect();
      const wr = workspace.getBoundingClientRect();
      const bodyScrollWidth = document.documentElement.scrollWidth;
      const bodyClientWidth = document.documentElement.clientWidth;
      return {
        preview: {
          x: pr.x,
          y: pr.y,
          width: pr.width,
          height: pr.height,
          bottom: pr.bottom,
          right: pr.right,
        },
        doc: {
          x: dr.x,
          y: dr.y,
          width: dr.width,
          height: dr.height,
          top: dr.top,
          left: dr.left,
        },
        workspace: { width: wr.width, right: wr.right },
        sticky: previewStyle.position,
        columns: workspaceStyle.gridTemplateColumns,
        bodyOverflowX: bodyScrollWidth - bodyClientWidth,
        previewWithinWorkspace: pr.right <= wr.right + 1 && pr.left >= wr.left - 1,
      };
    });
  }

  it('CSS に狭幅で sticky 解除と minmax(0, …) がある', () => {
    const css = fs.readFileSync(cssPath, 'utf8');
    expect(css).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1\.1fr\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*960px\)/);
    expect(css).toMatch(/position:\s*static/);
  });

  it('広い画面(1440): 左右配置で overlap なし', async () => {
    const page = await openAt(1440);
    try {
      const m = await measure(page);
      expect(m.sticky).toBe('sticky');
      expect(m.columns.split(' ').length).toBeGreaterThanOrEqual(2);
      expect(overlaps(m.preview, m.doc)).toBe(false);
      expect(m.preview.x).toBeLessThan(m.doc.x);
      expect(m.previewWithinWorkspace).toBe(true);
      expect(m.bodyOverflowX).toBeLessThanOrEqual(1);
    } finally {
      await page.close();
    }
  });

  it('中間幅(1024/900): overlap なし', async () => {
    for (const width of [1024, 900]) {
      const page = await openAt(width);
      try {
        const m = await measure(page);
        expect(overlaps(m.preview, m.doc)).toBe(false);
        expect(m.previewWithinWorkspace).toBe(true);
        expect(m.bodyOverflowX).toBeLessThanOrEqual(2);
        if (width <= 960) {
          expect(m.sticky).toBe('static');
          expect(m.preview.bottom).toBeLessThanOrEqual(m.doc.top + 1);
        }
      } finally {
        await page.close();
      }
    }
  });

  it('狭い画面(768/390): 1 列・sticky 解除・Preview が上', async () => {
    for (const width of [768, 390]) {
      const page = await openAt(width);
      try {
        const m = await measure(page);
        expect(m.sticky).toBe('static');
        expect(overlaps(m.preview, m.doc)).toBe(false);
        expect(m.preview.bottom).toBeLessThanOrEqual(m.doc.top + 1);
        expect(m.previewWithinWorkspace).toBe(true);
        expect(m.bodyOverflowX).toBeLessThanOrEqual(2);
        expect(await page.locator('#save').isVisible()).toBe(true);
        expect(await page.locator('.spec-page__nav button').first().isVisible()).toBe(
          true,
        );
      } finally {
        await page.close();
      }
    }
  });

  it('1280 でも Preview が workspace をはみ出さない', async () => {
    const page = await openAt(1280);
    try {
      const m = await measure(page);
      expect(overlaps(m.preview, m.doc)).toBe(false);
      expect(m.previewWithinWorkspace).toBe(true);
      expect(m.preview.right).toBeLessThanOrEqual(m.doc.left + 1);
    } finally {
      await page.close();
    }
  });
});
