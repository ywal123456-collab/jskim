'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const MarkdownIt = require('markdown-it');

const CHAPTER_SPECS = [
  { id: '01', file: '01-introduction.md', title: 'JSKimとは' },
  { id: '02', file: '02-getting-started.md', title: 'はじめ方' },
  { id: '03', file: '03-project-structure.md', title: 'プロジェクト構成' },
  { id: '04', file: '04-basic-workflow.md', title: '基本的な開発workflow' },
  { id: '05', file: '05-cli-reference.md', title: 'CLIリファレンス' },
  { id: '06', file: '06-configuration.md', title: '設定' },
  { id: '07', file: '07-files-pipeline.md', title: 'files pipeline' },
  { id: '08', file: '08-nunjucks.md', title: 'Nunjucksの使い方' },
  { id: '09', file: '09-development-features.md', title: '開発機能' },
  {
    id: '10',
    file: '10-errors-and-troubleshooting.md',
    title: 'エラーとトラブルシュート',
  },
  { id: '11', file: '11-dashboard-example.md', title: 'Dashboard例' },
  { id: '12', file: '12-crud-example.md', title: 'CRUD例' },
  { id: '13', file: '13-wizard-example.md', title: 'Wizard例' },
  { id: '14', file: '14-limitations.md', title: '制限事項' },
];

const COVER_SECTIONS = [
  { heading: 'このガイドについて', title: 'このガイドについて' },
  { heading: '読み方', title: '読み方' },
];

const WINDOWS_BROWSER_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const MAC_BROWSER_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

const LINUX_BROWSER_NAMES = [
  'microsoft-edge',
  'microsoft-edge-stable',
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
];

function createMarkdownIt() {
  return new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
  }).enable('table');
}

function getRepoRoot() {
  return path.resolve(__dirname, '..', '..');
}

function getUserGuideDir(repoRoot = getRepoRoot()) {
  return path.join(repoRoot, 'docs', 'user-guide');
}

function getPackageVersion(repoRoot = getRepoRoot()) {
  const pkg = require(path.join(repoRoot, 'package.json'));
  return String(pkg.version);
}

function extractTargetVersionFromReadme(readmeText) {
  const match = String(readmeText).match(/対象 version は \*\*v(\d+\.\d+\.\d+)\*\*/);
  if (!match) {
    throw new Error(
      '[JSKim] ユーザーガイド README から対象 version を読み取れません。\n' +
        '「対象 version は **vX.Y.Z** です。」形式で記載してください。'
    );
  }
  return match[1];
}

function assertGuideVersionMatchesPackage(readmeText, packageVersion) {
  const guideVersion = extractTargetVersionFromReadme(readmeText);
  if (guideVersion !== packageVersion) {
    throw new Error(
      '[JSKim] ユーザーガイドの対象 version と package.json の version が一致しません。\n' +
        `README: v${guideVersion}\n` +
        `package.json: ${packageVersion}`
    );
  }
}

function extractMarkdownSection(markdown, heading) {
  const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
  const target = `## ${heading}`;
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === target) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) {
    throw new Error(
      `[JSKim] README に H2「${heading}」が見つかりません。`
    );
  }

  let end = lines.length;
  for (let i = start; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const body = lines.slice(start, end).join('\n').trim();
  if (!body) {
    throw new Error(
      `[JSKim] README の H2「${heading}」が空です。`
    );
  }
  return body;
}

function stripMarkdownLinksToText(markdown) {
  return String(markdown).replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_full, label) => label
  );
}

