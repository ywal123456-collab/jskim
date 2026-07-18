import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  collectDeviceCapture,
  collectDeviceCaptureWithBrowser,
} from '../../src/device-capture/collect-device-capture.js';
import { getDeviceCaptureStatus } from '../../src/device-capture/status.js';
import { DeviceCaptureError } from '../../src/device-capture/errors.js';
import { launchChromium } from '../../src/collector/collect-screen-spec-project.js';
import { readPngDimensions } from '../../src/device-capture/png-dimensions.js';
import { resetDeviceCaptureQueuesForTests } from '../../src/device-capture/project-queue.js';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '../..');
const repoRoot = path.resolve(packageRoot, '..');
const fixtureRoot = path.join(packageRoot, 'test/fixtures/device-capture');

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

type Layout = {
  rootDir: string;
};

function createTempLayout(): Layout {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-dc-'));
  const pagesDir = path.join(rootDir, 'src/demo/pages');
  const snapDir = path.join(
    rootDir,
    'spec/demo/src/snapshots/device-capture-demo',
  );
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.mkdirSync(snapDir, { recursive: true });
  fs.copyFileSync(
    path.join(fixtureRoot, 'source.spec.json'),
    path.join(pagesDir, 'demo.spec.json'),
  );
  // inputRevision 用の snapshot（実 Capture は route を再実行）
  fs.writeFileSync(
    path.join(snapDir, 'default.html'),
    '<html><!-- snapshot default --></html>\n',
  );
  fs.writeFileSync(
    path.join(snapDir, 'help-modal.html'),
    '<html><!-- snapshot help --></html>\n',
  );
  return { rootDir };
}

