'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMultipartContentType,
  parseMultipartFormData,
} = require('../scripts/lib/parse-multipart-form-data');
const { buildMultipartBody, buildPng } = require('./helpers/multipart');

describe('parse-multipart-form-data', () => {
  it('boundary 付き Content-Type を受理し、無しを拒否する', () => {
    assert.equal(
      parseMultipartContentType(
        'multipart/form-data; boundary=----WebKitFormBoundary7'
      ).ok,
      true
    );
    assert.equal(
      parseMultipartContentType('multipart/form-data').ok,
      false
    );
    assert.equal(parseMultipartContentType('application/json').ok, false);
  });

  it('quoted boundary と PNG バイナリ（類似 bytes 含む）を扱う', () => {
    const boundary = '----BoundXYZ';
    const png = buildPng(10, 10, 8);
    // 本物 boundary ではなく「似た」bytes（multipart は実 boundary 非含有が前提）
    const hostile = Buffer.concat([
      png,
      Buffer.from('\r\n--BoundXYZfake\r\n', 'utf8'),
      Buffer.from([0x00, 0xff, 0x0d, 0x0a]),
    ]);
    assert.equal(
      parseMultipartContentType(
        `multipart/form-data; boundary="${boundary}"`
      ).boundary,
      boundary
    );

    const body = buildMultipartBody(boundary, [
      {
        name: 'image',
        filename: 'a.png',
        contentType: 'image/png',
        data: png,
      },
      {
        name: 'expectedImageRevision',
        data: `sha256:${'a'.repeat(64)}`,
      },
    ]);
    const parsed = parseMultipartFormData(body, boundary);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.files.length, 1);
    assert.equal(parsed.fields.length, 1);
    assert.ok(parsed.files[0].data.equals(png));

    const bodyHostile = buildMultipartBody(boundary, [
      {
        name: 'image',
        filename: 'a.png',
        contentType: 'image/png',
        data: hostile,
      },
    ]);
    const parsedHostile = parseMultipartFormData(bodyHostile, boundary);
    assert.equal(parsedHostile.ok, true);
    assert.ok(parsedHostile.files[0].data.equals(hostile));
  });

  it('image 先 / expected 先の順序を受け入れる', () => {
    const boundary = 'ord';
    const png = buildPng(4, 4);
    const rev = `sha256:${'b'.repeat(64)}`;
    for (const parts of [
      [
        { name: 'image', filename: 'x.png', contentType: 'image/png', data: png },
        { name: 'expectedImageRevision', data: rev },
      ],
      [
        { name: 'expectedImageRevision', data: rev },
        { name: 'image', filename: 'x.png', contentType: 'image/png', data: png },
      ],
    ]) {
      const parsed = parseMultipartFormData(
        buildMultipartBody(boundary, parts),
        boundary
      );
      assert.equal(parsed.ok, true);
      assert.equal(parsed.files[0].name, 'image');
      assert.equal(parsed.fields[0].name, 'expectedImageRevision');
    }
  });

  it('終端 boundary 欠落を拒否する', () => {
    const boundary = 'bad';
    const incomplete = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="a"\r\n\r\nhi\r\n`,
      'utf8'
    );
    const parsed = parseMultipartFormData(incomplete, boundary);
    assert.equal(parsed.ok, false);
  });

  it('UTF-8 filename と filename 無し text field を区別する', () => {
    const boundary = 'fn';
    const body = buildMultipartBody(boundary, [
      {
        name: 'image',
        filename: '参照.png',
        contentType: 'image/png',
        data: buildPng(2, 2),
      },
      {
        name: 'expectedImageRevision',
        contentType: 'text/plain; charset=utf-8',
        data: `sha256:${'c'.repeat(64)}`,
      },
    ]);
    const parsed = parseMultipartFormData(body, boundary);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.files.length, 1);
    assert.equal(parsed.files[0].filename, '参照.png');
    assert.equal(parsed.fields.length, 1);
  });
});
