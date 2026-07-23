'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * outputDir の relative path / type / content hash を収集する（test-only）。
 * @param {string} rootDir
 * @returns {Promise<Map<string, { type: string, hash: string|null }>>}
 */
async function collectOutputManifest(rootDir) {
  /** @type {Map<string, { type: string, hash: string|null }>} */
  const manifest = new Map();

  async function walk(absoluteDir, relativeDir) {
    let entries;
    try {
      entries = await fsp.readdir(absoluteDir, { withFileTypes: true });
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        return;
      }
      throw err;
    }

    for (const entry of entries) {
      const rel = relativeDir
        ? `${relativeDir}/${entry.name}`
        : entry.name;
      const abs = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        manifest.set(rel.replace(/\\/g, '/'), { type: 'dir', hash: null });
        // eslint-disable-next-line no-await-in-loop
        await walk(abs, rel);
      } else if (entry.isFile()) {
        // eslint-disable-next-line no-await-in-loop
        const buf = await fsp.readFile(abs);
        const hash = crypto.createHash('sha256').update(buf).digest('hex');
        manifest.set(rel.replace(/\\/g, '/'), { type: 'file', hash });
      }
    }
  }

  await walk(rootDir, '');
  return manifest;
}

/**
 * @param {Map<string, { type: string, hash: string|null }>} actual
 * @param {Map<string, { type: string, hash: string|null }>} expected
 */
function assertManifestEqual(actual, expected, label = 'output manifest') {
  const actualKeys = [...actual.keys()].sort();
  const expectedKeys = [...expected.keys()].sort();
  if (actualKeys.join('\0') !== expectedKeys.join('\0')) {
    const missing = expectedKeys.filter((k) => !actual.has(k));
    const extra = actualKeys.filter((k) => !expected.has(k));
    throw new Error(
      `${label}: path mismatch\nmissing: ${missing.join(', ') || '(none)'}\nextra: ${extra.join(', ') || '(none)'}`
    );
  }
  for (const key of expectedKeys) {
    const a = actual.get(key);
    const e = expected.get(key);
    if (!a || !e || a.type !== e.type || a.hash !== e.hash) {
      throw new Error(
        `${label}: entry mismatch at ${key}\nexpected: ${JSON.stringify(e)}\nactual: ${JSON.stringify(a)}`
      );
    }
  }
}

module.exports = {
  collectOutputManifest,
  assertManifestEqual,
};