function loadGuideSources(repoRoot = getRepoRoot()) {
  const guideDir = getUserGuideDir(repoRoot);
  const readmePath = path.join(guideDir, 'README.md');
  if (!fs.existsSync(readmePath)) {
    throw new Error(`[JSKim] README.md が見つかりません: ${readmePath}`);
  }

  const readmeText = fs.readFileSync(readmePath, 'utf8');
  const packageVersion = getPackageVersion(repoRoot);
  assertGuideVersionMatchesPackage(readmeText, packageVersion);

  const chapters = CHAPTER_SPECS.map((spec) => {
    const filePath = path.join(guideDir, spec.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`[JSKim] chapter が見つかりません: ${spec.file}`);
    }
    const text = fs.readFileSync(filePath, 'utf8');
    const h1Match = text.match(/^#\s+(.+)$/m);
    if (!h1Match) {
      throw new Error(`[JSKim] ${spec.file} に H1 がありません。`);
    }
    const h1 = h1Match[1].trim();
    if (h1 !== spec.title) {
      throw new Error(
        `[JSKim] ${spec.file} の H1 が期待と違います。\n` +
          `期待: ${spec.title}\n` +
          `実際: ${h1}`
      );
    }
    return {
      ...spec,
      absolutePath: filePath,
      text,
      h1,
    };
  });

  return {
    repoRoot,
    guideDir,
    packageVersion,
    readmeText,
    chapters,
  };
}

function parseGitHubOrigin(remoteUrl) {
  if (remoteUrl == null) {
    return null;
  }
  let url = String(remoteUrl).trim();
  if (!url) {
    return null;
  }
  if (url.startsWith('git+')) {
    url = url.slice(4);
  }
  if (url.endsWith('.git')) {
    url = url.slice(0, -4);
  }

  let match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/)?$/i);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }

  match = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\/)?$/i);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }

  match = url.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\/)?$/i);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }

  return null;
}

function runGit(repoRoot, args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  return String(result.stdout || '').trim();
}

function resolveGitHubContext(repoRoot = getRepoRoot()) {
  const remote =
    runGit(repoRoot, ['remote', 'get-url', 'origin']) ||
    (() => {
      try {
        const pkg = require(path.join(repoRoot, 'package.json'));
        return pkg.repository && pkg.repository.url
          ? String(pkg.repository.url)
          : null;
      } catch {
        return null;
      }
    })();
  const headSha = runGit(repoRoot, ['rev-parse', 'HEAD']);
  const github = parseGitHubOrigin(remote);
  if (!github || !headSha) {
    return { github: null, headSha: headSha || null, remote };
  }
  return {
    github,
    headSha,
    remote,
    baseUrl: `https://github.com/${github.owner}/${github.repo}`,
  };
}

function toPosix(relPath) {
  return String(relPath).split(path.sep).join('/');
}

function rewriteHref(rawHref, context) {
  const href = String(rawHref || '').trim();
  if (!href) {
    return { kind: 'plain', text: '' };
  }
  if (/^(https?:|mailto:)/i.test(href)) {
    return { kind: 'external', href };
  }
  if (/^file:/i.test(href) || path.isAbsolute(href)) {
    return { kind: 'plain', text: href };
  }
  if (href.startsWith('#')) {
    return { kind: 'external', href };
  }

  const [pathPart, fragment] = href.split('#');
  const fragmentSuffix = fragment ? `#${fragment}` : '';
  const normalized = (pathPart || '').replace(/\\/g, '/');
  const basename = path.posix.basename(normalized);
  const chapterFile = CHAPTER_SPECS.find((c) => c.file === basename);
  if (chapterFile) {
    return { kind: 'chapter', href: `#chapter-${chapterFile.id}` };
  }

  const fromDir = path.dirname(context.fromFile);
  const resolvedAbs = path.resolve(fromDir, pathPart || '.');
  const relToRepo = path.relative(context.repoRoot, resolvedAbs);
  if (
    !relToRepo ||
    relToRepo.startsWith('..') ||
    path.isAbsolute(relToRepo)
  ) {
    return { kind: 'plain', text: href };
  }
  const repoPath = toPosix(relToRepo);
  let isDir = false;
  try {
    isDir = fs.existsSync(resolvedAbs) && fs.statSync(resolvedAbs).isDirectory();
  } catch {
    isDir = false;
  }

  if (context.github && context.headSha) {
    const kind = isDir ? 'tree' : 'blob';
    return {
      kind: 'github',
      href: `${context.baseUrl}/${kind}/${context.headSha}/${repoPath}${fragmentSuffix}`,
      repoPath,
    };
  }

  return { kind: 'plain', text: repoPath + fragmentSuffix };
}

