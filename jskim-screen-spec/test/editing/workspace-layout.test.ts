import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';

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

describe('Viewer workspace 狭幅レイアウト', () => {
  let server: http.Server;
  let port: number;
  let browser: Browser;

  beforeAll(async () => {
    const css = fs.readFileSync(cssPath);
    const html = fs.readFileSync(htmlPath);

    server = http.createServer((req, res) => {
      const url = req.url || '/';
      if (url === '/viewer.css') {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        res.end(css);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('server address missing');
    }
    port = address.port;
    browser = await chromium.launch({ headless: true });
  }, 30000);

  afterAll(async () => {
    await browser?.close().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function openAt(width: number): Promise<Page> {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
    });
    await page.goto(`http://127.0.0.1:${port}/`, {
      waitUntil: 'networkidle',
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
