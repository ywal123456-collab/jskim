'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fsp = require('node:fs/promises');
const fse = require('fs-extra');
const { classifyReload } = require('../scripts/lib/classify-reload');

describe('classifyReload', () => {
  let sourceDir;
  let templatesDir;
  let pagesCss;
  let nestedCss;
  let templateCss;
  let componentNjk;
  let htmlNjk;
  let jsFile;

  async function setup() {
    sourceDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'jskim-classify-'));
    templatesDir = path.join(sourceDir, 'layouts');
    const componentsDir = path.join(sourceDir, 'components');
    const pagesDir = path.join(sourceDir, 'pages');
    const assetsCss = path.join(sourceDir, 'assets', 'css');
    const pageLocalCss = path.join(pagesDir, 'request', 'assets', 'css');

    await fse.ensureDir(templatesDir);
    await fse.ensureDir(componentsDir);
    await fse.ensureDir(assetsCss);
    await fse.ensureDir(pageLocalCss);

    pagesCss = path.join(assetsCss, 'style.css');
    nestedCss = path.join(pageLocalCss, 'request.css.njk');
    templateCss = path.join(templatesDir, 'theme.css.njk');
    componentNjk = path.join(componentsDir, 'card.njk');
    htmlNjk = path.join(pagesDir, 'index.html.njk');
    jsFile = path.join(sourceDir, 'assets', 'js', 'main.js');

    await fse.outputFile(pagesCss, 'body{}\n');
    await fse.outputFile(nestedCss, 'body{}\n');
    await fse.outputFile(templateCss, 'body{}\n');
    await fse.outputFile(componentNjk, '<div></div>\n');
    await fse.outputFile(htmlNjk, '<p></p>\n');
    await fse.outputFile(jsFile, 'console.log(1);\n');
  }

  async function cleanup() {
    if (sourceDir) {
      await fse.remove(sourceDir).catch(() => {});
    }
  }

  function classify(events) {
    return classifyReload({
      events,
      sourceDir,
      templates: ['layouts', 'components'],
    });
  }

  it('CSS change / css.njk / nested / 複数 CSS は css', async () => {
    await setup();
    try {
      assert.equal(
        classify([{ event: 'change', absolutePath: pagesCss }]),
        'css'
      );
      assert.equal(
        classify([{ event: 'change', absolutePath: nestedCss }]),
        'css'
      );
      assert.equal(
        classify([
          { event: 'change', absolutePath: pagesCss },
          { event: 'change', absolutePath: nestedCss },
        ]),
        'css'
      );

      if (process.platform === 'win32') {
        const mixedSep = pagesCss.replace(/\\/g, '/');
        assert.equal(
          classify([{ event: 'change', absolutePath: mixedSep }]),
          'css'
        );
        assert.equal(
          classify([
            {
              event: 'change',
              absolutePath: pagesCss.toUpperCase(),
            },
          ]),
          'css'
        );
      }
    } finally {
      await cleanup();
    }
  });

  it('CSS 以外や不確実な変更は reload', async () => {
    await setup();
    try {
      assert.equal(
        classify([
          { event: 'change', absolutePath: pagesCss },
          { event: 'change', absolutePath: htmlNjk },
        ]),
        'reload'
      );
      assert.equal(
        classify([
          { event: 'change', absolutePath: pagesCss },
          { event: 'change', absolutePath: jsFile },
        ]),
        'reload'
      );
      assert.equal(
        classify([{ event: 'add', absolutePath: pagesCss }]),
        'reload'
      );
      assert.equal(
        classify([{ event: 'unlink', absolutePath: pagesCss }]),
        'reload'
      );
      assert.equal(
        classify([
          {
            event: 'addDir',
            absolutePath: path.join(sourceDir, 'assets', 'css'),
          },
        ]),
        'reload'
      );
      assert.equal(
        classify([{ event: 'change', absolutePath: templateCss }]),
        'reload'
      );
      assert.equal(
        classify([{ event: 'change', absolutePath: componentNjk }]),
        'reload'
      );
      assert.equal(
        classify([{ event: 'unknown', absolutePath: pagesCss }]),
        'reload'
      );
      assert.equal(classify([{ event: 'change' }]), 'reload');
      assert.equal(
        classify([{ event: 'change', file: 'assets/css/style.css' }]),
        'reload'
      );
      assert.equal(classify([]), 'reload');
    } finally {
      await cleanup();
    }
  });
});