function rewriteMarkdownLinks(markdown, context) {
  return String(markdown).replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_full, label, href) => {
      const rewritten = rewriteHref(href, context);
      if (rewritten.kind === 'plain') {
        return `\`${rewritten.text || label}\``;
      }
      return `[${label}](${rewritten.href})`;
    }
  );
}

function renderMarkdown(markdown, md = createMarkdownIt()) {
  return md.render(String(markdown));
}

/**
 * Cover 用に長すぎる section を短縮する。
 * 「読み方」は最初の H3（初めて使う場合）までだけを使う。
 */
function trimCoverSectionBody(heading, body) {
  if (heading !== '読み方') {
    return body;
  }
  const lines = String(body).replace(/\r\n/g, '\n').split('\n');
  let firstH3 = -1;
  let secondH3 = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^###\s+/.test(lines[i])) {
      continue;
    }
    if (firstH3 < 0) {
      firstH3 = i;
      continue;
    }
    secondH3 = i;
    break;
  }
  if (firstH3 < 0) {
    return body;
  }
  const end = secondH3 < 0 ? lines.length : secondH3;
  return lines.slice(0, end).join('\n').trim();
}

function buildCoverHtml(readmeText, packageVersion, md) {
  const sections = COVER_SECTIONS.map((spec) => {
    const rawBody = extractMarkdownSection(readmeText, spec.heading);
    const body = trimCoverSectionBody(spec.heading, rawBody);
    const plainLinked = stripMarkdownLinksToText(body);
    const html = renderMarkdown(plainLinked, md);
    return `<section class="cover-section"><h2>${escapeHtml(
      spec.title
    )}</h2>${html}</section>`;
  }).join('\n');

  return `<section class="cover">
  <h1>JSKim ユーザーガイド</h1>
  <p class="version">v${escapeHtml(packageVersion)}</p>
  <p class="doc-kind">一般公開ドキュメント</p>
  ${sections}
</section>`;
}

function buildTocHtml(chapters) {
  const items = chapters
    .map(
      (chapter) =>
        `<li><a href="#chapter-${chapter.id}"><span class="toc-num">${escapeHtml(
          chapter.id
        )}.</span> ${escapeHtml(chapter.title)}</a></li>`
    )
    .join('\n');
  return `<nav class="toc" aria-label="目次">
  <h1>目次</h1>
  <ol>
${items}
  </ol>
</nav>`;
}

