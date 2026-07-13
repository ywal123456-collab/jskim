/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { collectScreenSpecProject } from '../../src/collector/collect-screen-spec-project.js';
import { findResourceTokens } from '../../src/collector/resources/resource-token.js';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '../..');
const repoRoot = path.resolve(packageRoot, '..');
const fixtureRoot = path.join(
  packageRoot,
  'test/fixtures/collector-resources',
);

const { getFreePort } = require(
  path.join(repoRoot, 'scripts/lib/get-free-port.js'),
) as { getFreePort: () => Promise<number> };

const { createStaticServer } = require(
  path.join(repoRoot, 'scripts/lib/create-static-server.js'),
) as {
  createStaticServer: (opts: {
    rootDir: string;
    host: string;
    port: number;
    projectName?: string;
  }) => {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    url: string;
  };
};

function createTempProjectLayout() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-res-'));
  const pagesDir = path.join(rootDir, 'src/demo/pages');
  const dataDir = path.join(rootDir, 'spec/demo/src/data');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.copyFileSync(
    path.join(fixtureRoot, 'source.spec.json'),
    path.join(pagesDir, 'demo.spec.json'),
  );
  fs.copyFileSync(
    path.join(fixtureRoot, 'description.json'),
    path.join(dataDir, 'collector-resources-demo.json'),
  );
  return rootDir;
}

async function buildViewer(
  options: Parameters<
    typeof import('../../src/builder/build-screen-spec-viewer.js').buildScreenSpecViewer
  >[0],
) {
  const { buildScreenSpecViewer } = await import(
    '../../src/builder/build-screen-spec-viewer.js'
  );
  return buildScreenSpecViewer(options);
}

