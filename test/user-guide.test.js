'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('./helpers/create-test-workspace');
const { isAllowedPublicEmail } = require('./helpers/public-email-policy');
const {
  USER_GUIDE_DIR,
  collectUserGuideMarkdownFiles,
} = require('./helpers/list-user-guide-docs');

const EXPECTED_CHAPTERS = [
  '01-introduction.md',
  '02-getting-started.md',
  '03-project-structure.md',
  '04-basic-workflow.md',
  '05-cli-reference.md',
  '06-configuration.md',
  '07-files-pipeline.md',
  '08-nunjucks.md',
  '09-development-features.md',
  '10-errors-and-troubleshooting.md',
  '11-dashboard-example.md',
  '12-crud-example.md',
  '13-wizard-example.md',
  '14-limitations.md',
];

const FUTURE_PLACEHOLDERS = [];

const EXPECTED_H1 = {
  'README.md': 'JSKim ユーザーガイド',
  '01-introduction.md': 'JSKimとは',
  '02-getting-started.md': 'はじめ方',
  '03-project-structure.md': 'プロジェクト構成',
  '04-basic-workflow.md': '基本的な開発workflow',
  '05-cli-reference.md': 'CLIリファレンス',
  '06-configuration.md': '設定',
  '07-files-pipeline.md': 'files pipeline',
  '08-nunjucks.md': 'Nunjucksの使い方',
  '09-development-features.md': '開発機能',
  '10-errors-and-troubleshooting.md': 'エラーとトラブルシュート',
  '11-dashboard-example.md': 'Dashboard例',
  '12-crud-example.md': 'CRUD例',
  '13-wizard-example.md': 'Wizard例',
  '14-limitations.md': '制限事項',
};

const KOREAN = /[가-힣]/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const MD_LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g;
const H1 = /^#\s+(.+)$/gm;

function guideRelPaths() {
  return collectUserGuideMarkdownFiles();
}

function readGuideRel(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function basenameOf(rel) {
  return rel.split('/').pop();
}

function stripCodeFences(text) {
  return text.replace(/```[\s\S]*?```/g, '');
}

function countFences(text) {
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.replace(/^>\s?/, '').trimStart();
    if (trimmed.startsWith('```')) {
      count += 1;
    }
  }
  return count;
}

function collectRelativeTargets(markdown, fromFileAbs) {
  const targets = [];
  const withoutCode = stripCodeFences(markdown);
  let match;
  MD_LINK.lastIndex = 0;
  while ((match = MD_LINK.exec(withoutCode)) !== null) {
    const target = match[2];
    if (
      target.startsWith('http://') ||
      target.startsWith('https://') ||
      target.startsWith('mailto:') ||
      target.startsWith('#')
    ) {
      continue;
    }
    const cleaned = target.split('#')[0];
    if (!cleaned) {
      continue;
    }
    targets.push({
      raw: target,
      abs: path.resolve(path.dirname(fromFileAbs), cleaned),
    });
  }
  return targets;
}

