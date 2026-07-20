'use strict';

/**
 * Screen Spec version CLI の exit code / JSON エラー投影。
 *
 * exit:
 *   0 success
 *   1 一般 operation / runtime
 *   2 usage / argument
 *   3 conflict / dirty / recovery-required
 */

const EXIT_SUCCESS = 0;
const EXIT_RUNTIME = 1;
const EXIT_USAGE = 2;
const EXIT_CONFLICT = 3;

/** @type {ReadonlySet<string>} */
const CONFLICT_CODES = new Set([
  'SPEC_VERSION_WORKING_TREE_DIRTY',
  'SPEC_VERSION_RECOVERY_REQUIRED',
  'SPEC_VERSION_RECOVERY_UNSAFE',
  'SPEC_VERSION_REVERT_CONFLICT',
  'SPEC_VERSION_INDEX_CONFLICT',
  'SPEC_VERSION_HEAD_CHANGED',
  'SPEC_VERSION_REF_CONFLICT',
  'SPEC_VERSION_REPOSITORY_IN_PROGRESS',
  'SPEC_VERSION_INDEX_IN_PROGRESS',
  'SPEC_VERSION_NOTHING_TO_COMMIT',
  'SPEC_VERSION_MERGE_CONFLICT',
  'SPEC_VERSION_MERGE_UNRESOLVED',
  'SPEC_VERSION_MERGE_BASE_NOT_FOUND',
  'SPEC_VERSION_MERGE_BASE_AMBIGUOUS',
  'SPEC_VERSION_MERGE_DETACHED_HEAD',
  'SPEC_VERSION_MERGE_UNBORN_HEAD',
  'SPEC_VERSION_MERGE_HEAD_CHANGED',
  'SPEC_VERSION_MERGE_ABORT_UNSAFE',
  'SPEC_VERSION_MERGE_IN_PROGRESS',
  'SPEC_VERSION_MERGE_NOT_IN_PROGRESS',
]);

/**
 * @param {unknown} err
 * @returns {number}
 */
function mapVersionCliExitCode(err) {
  if (err && typeof err === 'object') {
    if (
      'exitCode' in err &&
      typeof err.exitCode === 'number' &&
      Number.isInteger(err.exitCode)
    ) {
      return err.exitCode;
    }
    const code = 'code' in err ? String(err.code) : '';
    if (code === 'JSKIM_USAGE_ERROR') return EXIT_USAGE;
    if (CONFLICT_CODES.has(code)) return EXIT_CONFLICT;
  }
  return EXIT_RUNTIME;
}

/**
 * @param {unknown} err
 * @returns {{ code: string, message: string }}
 */
function projectVersionCliError(err) {
  const message =
    err && typeof err === 'object' && 'message' in err && err.message
      ? String(err.message)
      : String(err);
  const code =
    err && typeof err === 'object' && 'code' in err && err.code
      ? String(err.code)
      : 'JSKIM_VERSION_CLI_ERROR';

  // 絶対 path・stack を落とす（message 内の Windows/POSIX path を伏せる）
  const sanitized = message
    .replace(/[A-Za-z]:\\[^\s]+/g, '<path>')
    .replace(/\/(?:Users|home|tmp|var|private)\/[^\s]+/g, '<path>')
    .replace(/\n\s*at\s+[\s\S]*/g, '');

  return { code, message: sanitized };
}

/**
 * @param {object} payload
 * @param {string} payload.command
 * @param {string} [payload.project]
 * @param {unknown} [payload.result]
 * @param {{ code: string, message: string }} [payload.error]
 * @param {string[]} [payload.warnings]
 */
function writeVersionJson(payload) {
  const body = {
    ok: !payload.error,
    command: payload.command,
    project: payload.project ?? null,
  };
  if (payload.error) {
    body.error = payload.error;
  } else {
    body.result = payload.result ?? null;
  }
  if (payload.warnings && payload.warnings.length > 0) {
    body.warnings = payload.warnings;
  }
  process.stdout.write(`${JSON.stringify(body)}\n`);
}

module.exports = {
  EXIT_SUCCESS,
  EXIT_RUNTIME,
  EXIT_USAGE,
  EXIT_CONFLICT,
  mapVersionCliExitCode,
  projectVersionCliError,
  writeVersionJson,
};
