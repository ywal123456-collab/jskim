'use strict';

/**
 * multipart/form-data の最小バイナリ安全パーサ（外部依存なし）。
 * PNG 等のバイナリを文字列 split しない。
 */

/**
 * @param {string|undefined} contentTypeHeader
 * @returns {{ ok: true, boundary: string } | { ok: false, code: string, message: string }}
 */
function parseMultipartContentType(contentTypeHeader) {
  const raw = String(contentTypeHeader || '').trim();
  if (!raw) {
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_UNSUPPORTED_MEDIA',
      message: 'Content-Type は multipart/form-data である必要があります。',
    };
  }
  const parts = raw.split(';').map((p) => p.trim());
  const media = (parts[0] || '').toLowerCase();
  if (media !== 'multipart/form-data') {
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_UNSUPPORTED_MEDIA',
      message: 'Content-Type は multipart/form-data である必要があります。',
    };
  }

  let boundary = null;
  for (let i = 1; i < parts.length; i += 1) {
    const seg = parts[i];
    const eq = seg.indexOf('=');
    if (eq < 0) {
      continue;
    }
    const key = seg.slice(0, eq).trim().toLowerCase();
    if (key !== 'boundary') {
      continue;
    }
    let value = seg.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value.length > 0) {
      boundary = value;
    }
  }

  if (!boundary) {
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_UNSUPPORTED_MEDIA',
      message: 'multipart/form-data に boundary がありません。',
    };
  }

  return { ok: true, boundary };
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {number} maxBytes
 * @returns {Promise<Buffer>}
 */
function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    let settled = false;

    function fail(err) {
      if (settled) {
        return;
      }
      settled = true;
      reject(err);
    }

    function succeed(value) {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    }

    req.on('data', (chunk) => {
      if (tooLarge || settled) {
        return;
      }
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        req.resume();
        const err = new Error('body too large');
        err.code = 'SPEC_REFERENCE_IMAGE_BODY_TOO_LARGE';
        fail(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge || settled) {
        return;
      }
      succeed(Buffer.concat(chunks));
    });
    req.on('error', fail);
  });
}

/**
 * @param {Buffer} body
 * @param {string} boundary
 * @returns {{
 *   ok: true,
 *   fields: Array<{ name: string, value: string }>,
 *   files: Array<{ name: string, filename: string|null, contentType: string|null, data: Buffer }>
 * } | {
 *   ok: false,
 *   code: string,
 *   message: string
 * }}
 */
function parseMultipartFormData(body, boundary) {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_MALFORMED_MULTIPART',
      message: 'multipart 本文が空です。',
    };
  }

  const delim = Buffer.from(`--${boundary}`, 'utf8');
  const delimCrLf = Buffer.from(`\r\n--${boundary}`, 'utf8');
  const closeSuffix = Buffer.from('--', 'utf8');

  // 先頭 delimiter
  if (!body.subarray(0, delim.length).equals(delim)) {
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_MALFORMED_MULTIPART',
      message: 'multipart の開始 boundary が不正です。',
    };
  }

  let offset = delim.length;
  // optional CRLF after opening boundary
  if (
    offset + 1 < body.length &&
    body[offset] === 0x0d &&
    body[offset + 1] === 0x0a
  ) {
    offset += 2;
  } else if (body.subarray(offset, offset + 2).equals(closeSuffix)) {
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_MALFORMED_MULTIPART',
      message: 'multipart 本文が空です。',
    };
  }

  const fields = [];
  const files = [];

  while (offset < body.length) {
    const nextDelim = indexOfBuffer(body, delimCrLf, offset);
    let partEnd;
    let isLast = false;
    if (nextDelim < 0) {
      // 最終 part: \r\n--boundary--
      const closeMarker = Buffer.concat([delimCrLf, closeSuffix]);
      const closeAt = indexOfBuffer(body, closeMarker, offset);
      if (closeAt < 0) {
        // opening 後の最終クローズのみ（parts が 1 で delimCrLf 無し）
        const altClose = Buffer.concat([
          Buffer.from('\r\n', 'utf8'),
          delim,
          closeSuffix,
        ]);
        const altAt = indexOfBuffer(body, altClose, offset);
        if (altAt < 0) {
          return {
            ok: false,
            code: 'SPEC_REFERENCE_IMAGE_MALFORMED_MULTIPART',
            message: 'multipart の終端 boundary が不正です。',
          };
        }
        partEnd = altAt;
        isLast = true;
      } else {
        partEnd = closeAt;
        isLast = true;
      }
    } else {
      partEnd = nextDelim;
    }

    const partBuf = body.subarray(offset, partEnd);
    const parsedPart = parseOnePart(partBuf);
    if (!parsedPart.ok) {
      return parsedPart;
    }
    if (parsedPart.kind === 'file') {
      files.push(parsedPart.file);
    } else {
      fields.push(parsedPart.field);
    }

    if (isLast) {
      break;
    }
    offset = nextDelim + delimCrLf.length;
    if (
      offset + 1 < body.length &&
      body[offset] === 0x0d &&
      body[offset + 1] === 0x0a
    ) {
      offset += 2;
    } else if (body.subarray(offset, offset + 2).equals(closeSuffix)) {
      break;
    }
  }

  return { ok: true, fields, files };
}