describe('collectDeviceCapture integration', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) {
        await fn();
      }
    }
    resetDeviceCaptureQueuesForTests();
  });

  async function startFixtureServer() {
    const port = await getFreePort();
    const server = createStaticServer({
      rootDir: path.join(fixtureRoot, 'public'),
      host: '127.0.0.1',
      port,
      projectName: 'device-capture-fixture',
    });
    await server.start();
    cleanups.push(async () => {
      await server.stop();
    });
    return server;
  }

  it('PC/SP で media query 結果と寸法が異なる', async () => {
    const layout = createTempLayout();
    cleanups.push(async () => {
      fs.rmSync(layout.rootDir, { recursive: true, force: true });
    });
    const server = await startFixtureServer();
    const browser = await launchChromium();
    cleanups.push(async () => {
      await browser.close();
    });

    const base = {
      rootDir: layout.rootDir,
      projectName: 'demo',
      baseUrl: server.url.replace(/\/$/, ''),
      screenId: 'device-capture-demo',
      stateId: 'default',
      browser,
    };

    // Capture 直前の computed style を viewport ごとに確認
    for (const viewport of ['pc', 'sp'] as const) {
      const page = await browser.newPage({
        viewport:
          viewport === 'pc'
            ? { width: 1440, height: 900 }
            : { width: 375, height: 812 },
        deviceScaleFactor: 1,
      });
      await page.goto(`${base.baseUrl}/index.html`, { waitUntil: 'load' });
      const label = await page.evaluate(() => {
        const el = document.getElementById('viewport-label');
        if (!el) {
          return null;
        }
        const style = getComputedStyle(el);
        return {
          after: getComputedStyle(el, '::after').content,
          bg: style.backgroundColor,
        };
      });
      await page.close();
      if (viewport === 'pc') {
        expect(label?.after).toContain('pc-layout');
        expect(label?.bg).toMatch(/0,\s*128,\s*0/);
      } else {
        expect(label?.after).toContain('sp-layout');
        expect(label?.bg).toMatch(/0,\s*0,\s*200/);
      }
    }

    const pc = await collectDeviceCaptureWithBrowser({
      ...base,
      viewport: 'pc',
    });
    const sp = await collectDeviceCaptureWithBrowser({
      ...base,
      viewport: 'sp',
    });

    expect(pc.status).toBe('created');
    expect(sp.status).toBe('created');
    expect(pc.imageRevision).not.toBe(sp.imageRevision);

    const pcPng = fs.readFileSync(pc.imagePath);
    const spPng = fs.readFileSync(sp.imagePath);
    expect(pcPng.equals(spPng)).toBe(false);

    const pcDim = readPngDimensions(pcPng);
    const spDim = readPngDimensions(spPng);
    expect(pcDim.width).toBe(1440);
    expect(spDim.width).toBe(375);
    expect(pcDim.height).toBeGreaterThan(900);
    expect(spDim.height).toBeGreaterThan(812);

    expect(
      getDeviceCaptureStatus({
        ...base,
        viewport: 'pc',
      }).status,
    ).toBe('current');
    expect(
      getDeviceCaptureStatus({
        ...base,
        viewport: 'sp',
      }).status,
    ).toBe('current');
  });

  it('state action（help-modal）が Capture に反映され、再収集は unchanged', async () => {
    const layout = createTempLayout();
    cleanups.push(async () => {
      fs.rmSync(layout.rootDir, { recursive: true, force: true });
    });
    const server = await startFixtureServer();
    const browser = await launchChromium();
    cleanups.push(async () => {
      await browser.close();
    });

    const base = {
      rootDir: layout.rootDir,
      projectName: 'demo',
      baseUrl: server.url.replace(/\/$/, ''),
      screenId: 'device-capture-demo',
      browser,
    };

    const def = await collectDeviceCaptureWithBrowser({
      ...base,
      stateId: 'default',
      viewport: 'sp',
    });
    const help = await collectDeviceCaptureWithBrowser({
      ...base,
      stateId: 'help-modal',
      viewport: 'sp',
    });
    expect(def.imageRevision).not.toBe(help.imageRevision);

    const metaPath = help.metadataPath;
    const before = fs.readFileSync(metaPath);
    const beforeAt = JSON.parse(before.toString('utf8')).capturedAt as string;

    const again = await collectDeviceCaptureWithBrowser({
      ...base,
      stateId: 'help-modal',
      viewport: 'sp',
    });
    expect(again.status).toBe('unchanged');
    expect(fs.readFileSync(metaPath).equals(before)).toBe(true);
    expect(JSON.parse(fs.readFileSync(metaPath, 'utf8')).capturedAt).toBe(
      beforeAt,
    );
  });

  it('収集中の input 変化で既存 Capture を維持する', async () => {
    const layout = createTempLayout();
    cleanups.push(async () => {
      fs.rmSync(layout.rootDir, { recursive: true, force: true });
    });
    const server = await startFixtureServer();
    const browser = await launchChromium();
    cleanups.push(async () => {
      await browser.close();
    });

    const opts = {
      rootDir: layout.rootDir,
      projectName: 'demo',
      baseUrl: server.url.replace(/\/$/, ''),
      screenId: 'device-capture-demo',
      stateId: 'default',
      viewport: 'pc' as const,
      browser,
    };

    const first = await collectDeviceCaptureWithBrowser(opts);
    expect(first.status).toBe('created');
    const metaBefore = fs.readFileSync(first.metadataPath);
    const imageBefore = fs.readFileSync(first.imagePath);

    await expect(
      collectDeviceCaptureWithBrowser({
        ...opts,
        hooks: {
          mutateInputAfterCapture: () => {
            fs.writeFileSync(
              path.join(
                layout.rootDir,
                'spec/demo/src/snapshots/device-capture-demo/default.html',
              ),
              '<html><!-- changed mid capture --></html>\n',
            );
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'SPEC_DEVICE_CAPTURE_INPUT_CHANGED',
    });

    expect(fs.readFileSync(first.metadataPath).equals(metaBefore)).toBe(true);
    expect(fs.readFileSync(first.imagePath).equals(imageBefore)).toBe(true);
  });

  it('screenshot 失敗時は既存を維持する', async () => {
    const layout = createTempLayout();
    cleanups.push(async () => {
      fs.rmSync(layout.rootDir, { recursive: true, force: true });
    });
    const server = await startFixtureServer();
    const browser = await launchChromium();
    cleanups.push(async () => {
      await browser.close();
    });

    const opts = {
      rootDir: layout.rootDir,
      projectName: 'demo',
      baseUrl: server.url.replace(/\/$/, ''),
      screenId: 'device-capture-demo',
      stateId: 'default',
      viewport: 'sp' as const,
      browser,
    };
    const first = await collectDeviceCaptureWithBrowser(opts);
    const metaBefore = fs.readFileSync(first.metadataPath);

    await expect(
      collectDeviceCaptureWithBrowser({
        ...opts,
        hooks: { failScreenshot: true },
      }),
    ).rejects.toBeInstanceOf(DeviceCaptureError);

    expect(fs.readFileSync(first.metadataPath).equals(metaBefore)).toBe(true);
  });

  it('source 変更後は stale、再収集で current', async () => {
    const layout = createTempLayout();
    cleanups.push(async () => {
      fs.rmSync(layout.rootDir, { recursive: true, force: true });
    });
    const server = await startFixtureServer();

    const result = await collectDeviceCapture({
      rootDir: layout.rootDir,
      projectName: 'demo',
      baseUrl: server.url.replace(/\/$/, ''),
      screenId: 'device-capture-demo',
      stateId: 'default',
      viewport: 'pc',
    });
    expect(result.status).toBe('created');
    expect(
      getDeviceCaptureStatus({
        rootDir: layout.rootDir,
        projectName: 'demo',
        screenId: 'device-capture-demo',
        stateId: 'default',
        viewport: 'pc',
      }).status,
    ).toBe('current');

    fs.writeFileSync(
      path.join(
        layout.rootDir,
        'spec/demo/src/snapshots/device-capture-demo/default.html',
      ),
      '<html><!-- stale --></html>\n',
    );
    expect(
      getDeviceCaptureStatus({
        rootDir: layout.rootDir,
        projectName: 'demo',
        screenId: 'device-capture-demo',
        stateId: 'default',
        viewport: 'pc',
      }).status,
    ).toBe('stale');

    const again = await collectDeviceCapture({
      rootDir: layout.rootDir,
      projectName: 'demo',
      baseUrl: server.url.replace(/\/$/, ''),
      screenId: 'device-capture-demo',
      stateId: 'default',
      viewport: 'pc',
    });
    expect(['created', 'updated']).toContain(again.status);
    expect(
      getDeviceCaptureStatus({
        rootDir: layout.rootDir,
        projectName: 'demo',
        screenId: 'device-capture-demo',
        stateId: 'default',
        viewport: 'pc',
      }).status,
    ).toBe('current');
  });
});