function buildChapterHtml(chapter, context, md) {
  const rewritten = rewriteMarkdownLinks(chapter.text, {
    ...context,
    fromFile: chapter.absolutePath,
  });
  const html = renderMarkdown(rewritten, md);
  return `<section id="chapter-${chapter.id}" class="chapter">
${html}
</section>`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildDocumentHtml(options) {
  const repoRoot = options.repoRoot || getRepoRoot();
  const sources = options.sources || loadGuideSources(repoRoot);
  const githubContext = options.githubContext || resolveGitHubContext(repoRoot);
  const md = options.md || createMarkdownIt();
  const cssPath =
    options.cssPath || path.join(__dirname, 'user-guide-print.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  const linkContext = {
    repoRoot,
    github: githubContext.github,
    headSha: githubContext.headSha,
    baseUrl: githubContext.baseUrl,
  };

  const cover = buildCoverHtml(sources.readmeText, sources.packageVersion, md);
  const toc = buildTocHtml(sources.chapters);
  const chaptersHtml = sources.chapters
    .map((chapter) => buildChapterHtml(chapter, linkContext, md))
    .join('\n');

  const title = `JSKim ユーザーガイド v${sources.packageVersion}`;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
${css}
  </style>
</head>
<body>
${cover}
${toc}
${chaptersHtml}
</body>
</html>
`;
}

function whichSync(command) {
  const isWin = process.platform === 'win32';
  const result = spawnSync(isWin ? 'where' : 'which', [command], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    return [];
  }
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function findBrowserExecutable(options = {}) {
  const exists =
    options.existsSync || ((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const tried = [];

  function consider(candidate, source) {
    if (!candidate) {
      return null;
    }
    const resolved = path.resolve(candidate);
    tried.push(`${source}: ${resolved}`);
    if (exists(resolved)) {
      return { executablePath: resolved, source, tried };
    }
    return null;
  }

  if (options.browserPath) {
    const hit = consider(options.browserPath, '--browser');
    if (hit) {
      return hit;
    }
    throw new Error(
      `[JSKim] --browser で指定された実行ファイルが見つかりません。\n` +
        `パス: ${options.browserPath}`
    );
  }

  if (env.JSKIM_PDF_BROWSER) {
    const hit = consider(env.JSKIM_PDF_BROWSER, 'JSKIM_PDF_BROWSER');
    if (hit) {
      return hit;
    }
    throw new Error(
      `[JSKim] 環境変数 JSKIM_PDF_BROWSER の実行ファイルが見つかりません。\n` +
        `パス: ${env.JSKIM_PDF_BROWSER}`
    );
  }

  const candidates = [];
  if (platform === 'win32') {
    candidates.push(
      ...WINDOWS_BROWSER_CANDIDATES.map((p) => ({ path: p, source: 'windows' }))
    );
  } else if (platform === 'darwin') {
    candidates.push(
      ...MAC_BROWSER_CANDIDATES.map((p) => ({ path: p, source: 'macos' }))
    );
  } else {
    for (const name of LINUX_BROWSER_NAMES) {
      for (const found of whichSync(name)) {
        candidates.push({ path: found, source: `path:${name}` });
      }
    }
  }

  for (const item of candidates) {
    const hit = consider(item.path, item.source);
    if (hit) {
      return hit;
    }
  }

  throw new Error(
    '[JSKim] PDF 生成用の Chromium 系 browser が見つかりません。\n' +
      'Microsoft Edge または Google Chrome をインストールするか、\n' +
      '--browser <path> または環境変数 JSKIM_PDF_BROWSER を指定してください。\n' +
      '探索した候補:\n' +
      tried.map((line) => `- ${line}`).join('\n')
  );
}

function parseBuildArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const options = {
    htmlOnly: false,
    keepHtml: false,
    output: undefined,
    browser: undefined,
  };
  const seen = new Set();

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--') {
      throw new Error('[JSKim] サポートされていない引数です: --');
    }
    if (!token.startsWith('-')) {
      throw new Error(`[JSKim] 不明な引数です: ${token}`);
    }
    if (token.includes('=')) {
      throw new Error(
        `[JSKim] この書き方のoptionはサポートしていません: ${token}\n` +
          '例: --output path（= は使えません）'
      );
    }

    const takeValue = () => {
      const value = args[i + 1];
      if (value == null || value.startsWith('-')) {
        throw new Error(`[JSKim] option ${token} の値がありません。`);
      }
      i += 1;
      return value;
    };

    if (seen.has(token)) {
      throw new Error(`[JSKim] optionが重複しています: ${token}`);
    }

    if (token === '--html-only') {
      seen.add(token);
      options.htmlOnly = true;
      continue;
    }
    if (token === '--keep-html') {
      seen.add(token);
      options.keepHtml = true;
      continue;
    }
    if (token === '--output') {
      seen.add(token);
      options.output = takeValue();
      continue;
    }
    if (token === '--browser') {
      seen.add(token);
      options.browser = takeValue();
      continue;
    }

    throw new Error(
      `[JSKim] 不明なoptionです: ${token}\n` +
        '使えるoption: --html-only, --keep-html, --output <path>, --browser <path>'
    );
  }

  if (options.htmlOnly && options.output) {
    throw new Error(
      '[JSKim] --html-only と --output は同時に指定できません。\n' +
        '--output は PDF 出力先専用です。HTML は OS の一時ディレクトリに生成されます。'
    );
  }

  return options;
}

function defaultPdfOutputPath(repoRoot, packageVersion) {
  return path.join(
    repoRoot,
    'dist',
    'docs',
    `JSKim_User_Guide_v${packageVersion}.pdf`
  );
}

function createTempHtmlPath(packageVersion) {
  const dir = path.join(os.tmpdir(), 'jskim-user-guide-pdf');
  fs.mkdirSync(dir, { recursive: true });
  return {
    dir,
    htmlPath: path.join(dir, `JSKim_User_Guide_v${packageVersion}.html`),
  };
}

function assertNoLocalPathLeak(text, label) {
  const patterns = [
    { re: /file:\/\//i, name: 'file://' },
    { re: /AppData\\Local\\Temp/i, name: 'AppData\\Local\\Temp' },
  ];
  // HTML は絶対パス混入を厳しく見る。PDF binary は誤検出を避ける。
  if (!/\.pdf$/i.test(label) && !/生成 PDF/.test(label)) {
    patterns.push({ re: /C:\\Users\\/i, name: 'C:\\Users\\' });
  }
  for (const pattern of patterns) {
    if (pattern.re.test(text)) {
      throw new Error(
        `[JSKim] ${label} に local path が混入しています: ${pattern.name}`
      );
    }
  }
}

async function writeGuideHtml(options = {}) {
  const repoRoot = options.repoRoot || getRepoRoot();
  const sources = options.sources || loadGuideSources(repoRoot);
  const html = buildDocumentHtml({
    repoRoot,
    sources,
    githubContext: options.githubContext,
  });
  assertNoLocalPathLeak(html, '生成 HTML');

  const temp = createTempHtmlPath(sources.packageVersion);
  await fsp.writeFile(temp.htmlPath, html, 'utf8');
  return {
    html,
    htmlPath: temp.htmlPath,
    tempDir: temp.dir,
    packageVersion: sources.packageVersion,
    chapterCount: sources.chapters.length,
    sources,
  };
}

async function writeGuidePdf(options = {}) {
  const repoRoot = options.repoRoot || getRepoRoot();
  const htmlResult = await writeGuideHtml(options);
  const browserInfo = findBrowserExecutable({
    browserPath: options.browserPath,
    env: options.env,
    platform: options.platform,
  });

  const outputPath =
    options.outputPath ||
    defaultPdfOutputPath(repoRoot, htmlResult.packageVersion);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });

  const { chromium } = require('playwright-core');
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: browserInfo.executablePath,
      headless: true,
    });
    const page = await browser.newPage();
    await page.emulateMedia({ media: 'print' });
    await page.setContent(htmlResult.html, { waitUntil: 'load' });
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
    });

    const footerTemplate = `<div style="width:100%;font-size:8px;padding:0 12mm;color:#444;font-family:'Yu Gothic',YuGothic,Meiryo,sans-serif;box-sizing:border-box;">
  <span>JSKim ユーザーガイド v${htmlResult.packageVersion}</span>
  <span style="float:right;"><span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;

    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate,
      margin: {
        top: '16mm',
        right: '15mm',
        bottom: '19mm',
        left: '15mm',
      },
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  const stat = await fsp.stat(outputPath);
  if (stat.size <= 0) {
    throw new Error(`[JSKim] PDF が空です: ${outputPath}`);
  }
  const pdfBytes = await fsp.readFile(outputPath);
  if (!pdfBytes.toString('utf8', 0, 5).startsWith('%PDF-')) {
    throw new Error(`[JSKim] PDF header が不正です: ${outputPath}`);
  }
  const pdfText = pdfBytes.toString('latin1');
  assertNoLocalPathLeak(pdfText, '生成 PDF');

  return {
    ...htmlResult,
    pdfPath: outputPath,
    pdfSize: stat.size,
    browserPath: browserInfo.executablePath,
    browserSource: browserInfo.source,
  };
}

module.exports = {
  CHAPTER_SPECS,
  COVER_SECTIONS,
  WINDOWS_BROWSER_CANDIDATES,
  createMarkdownIt,
  getRepoRoot,
  getUserGuideDir,
  getPackageVersion,
  extractTargetVersionFromReadme,
  assertGuideVersionMatchesPackage,
  extractMarkdownSection,
  stripMarkdownLinksToText,
  trimCoverSectionBody,
  loadGuideSources,
  parseGitHubOrigin,
  resolveGitHubContext,
  rewriteHref,
  rewriteMarkdownLinks,
  renderMarkdown,
  buildCoverHtml,
  buildTocHtml,
  buildChapterHtml,
  buildDocumentHtml,
  findBrowserExecutable,
  parseBuildArgs,
  defaultPdfOutputPath,
  createTempHtmlPath,
  assertNoLocalPathLeak,
  writeGuideHtml,
  writeGuidePdf,
};