/**
 * @param {Buffer} partBuf
 */
function parseOnePart(partBuf) {
  const sep = Buffer.from('\r\n\r\n', 'utf8');
  const sepAt = indexOfBuffer(partBuf, sep, 0);
  if (sepAt < 0) {
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_MALFORMED_MULTIPART',
      message: 'multipart part のヘッダ区切りが不正です。',
    };
  }

  const headerText = partBuf.subarray(0, sepAt).toString('utf8');
  // partEnd は \r\n--boundary の先頭。CRLF は part に含めない（バイナリ末尾を壊さない）
  const data = partBuf.subarray(sepAt + 4);

  const headers = parsePartHeaders(headerText);
  const disposition = headers['content-disposition'] || '';
  const name = extractDispositionParam(disposition, 'name');
  if (!name) {
    return {
      ok: false,
      code: 'SPEC_REFERENCE_IMAGE_MALFORMED_MULTIPART',
      message: 'multipart part に name がありません。',
    };
  }

  // filename= がある場合のみ file。text/plain 付き text field を誤分類しない。
  const hasFilenameAttr = /(?:^|;)\s*filename\s*=/i.test(disposition);
  const filename = extractDispositionParam(disposition, 'filename');
  const contentType = headers['content-type'] || null;

  if (hasFilenameAttr) {
    return {
      ok: true,
      kind: 'file',
      file: {
        name,
        filename: filename == null || filename === '' ? null : filename,
        contentType,
        data,
      },
    };
  }

  return {
    ok: true,
    kind: 'field',
    field: {
      name,
      value: data.toString('utf8'),
    },
  };
}

function parsePartHeaders(headerText) {
  /** @type {Record<string, string>} */
  const headers = {};
  const lines = headerText.split(/\r\n/);
  for (const line of lines) {
    if (!line) {
      continue;
    }
    const idx = line.indexOf(':');
    if (idx < 0) {
      continue;
    }
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    headers[key] = value;
  }
  return headers;
}

function extractDispositionParam(disposition, paramName) {
  // name="x"; filename="y.png"
  const re = new RegExp(
    `(?:^|;)\\s*${paramName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^;\\s]+))`,
    'i'
  );
  const m = String(disposition || '').match(re);
  if (!m) {
    return null;
  }
  return m[1] != null ? m[1] : m[2] != null ? m[2] : m[3];
}

/**
 * @param {Buffer} haystack
 * @param {Buffer} needle
 * @param {number} from
 */
function indexOfBuffer(haystack, needle, from) {
  if (needle.length === 0) {
    return from;
  }
  outer: for (let i = from; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}

module.exports = {
  parseMultipartContentType,
  readRawBody,
  parseMultipartFormData,
};
