#!/usr/bin/env node
'use strict';

const {
  parseBuildArgs,
  writeGuideHtml,
  writeGuidePdf,
  resolvePdfOutputPath,
  getRepoRoot,
  getPackageVersion,
} = require('./user-guide-pdf-lib');

async function main(argv = process.argv.slice(2)) {
  const options = parseBuildArgs(argv);
  const repoRoot = getRepoRoot();
  const packageVersion = getPackageVersion(repoRoot);

  if (options.htmlOnly) {
    const result = await writeGuideHtml({ repoRoot });
    console.log('ユーザーガイド HTML を生成しました。');
    console.log(`HTML: ${result.htmlPath}`);
    console.log(`chapter 数: ${result.chapterCount}`);
    return;
  }

  const outputPath = resolvePdfOutputPath(repoRoot, packageVersion, options);
  const result = await writeGuidePdf({
    repoRoot,
    browserPath: options.browser,
    outputPath,
  });

  console.log('ユーザーガイドPDFを生成しました。');
  console.log(`browser: ${result.browserPath}`);
  console.log(`HTML: ${result.htmlPath}`);
  console.log(`PDF: ${result.pdfPath}`);
  console.log(`PDF size: ${result.pdfSize} bytes`);
  console.log(`chapter 数: ${result.chapterCount}`);
}

if (require.main === module) {
  main().catch((err) => {
    const message = err && err.message ? err.message : String(err);
    console.error(message);
    process.exitCode = 1;
  });
}

module.exports = { main };
