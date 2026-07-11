'use strict';

/**
 * 条件が真になるまで待ちます。
 * @param {() => boolean|Promise<boolean>} predicate
 * @param {object} [options]
 * @param {number} [options.timeoutMs=15000]
 * @param {number} [options.intervalMs=50]
 * @param {string} [options.label='condition']
 */
async function waitFor(predicate, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15000;
  const intervalMs = options.intervalMs ?? 50;
  const label = options.label || 'condition';
  const start = Date.now();

  while (Date.now() - start <= timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    if (await predicate()) {
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(intervalMs);
  }

  throw new Error(`待機タイムアウト: ${label}`);
}

/**
 * 出力文字列に部分文字列が現れるまで待ちます。
 */
async function waitForOutput(getOutput, substring, options = {}) {
  await waitFor(() => String(getOutput()).includes(substring), {
    ...options,
    label: options.label || `output includes ${substring}`,
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

module.exports = {
  waitFor,
  waitForOutput,
  sleep,
};