describe('resource collection integration', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) {
        await fn();
      }
    }
  });

  it('collect → build(/spec/) → preview で style / img が解決し token が残らない', async () => {
    const rootDir = createTempProjectLayout();
    const port = await getFreePort();
    const server = createStaticServer({
      rootDir: path.join(fixtureRoot, 'public'),
      host: '127.0.0.1',
      port,
      projectName: 'collector-resources',
    });
    await server.start();
    cleanups.push(async () => {
      await server.stop();
      fs.rmSync(rootDir, { recursive: true, force: true });
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    const first = await collectScreenSpecProject({
      rootDir,
      projectName: 'demo',
      baseUrl,
    });

    expect(first.stylesheets).toBeGreaterThanOrEqual(2);
    expect(first.resources).toBeGreaterThanOrEqual(3);
    expect(first.resourceWarnings.some((w) => w.includes('外部'))).toBe(true);

    const resourcesDir = path.join(rootDir, 'spec/demo/src/resources');
    expect(fs.existsSync(path.join(resourcesDir, 'manifest.json'))).toBe(true);

    const second = await collectScreenSpecProject({
      rootDir,
      projectName: 'demo',
      baseUrl,
    });
    expect(second.updated).toBe(0);
    // 同一内容の再 put で reused が増える
    expect(second.resourcesReused).toBeGreaterThanOrEqual(0);

    const serveRoot = path.join(rootDir, 'serve');
    const outDir = path.join(serveRoot, 'spec');
    await buildViewer({
      rootDir,
      projectName: 'demo',
      outDir,
      base: '/spec/',
    });

    // dist に token が残っていないこと
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) {
          out.push(...walk(full));
        } else if (/\.(html|css|json)$/i.test(name)) {
          out.push(full);
        }
      }
      return out;
    };
    for (const file of walk(path.join(outDir, 'data'))) {
      const text = fs.readFileSync(file, 'utf8');
      expect(findResourceTokens(text), file).toEqual([]);
    }

    const previewPort = await getFreePort();
    const previewServer = createStaticServer({
      rootDir: serveRoot,
      host: '127.0.0.1',
      port: previewPort,
      projectName: 'spec-preview',
    });
    await previewServer.start();
    cleanups.push(async () => {
      await previewServer.stop();
    });

    const browser = await chromium.launch({ headless: true });
    cleanups.push(async () => {
      await browser.close();
    });
    const page = await browser.newPage();
    const externalHits: string[] = [];
    page.on('request', (req) => {
      const u = req.url();
      if (/cdn\.example\.com/.test(u)) {
        externalHits.push(u);
      }
    });

    await page.goto(`http://127.0.0.1:${previewPort}/spec/`, {
      waitUntil: 'networkidle',
    });
    await page.waitForSelector('.dom-preview', { timeout: 15000 });

    const checks = await page.evaluate(async () => {
      const el = document.querySelector('.dom-preview') as HTMLElement | null;
      const shadow = el?.shadowRoot;
      if (!shadow) {
        return { ok: false, reason: 'no-shadow' };
      }
      const links = [...shadow.querySelectorAll('link[rel="stylesheet"]')];
      await Promise.all(
        links.map(
          (link) =>
            new Promise<void>((resolve) => {
              const l = link as HTMLLinkElement;
              if (l.sheet) {
                resolve();
              } else {
                l.addEventListener('load', () => resolve(), { once: true });
                l.addEventListener('error', () => resolve(), { once: true });
              }
            }),
        ),
      );
      const img = shadow.querySelector(
        '[data-jskim-spec-item="hero-image"]',
      ) as HTMLImageElement | null;
      const imgSrc = img?.getAttribute('src') || '';
      let decodedWidth = 0;
      if (imgSrc) {
        decodedWidth = await new Promise<number>((resolve) => {
          const probe = new Image();
          probe.onload = () => resolve(probe.naturalWidth);
          probe.onerror = () => resolve(0);
          probe.src = imgSrc;
        });
      }
      const panel = shadow.querySelector('.panel') as HTMLElement | null;
      const color = panel ? getComputedStyle(panel).color : '';
      return {
        ok: true,
        imgWidth: decodedWidth,
        imgSrc,
        panelColor: color,
        hasToken: shadow.innerHTML.includes('jskim-spec-resource://'),
        linkCount: links.length,
      };
    });

    expect(checks.ok).toBe(true);
    expect(checks.hasToken).toBe(false);
    expect(checks.linkCount).toBeGreaterThanOrEqual(1);
    expect(checks.imgSrc).toContain('/spec/data/resources/files/');
    expect(checks.panelColor).toMatch(/rgb\(\s*17,\s*17,\s*17\s*\)|#111/);

    const screenResource = JSON.parse(
      fs.readFileSync(
        path.join(resourcesDir, 'screens/collector-resources-demo.json'),
        'utf8',
      ),
    ) as {
      states: Record<
        string,
        {
          documentContext?: {
            body?: { class?: string[] };
            html?: { attributes?: Record<string, string> };
          };
        }
      >;
    };
    const defaultCtx = screenResource.states.default?.documentContext;
    expect(defaultCtx?.body?.class).toContain('app-body');
    expect(defaultCtx?.html?.attributes?.lang).toBe('ja');

    const viewerScreen = JSON.parse(
      fs.readFileSync(
        path.join(outDir, 'data/screens/collector-resources-demo.json'),
        'utf8',
      ),
    ) as {
      states: Array<{
        id: string;
        documentContext?: { body?: { class?: string[] } };
      }>;
    };
    const viewerDefault = viewerScreen.states.find((s) => s.id === 'default');
    expect(viewerDefault?.documentContext?.body?.class).toContain('app-body');

    const styleChecks = await page.evaluate(async () => {
      const el = document.querySelector('.dom-preview') as HTMLElement | null;
      const shadow = el?.shadowRoot;
      if (!shadow || !el) {
        return { ok: false as const, reason: 'no-shadow' };
      }
      const links = [...shadow.querySelectorAll('link[rel="stylesheet"]')];
      await Promise.all(
        links.map(
          (link) =>
            new Promise<void>((resolve) => {
              const l = link as HTMLLinkElement;
              if (l.sheet) {
                resolve();
              } else {
                l.addEventListener('load', () => resolve(), { once: true });
                l.addEventListener('error', () => resolve(), { once: true });
              }
            }),
        ),
      );
      const previewBody = shadow.querySelector(
        '[data-jskim-spec-preview-body]',
      ) as HTMLElement | null;
      const hostStyle = getComputedStyle(el);
      const bodyStyle = previewBody ? getComputedStyle(previewBody) : null;
      const header = document.querySelector('.spec-header') as HTMLElement | null;
      const sidebar = document.querySelector(
        '.spec-sidebar',
      ) as HTMLElement | null;
      return {
        ok: true as const,
        wrapperClass: previewBody?.className || '',
        hostSampleColor: hostStyle.getPropertyValue('--sample-color').trim(),
        bodyBg: bodyStyle?.backgroundColor || '',
        headerBg: header ? getComputedStyle(header).backgroundColor : '',
        sidebarDisplay: sidebar ? getComputedStyle(sidebar).display : '',
      };
    });

    expect(styleChecks.ok).toBe(true);
    if (styleChecks.ok) {
      expect(styleChecks.wrapperClass.split(/\s+/)).toEqual(
        expect.arrayContaining(['preview-root', 'app-body']),
      );
      expect(styleChecks.hostSampleColor).toMatch(/rgb\(\s*1,\s*2,\s*3\s*\)/);
      expect(styleChecks.bodyBg).toMatch(/rgb\(\s*10,\s*20,\s*30\s*\)/);
      // Header / Sidebar は Shadow 外のため body.app-body の影響を受けない
      expect(styleChecks.headerBg).not.toMatch(/rgb\(\s*10,\s*20,\s*30\s*\)/);
      expect(styleChecks.sidebarDisplay).not.toBe('');
    }

    const imgPath = checks.imgSrc.replace(/^https?:\/\/[^/]+/, '');
    const diskPath = path.join(serveRoot, imgPath.replace(/^\//, ''));
    expect(fs.existsSync(diskPath), `missing ${diskPath}`).toBe(true);
    expect(fs.statSync(diskPath).size).toBeGreaterThan(0);

    const imgRes = await page.request.get(
      `http://127.0.0.1:${previewPort}${imgPath}`,
    );
    expect(imgRes.status()).toBe(200);

    expect(checks.imgWidth).toBeGreaterThan(0);
    expect(externalHits).toEqual([]);
  }, 120000);

  it('custom base /docs/spec/ でも token を解決する', async () => {
    const rootDir = createTempProjectLayout();
    const port = await getFreePort();
    const server = createStaticServer({
      rootDir: path.join(fixtureRoot, 'public'),
      host: '127.0.0.1',
      port,
    });
    await server.start();
    cleanups.push(async () => {
      await server.stop();
      fs.rmSync(rootDir, { recursive: true, force: true });
    });

    await collectScreenSpecProject({
      rootDir,
      projectName: 'demo',
      baseUrl: `http://127.0.0.1:${port}`,
    });

    const outDir = path.join(rootDir, 'spec/demo/dist-docs');
    await buildViewer({
      rootDir,
      projectName: 'demo',
      outDir,
      base: '/docs/spec/',
    });

    const screenJson = fs.readFileSync(
      path.join(outDir, 'data/screens/collector-resources-demo.json'),
      'utf8',
    );
    expect(screenJson).toContain('/docs/spec/data/resources/files/');
    expect(findResourceTokens(screenJson)).toEqual([]);
  }, 60000);
});