describe('user-guide', () => {
  it('docs/user-guide の Markdown が README + 01–14 の 15 件である', () => {
    const rels = guideRelPaths();
    assert.equal(rels.length, 15, `件数: ${rels.join(', ')}`);
    assert.deepEqual(
      rels,
      [
        'docs/user-guide/01-introduction.md',
        'docs/user-guide/02-getting-started.md',
        'docs/user-guide/03-project-structure.md',
        'docs/user-guide/04-basic-workflow.md',
        'docs/user-guide/05-cli-reference.md',
        'docs/user-guide/06-configuration.md',
        'docs/user-guide/07-files-pipeline.md',
        'docs/user-guide/08-nunjucks.md',
        'docs/user-guide/09-development-features.md',
        'docs/user-guide/10-errors-and-troubleshooting.md',
        'docs/user-guide/11-dashboard-example.md',
        'docs/user-guide/12-crud-example.md',
        'docs/user-guide/13-wizard-example.md',
        'docs/user-guide/14-limitations.md',
        'docs/user-guide/README.md',
      ]
    );
  });

  it('docs/user-guide の必須ファイルが存在する', () => {
    assert.equal(fs.existsSync(USER_GUIDE_DIR), true, 'docs/user-guide がありません');
    assert.equal(
      fs.existsSync(path.join(USER_GUIDE_DIR, 'README.md')),
      true,
      'README.md がありません'
    );
    for (const name of EXPECTED_CHAPTERS) {
      assert.equal(
        fs.existsSync(path.join(USER_GUIDE_DIR, name)),
        true,
        `${name} がありません`
      );
    }
  });

  it('未作成 chapter の placeholder ファイルを置いていない', () => {
    const found = FUTURE_PLACEHOLDERS.filter((name) =>
      fs.existsSync(path.join(USER_GUIDE_DIR, name))
    );
    assert.deepEqual(found, [], `placeholder があります: ${found.join(', ')}`);
  });

  it('各 Markdown の H1 は 1 つで、章タイトルと一致する', () => {
    for (const rel of guideRelPaths()) {
      const name = basenameOf(rel);
      const text = readGuideRel(rel);
      const matches = [...text.matchAll(H1)];
      assert.equal(
        matches.length,
        1,
        `${name} の H1 数は ${matches.length} です`
      );
      const expected = EXPECTED_H1[name];
      if (expected) {
        assert.equal(
          matches[0][1].trim(),
          expected,
          `${name} の H1 が期待と違います`
        );
      }
    }
  });

  it('README の章リンク先が存在する', () => {
    const readmePath = path.join(USER_GUIDE_DIR, 'README.md');
    const text = readGuideRel('docs/user-guide/README.md');
    const targets = collectRelativeTargets(text, readmePath);
    const missing = targets
      .filter((t) => !fs.existsSync(t.abs))
      .map((t) => t.raw);
    assert.deepEqual(missing, [], `壊れたリンク: ${missing.join(', ')}`);

    for (const name of EXPECTED_CHAPTERS) {
      assert.match(
        text,
        new RegExp(`\\]\\(${name.replace('.', '\\.')}\\)`),
        `README に ${name} へのリンクがありません`
      );
    }
  });

  it('user-guide 内の相対リンク先が存在する', () => {
    const missing = [];
    for (const rel of guideRelPaths()) {
      const filePath = path.join(REPO_ROOT, rel);
      const targets = collectRelativeTargets(readGuideRel(rel), filePath);
      for (const t of targets) {
        if (!fs.existsSync(t.abs)) {
          missing.push(`${rel}: ${t.raw}`);
        }
      }
    }
    assert.deepEqual(missing, [], `壊れたリンク: ${missing.join(', ')}`);
  });

  it('韓国語の説明文と許可外 email を含まない', () => {
    const koreanHits = [];
    const emailHits = [];
    for (const rel of guideRelPaths()) {
      const text = readGuideRel(rel);
      if (KOREAN.test(text)) {
        koreanHits.push(rel);
      }
      const emails = text.match(EMAIL) || [];
      for (const email of emails) {
        if (!isAllowedPublicEmail(email)) {
          emailHits.push(`${rel}: ${email}`);
        }
      }
    }
    assert.deepEqual(koreanHits, [], `韓国語: ${koreanHits.join(', ')}`);
    assert.deepEqual(emailHits, [], `許可外 email: ${emailHits.join(', ')}`);
  });

  it('code fence が閉じている', () => {
    const odd = [];
    for (const rel of guideRelPaths()) {
      const count = countFences(readGuideRel(rel));
      if (count % 2 !== 0) {
        odd.push(`${rel} (${count})`);
      }
    }
    assert.deepEqual(odd, [], `閉じられていない fence: ${odd.join(', ')}`);
  });

  it('README の対象 version 表記がある', () => {
    const text = readGuideRel('docs/user-guide/README.md');
    assert.match(text, /v0\.5\.2/);
  });

  it('CLI / config の基本 contract が文書とずれていない', () => {
    const cli = readGuideRel('docs/user-guide/05-cli-reference.md');
    const workflow = readGuideRel('docs/user-guide/04-basic-workflow.md');
    const config = readGuideRel('docs/user-guide/06-configuration.md');
    const pipeline = readGuideRel('docs/user-guide/07-files-pipeline.md');
    const combined = `${cli}\n${workflow}\n${config}\n${pipeline}`;

    for (const command of ['build', 'watch', 'serve', 'dev']) {
      assert.match(
        combined,
        new RegExp(`\\bjskim ${command}\\b|\\\`${command}\\\``),
        `command ${command} の説明がありません`
      );
    }

    assert.doesNotMatch(
      combined,
      /jskim serve[^\n]*--open/,
      'jskim serve で --open を使う例を案内してはいけません'
    );
    assert.doesNotMatch(
      combined,
      /```(?:bash|shell)?\r?\n[^\n]*\bserve\b[^\n]*--open/,
      'serve のコマンド例に --open を含めてはいけません'
    );
    assert.match(cli, /--all/);
    assert.match(cli, /--host/);
    assert.match(cli, /--port/);
    assert.match(cli, /--open/);

    for (const key of [
      'sourceDir',
      'outputDir',
      'files',
      'templates',
      'data',
      'build.clean',
      'watch.debounce',
      'serve.host',
      'serve.port',
      'dev.liveReload',
    ]) {
      assert.match(
        config,
        new RegExp(key.replace('.', '\\.')),
        `設定 key ${key} がありません`
      );
    }

    assert.match(pipeline, /rootPath/);
    assert.match(pipeline, /`\.\/`/);
    assert.equal(
      fs.existsSync(path.join(REPO_ROOT, 'src/sample/pages/index.html.njk')),
      true
    );
  });

  it('08–10 の開発・Nunjucks・エラー contract がずれていない', () => {
    const nunjucks = readGuideRel('docs/user-guide/08-nunjucks.md');
    const features = readGuideRel('docs/user-guide/09-development-features.md');
    const errors = readGuideRel('docs/user-guide/10-errors-and-troubleshooting.md');

    assert.match(
      nunjucks,
      /rootPath[\s\S]{0,120}Nunjucks 固有|Nunjucks 固有[\s\S]{0,80}rootPath/
    );
    assert.match(nunjucks, /macro/);
    assert.match(nunjucks, /扱わない|範囲外/);

    assert.doesNotMatch(features, /jskim serve[^\n]*--open/);
    assert.match(features, /CSS soft reload/);
    assert.match(features, /Full reload|full reload|全体を再読み込み/);
    assert.match(features, /Shadow DOM/);
    assert.match(features, /outputDir/);
    assert.match(features, /serve\.host|serve\.port|dev\.liveReload/);

    assert.match(errors, /build --all/);
    assert.match(errors, /exit code.*`?1`?|exit `1`/);
    assert.match(errors, /browser open|Browser open|--open/);
    assert.match(errors, /warning/);
    assert.doesNotMatch(
      errors,
      /browser open[\s\S]{0,80}終了（失敗）|--open[\s\S]{0,40}exit `1`/
    );
    assert.match(errors, /assets\/css\/crud\.css/);
    assert.match(errors, /EADDRINUSE|すでに使用されています/);
  });

  it('11–14 の sample / 制限事項 contract がずれていない', () => {
    const dashboard = readGuideRel('docs/user-guide/11-dashboard-example.md');
    const crud = readGuideRel('docs/user-guide/12-crud-example.md');
    const wizard = readGuideRel('docs/user-guide/13-wizard-example.md');
    const limits = readGuideRel('docs/user-guide/14-limitations.md');
    const readme = readGuideRel('docs/user-guide/README.md');

    assert.match(
      dashboard,
      /src\/sample\/pages\/dashboard\/index\.html\.njk/
    );
    assert.match(dashboard, /summaryCards|summary card/);

    for (const name of [
      'index.html.njk',
      'detail.html.njk',
      'create.html.njk',
      'edit.html.njk',
      'delete.html.njk',
      'complete.html.njk',
    ]) {
      assert.match(crud, new RegExp(name.replace('.', '\\.')));
    }
    assert.match(crud, /静的 UI sample|実際の登録|実際の CRUD/);
    assert.doesNotMatch(
      crud,
      /JSKim が実際の CRUD 機能を提供|実際に商品を登録・更新・削除できます/
    );

    assert.match(wizard, /wizard-steps\.njk/);
    assert.match(wizard, /aria-current="step"|aria-current=.step/);
    assert.match(wizard, /引き継が|固定値|送信処理は行いません|送信・保存はない/);
    assert.doesNotMatch(
      wizard,
      /入力内容を自動で次の画面へ渡します|実際に送信します/
    );

    assert.match(limits, /HTML[\s\S]{0,40}migration|自動 import|自動取り込み|migration/);
    assert.match(limits, /API|database|Backend|backend/);
    assert.match(limits, /bundler|Bundler/);
    assert.match(limits, /build --all|--all/);
    assert.match(limits, /watch[\s\S]{0,40}非対応|serve[\s\S]{0,40}非対応|dev[\s\S]{0,40}非対応/);
    assert.match(limits, /serve --open|serve` に `--open|serve.*--open.*非対応/);
    assert.match(limits, /JavaScript file|`.js`/);
    assert.doesNotMatch(
      limits,
      /JavaScript file[\s\S]{0,40}コピーできない|JS ファイルは扱えない/
    );

    for (const name of EXPECTED_CHAPTERS) {
      assert.match(readme, new RegExp(`\\]\\(${name.replace('.', '\\.')}\\)`));
    }
  });

  it('一時的な作業メモや未完成表記を含まない', () => {
    const forbidden = [
      /\bTODO\b/,
      /\bTBD\b/,
      /準備中/,
      /後で追加/,
      /今後作成/,
      /Stage 4[ABCD]/,
      /\bCursor\b/,
      /\bChatGPT\b/,
    ];
    const hits = [];
    for (const rel of guideRelPaths()) {
      const text = readGuideRel(rel);
      for (const pattern of forbidden) {
        if (pattern.test(text)) {
          hits.push(`${rel}: ${pattern}`);
        }
      }
    }
    assert.deepEqual(hits, [], `一時表記: ${hits.join(', ')}`);
  });
});
