'use strict';

const net = require('node:net');

/**
 * 空き TCP ポートを取得します（127.0.0.1）。
 * @returns {Promise<number>}
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        if (!port) {
          reject(new Error('[JSKim] 空きポートを取得できませんでした。'));
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

module.exports = {
  getFreePort,
};
