'use strict';

/**
 * creator 完了案内の既定開発サーバー URL。
 * template/jskim.config.js の serve.host / serve.port と一致させる。
 */
const DEFAULT_DEV_HOST = '127.0.0.1';
const DEFAULT_DEV_PORT = 3000;
const DEFAULT_DEV_URL = `http://${DEFAULT_DEV_HOST}:${DEFAULT_DEV_PORT}/`;

module.exports = {
  DEFAULT_DEV_HOST,
  DEFAULT_DEV_PORT,
  DEFAULT_DEV_URL,
};
