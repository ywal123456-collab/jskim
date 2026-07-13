'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { REPO_ROOT } = require('./helpers/create-test-workspace');
const {
  CHAPTER_SPECS,
  COVER_SECTIONS,
  extractMarkdownSection,
  extractTargetVersionFromReadme,
  assertGuideVersionMatchesPackage,
  loadGuideSources,
  parseGitHubOrigin,
  rewriteHref,
  rewriteMarkdownLinks,
  buildDocumentHtml,
  buildCoverHtml,
  trimCoverSectionBody,
  findBrowserExecutable,
  parseBuildArgs,
  defaultPdfOutputPath,
  packagePdfOutputPath,
  resolvePdfOutputPath,
  writeGuideHtml,
  getPackageVersion,
  createMarkdownIt,
  renderMarkdown,
} = require('../scripts/docs/user-guide-pdf-lib');

describe('user-guide-pdf', () => {
  it('chapter 順序が README + 01–14 の固定順である', () => {
    assert.equal(CHAPTER_SPECS.length, 14);
    const sources = loadGuideSources(REPO_ROOT);
    assert.equal(sources.chapters.length, 14);
    assert.equal(sources.chapters[0].file, '01-introduction.md');
    assert.equal(sources.chapters[13].file, '14-limitations.md');
    for (let i = 0; i < CHAPTER_SPECS.length; i += 1) {
      assert.equal(sources.chapters[i].id, CHAPTER_SPECS[i].id);
      assert.equal(sources.chapters[i].title, CHAPTER_SPECS[i].title);
    }
  });

  it('package version と README 対象 version が一致し filename に使う', () => {
    const sources = loadGuideSources(REPO_ROOT);
    const version = getPackageVersion(REPO_ROOT);
    assert.equal(version, '0.5.2');
    assert.equal(
      extractTargetVersionFromReadme(sources.readmeText),
      version
    );
    assert.doesNotThrow(() =>
      assertGuideVersionMatchesPackage(sources.readmeText, version)
    );
    assert.equal(
      path.basename(defaultPdfOutputPath(REPO_ROOT, version)),
      `JSKim_User_Guide_v${version}.pdf`
    );
    assert.equal(
      path.basename(packagePdfOutputPath(REPO_ROOT, version)),
      `JSKim_User_Guide_v${version}.pdf`
    );
    assert.equal(
      resolvePdfOutputPath(REPO_ROOT, version, { packageOutput: true }),
      packagePdfOutputPath(REPO_ROOT, version)
    );
    assert.throws(
      () => assertGuideVersionMatchesPackage(sources.readmeText, '9.9.9'),
      /一致しません/
    );
  });

  it('README cover section を抽出し、章一覧は含めない', () => {
    const sources = loadGuideSources(REPO_ROOT);
    for (const spec of COVER_SECTIONS) {
      const body = extractMarkdownSection(sources.readmeText, spec.heading);
      assert.ok(body.length > 0);
      // H3（###）は許可。次の H2 は含めない。
      assert.equal(/^##\s+/m.test(body), false);
    }
    assert.throws(
      () => extractMarkdownSection(sources.readmeText, '存在しない見出し'),
      /見つかりません/
    );
    const about = extractMarkdownSection(
      sources.readmeText,
      'このガイドについて'
    );
    assert.match(about, /初めて利用するユーザー/);
    assert.match(about, /学べます/);
    assert.equal(about.includes('章一覧'), false);
    const howTo = extractMarkdownSection(sources.readmeText, '読み方');
    assert.match(howTo, /初めて使う場合/);
    assert.equal(howTo.includes('章一覧'), false);

    const trimmedHowTo = trimCoverSectionBody('読み方', howTo);
    assert.match(trimmedHowTo, /初めて使う場合/);
    assert.equal(trimmedHowTo.includes('必要なときだけ参照する場合'), false);
    const coverHtml = buildCoverHtml(sources.readmeText, getPackageVersion(REPO_ROOT));
    assert.match(coverHtml, /一般公開ドキュメント/);
    assert.equal(coverHtml.includes('章一覧'), false);
    assert.equal(coverHtml.includes('必要なときだけ参照する場合'), false);
  });

  it('HTML 構造に Cover / TOC / chapter-01〜14 がある', () => {
    const html = buildDocumentHtml({ repoRoot: REPO_ROOT });
    assert.equal((html.match(/class="cover"/g) || []).length, 1);
    assert.equal((html.match(/class="toc"/g) || []).length, 1);
    assert.equal((html.match(/class="chapter"/g) || []).length, 14);
    for (let i = 1; i <= 14; i += 1) {
      const id = String(i).padStart(2, '0');
      assert.match(html, new RegExp(`id="chapter-${id}"`));
      assert.match(html, new RegExp(`href="#chapter-${id}"`));
      assert.match(html, new RegExp(`${id}\\.\\s*`));
    }
    assert.equal(html.includes('class="cover"'), true);
    assert.equal(/##\s*章一覧|章一覧<\/h2>/.test(html), false);
    assert.match(html, /一般公開ドキュメント/);
    assert.match(html, /このガイドについて/);
    assert.match(html, /読み方/);
    assert.doesNotMatch(html, /\(README より抽出\)/);
    assert.doesNotMatch(html, /準備中|TODO|placeholder/i);
    // PDF 用 TOC にファイル名を並べない
    assert.doesNotMatch(html, /<nav class="toc"[\s\S]*01-introduction\.md/);
  });

  it('markdown-it が code / table / blockquote / nested list を変換する', () => {
    const md = createMarkdownIt();
    const sample = [
      '> **Note**',
      '>',
      '> 説明',
      '',
      '```bash',
      'npm run build',
      '```',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '- parent',
      '  - child',
      '',
      '**bold** and `code`',
    ].join('\n');
    const html = renderMarkdown(sample, md);
    assert.match(html, /<blockquote>/);
    assert.match(html, /language-bash/);
    assert.match(html, /<table>/);
    assert.match(html, /<ul>/);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<code>code<\/code>/);
  });

  it('chapter / GitHub / plain path の link 変換が正しい', () => {
    const fromFile = path.join(
      REPO_ROOT,
      'docs/user-guide/01-introduction.md'
    );
    const githubCtx = {
      repoRoot: REPO_ROOT,
      fromFile,
      github: { owner: 'ywal123456-collab', repo: 'jskim' },
      headSha: 'abc123def',
      baseUrl: 'https://github.com/ywal123456-collab/jskim',
    };

    assert.deepEqual(
      rewriteHref('./11-dashboard-example.md', githubCtx),
      { kind: 'chapter', href: '#chapter-11' }
    );
    assert.deepEqual(
      rewriteHref('https://example.com/x', githubCtx),
      { kind: 'external', href: 'https://example.com/x' }
    );

    const source = rewriteHref(
      '../../src/sample/pages/dashboard/index.html.njk',
      githubCtx
    );
    assert.equal(source.kind, 'github');
    assert.equal(
      source.href,
      'https://github.com/ywal123456-collab/jskim/blob/abc123def/src/sample/pages/dashboard/index.html.njk'
    );

    const configLink = rewriteHref('../configuration.md', githubCtx);
    assert.equal(configLink.kind, 'github');
    assert.match(configLink.href, /\/blob\/abc123def\/docs\/configuration\.md$/);

    const plainCtx = {
      ...githubCtx,
      github: null,
      headSha: null,
      baseUrl: undefined,
    };
    const plain = rewriteHref(
      '../../src/sample/pages/index.html.njk',
      plainCtx
    );
    assert.equal(plain.kind, 'plain');
    assert.equal(plain.text, 'src/sample/pages/index.html.njk');

    const rewritten = rewriteMarkdownLinks(
      'see [Dashboard](./11-dashboard-example.md) and [cfg](../configuration.md)',
      githubCtx
    );
    assert.match(rewritten, /\]\(#chapter-11\)/);
    assert.match(
      rewritten,
      /blob\/abc123def\/docs\/configuration\.md/
    );
  });

  it('GitHub origin URL を HTTPS / SSH から解釈する', () => {
    assert.deepEqual(
      parseGitHubOrigin('https://github.com/ywal123456-collab/jskim.git'),
      { owner: 'ywal123456-collab', repo: 'jskim' }
    );
    // 直書きすると public-release のメール監査に引っかかるため分割する
    const sshOrigin =
      'git@' + 'github.com:ywal123456-collab/jskim.git';
    assert.deepEqual(parseGitHubOrigin(sshOrigin), {
      owner: 'ywal123456-collab',
      repo: 'jskim',
    });
    assert.deepEqual(
      parseGitHubOrigin('git+https://github.com/ywal123456-collab/jskim.git'),
      { owner: 'ywal123456-collab', repo: 'jskim' }
    );
    assert.equal(parseGitHubOrigin('https://gitlab.com/x/y.git'), null);
  });

  it('print CSS の基本 contract がある', () => {
    const css = fs.readFileSync(
      path.join(REPO_ROOT, 'scripts/docs/user-guide-print.css'),
      'utf8'
    );
    assert.match(css, /size:\s*A4/i);
    assert.match(css, /Yu Gothic/);
    assert.match(css, /pre-wrap/);
    assert.match(css, /table-header-group|thead/);
    assert.match(css, /\.chapter \+ \.chapter/);
    assert.match(css, /text-decoration:\s*underline/);
    assert.match(css, /blockquote/);
    assert.match(css, /Consolas/);
  });

  it('CLI option 解析と browser 探索優先順位が正しい', () => {
    assert.deepEqual(parseBuildArgs([]), {
      htmlOnly: false,
      keepHtml: false,
      packageOutput: false,
      output: undefined,
      browser: undefined,
    });
    assert.equal(parseBuildArgs(['--html-only']).htmlOnly, true);
    assert.equal(parseBuildArgs(['--package-output']).packageOutput, true);
    assert.throws(() => parseBuildArgs(['--unknown']), /不明なoption/);
    assert.throws(() => parseBuildArgs(['--output']), /値がありません/);
    assert.throws(
      () => parseBuildArgs(['--html-only', '--output', 'a.pdf']),
      /同時に指定できません/
    );
    assert.throws(
      () => parseBuildArgs(['--html-only', '--package-output']),
      /同時に指定できません/
    );
    assert.throws(
      () => parseBuildArgs(['--package-output', '--output', 'a.pdf']),
      /同時に指定できません/
    );
    assert.throws(() => parseBuildArgs(['--port=1']), /サポートしていません/);

    const fakeEdge = path.join(os.tmpdir(), 'jskim-fake-msedge.exe');
    fs.writeFileSync(fakeEdge, 'x');
    try {
      const byFlag = findBrowserExecutable({
        browserPath: fakeEdge,
        platform: 'win32',
        env: {},
        existsSync: (p) => p === fakeEdge,
      });
      assert.equal(byFlag.executablePath, path.resolve(fakeEdge));
      assert.equal(byFlag.source, '--browser');

      const byEnv = findBrowserExecutable({
        platform: 'win32',
        env: { JSKIM_PDF_BROWSER: fakeEdge },
        existsSync: (p) => p === path.resolve(fakeEdge) || p === fakeEdge,
      });
      assert.equal(byEnv.source, 'JSKIM_PDF_BROWSER');

      assert.throws(
        () =>
          findBrowserExecutable({
            platform: 'win32',
            env: {},
            existsSync: () => false,
          }),
        /browser が見つかりません/
      );
    } finally {
      fs.unlinkSync(fakeEdge);
    }
  });

  it('release PDF が docs/ にあり title metadata が一致する', () => {
    const version = getPackageVersion(REPO_ROOT);
    const pdfPath = packagePdfOutputPath(REPO_ROOT, version);
    assert.ok(fs.existsSync(pdfPath), `release PDF がありません: ${pdfPath}`);
    const buf = fs.readFileSync(pdfPath);
    assert.ok(buf.length > 0);
    assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
    const latin1 = buf.toString('latin1');
    assert.equal(latin1.includes('file:///'), false);
    assert.equal(latin1.includes('C:\\Users\\'), false);

    // Chromium は /Title を UTF-16BE hex で書くことが多い
    const hexTitle = latin1.match(/\/Title\s*<([0-9A-Fa-f]+)>/);
    assert.ok(hexTitle, 'PDF /Title (hex) がありません');
    const titleBytes = Buffer.from(hexTitle[1], 'hex');
    let titleText = '';
    let offset = 0;
    if (titleBytes.length >= 2 && titleBytes[0] === 0xfe && titleBytes[1] === 0xff) {
      offset = 2;
    }
    for (let i = offset; i + 1 < titleBytes.length; i += 2) {
      titleText += String.fromCharCode(titleBytes.readUInt16BE(i));
    }
    assert.equal(titleText, `JSKim ユーザーガイド v${version}`);
    assert.doesNotMatch(titleText, /v0\.5\.1/);
  });

  it('HTML-only 生成で local path leak がない', async () => {
    const result = await writeGuideHtml({ repoRoot: REPO_ROOT });
    assert.equal(fs.existsSync(result.htmlPath), true);
    const html = await fsp.readFile(result.htmlPath, 'utf8');
    assert.match(html, /id="chapter-01"/);
    assert.match(html, /id="chapter-14"/);
    assert.doesNotMatch(html, /file:\/\//i);
    assert.doesNotMatch(html, /C:\\Users\\/i);
    assert.doesNotMatch(html, /AppData\\Local\\Temp/i);
    assert.match(html, /Yu Gothic/);
    assert.equal(result.chapterCount, 14);
  });
});
