'use strict';

/**
 * テスト用 multipart/form-data ボディを組み立てる（バイナリ安全）。
 *
 * @param {string} boundary
 * @param {Array<object>} parts
 * @returns {Buffer}
 */
function buildMultipartBody(boundary, parts) {
  const chunks = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`, 'utf8'));
    if (part.filename != null) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`,
          'utf8'
        )
      );
      if (part.contentType) {
        chunks.push(
          Buffer.from(`Content-Type: ${part.contentType}\r\n`, 'utf8')
        );
      }
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"\r\n`,
          'utf8'
        )
      );
      if (part.contentType) {
        chunks.push(
          Buffer.from(`Content-Type: ${part.contentType}\r\n`, 'utf8')
        );
      }
    }
    chunks.push(Buffer.from('\r\n', 'utf8'));
    const data = Buffer.isBuffer(part.data)
      ? part.data
      : Buffer.from(String(part.data ?? ''), 'utf8');
    chunks.push(data);
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return Buffer.concat(chunks);
}

/** 最小有効 PNG（IHDR のみ） */
function buildPng(width, height, pad = 0) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  const type = Buffer.from('IHDR');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(13, 0);
  const body = Buffer.concat([sig, len, type, ihdrData, Buffer.alloc(4)]);
  return pad > 0 ? Buffer.concat([body, Buffer.alloc(pad, 1)]) : body;
}

module.exports = {
  buildMultipartBody,
  buildPng,
};
