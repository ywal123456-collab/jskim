'use strict';

const { formatConfigValidationError } = require('./format-diagnostic');

/**
 * CLI --host / --port を resolved project に適用した新しいオブジェクトを返します。
 * 元の project / config は変更しません。
 *
 * @param {object} project
 * @param {{ host?: string, port?: string|number }} [overrides]
 * @returns {object}
 */
function applyServeCliOverrides(project, overrides = {}) {
  if (!project || typeof project !== 'object') {
    throw new Error('[JSKim] projectが不正です。');
  }

  const hasHost = overrides.host !== undefined;
  const hasPort = overrides.port !== undefined;
  if (!hasHost && !hasPort) {
    return project;
  }

  const nextServe = {
    ...(project.serve || {}),
  };

  if (hasHost) {
    nextServe.host = overrides.host;
  }

  if (hasPort) {
    nextServe.port = coercePort(overrides.port, project.name);
  }

  validateServeOverride(nextServe, project.name);
  return {
    ...project,
    serve: nextServe,
  };
}

function coercePort(value, projectName) {
  if (typeof value === 'number') {
    return value;
  }
  const text = String(value).trim();
  if (text === '' || !/^-?\d+$/.test(text)) {
    throw new Error(
      formatConfigValidationError({
        projectName,
        configKey: 'CLI --port',
        detail: '1から65535までの整数を指定してください。',
        received: String(value),
      })
    );
  }
  return Number(text);
}

function validateServeOverride(serve, projectName) {
  const host = serve && serve.host;
  const port = serve && serve.port;

  if (typeof host !== 'string' || host.trim() === '') {
    throw new Error(
      formatConfigValidationError({
        projectName,
        configKey: 'CLI --host / serve.host',
        detail: '空でない文字列を指定してください。',
        received: String(host),
      })
    );
  }

  if (
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(
      formatConfigValidationError({
        projectName,
        configKey: 'CLI --port / serve.port',
        detail: '1から65535までの整数を指定してください。',
        received: String(port),
      })
    );
  }
}

module.exports = {
  applyServeCliOverrides,
  coercePort,
};
