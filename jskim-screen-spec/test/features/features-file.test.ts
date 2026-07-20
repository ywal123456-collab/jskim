import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FeatureError,
  formatScreenFeatureFile,
  loadScreenFeatures,
  persistScreenFeatures,
  validateScreenFeatureFile,
} from '../../src/features/index.js';

const temps: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jskim-feat-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

const known = [
  'inquiry-input',
  'inquiry-confirm',
  'inquiry-complete',
  'other-screen',
];

describe('Screen Feature file', () => {
  it('features.json が無い場合は全画面 Ungrouped', () => {
    const root = tempRoot();
    const result = loadScreenFeatures({
      rootDir: root,
      projectName: 'demo',
      knownScreenIds: known,
    });
    expect(result.sourceExists).toBe(false);
    expect(result.features).toEqual([]);
    expect(result.ungroupedScreenIds).toEqual(known);
  });

  it('空 features は全画面 Ungrouped', () => {
    const doc = validateScreenFeatureFile(
      { schemaVersion: '1.0', features: [] },
      { knownScreenIds: known },
    );
    expect(doc.features).toEqual([]);
  });

  it('displayOrder で機能をソートし screenIds 順を維持する', () => {
    const doc = validateScreenFeatureFile(
      {
        schemaVersion: '1.0',
        features: [
          {
            featureId: 'beta',
            name: 'B',
            displayOrder: 20,
            screenIds: ['other-screen'],
          },
          {
            featureId: 'inquiry',
            name: 'お問い合わせ',
            description: '説明',
            displayOrder: 10,
            screenIds: [
              'inquiry-input',
              'inquiry-confirm',
              'inquiry-complete',
            ],
          },
        ],
      },
      { knownScreenIds: known },
    );
    expect(doc.features.map((f) => f.featureId)).toEqual([
      'inquiry',
      'beta',
    ]);
    expect(doc.features[0].screenIds).toEqual([
      'inquiry-input',
      'inquiry-confirm',
      'inquiry-complete',
    ]);
  });

  it('Ungrouped は knownScreenIds の順を維持する', () => {
    const root = tempRoot();
    persistScreenFeatures({
      rootDir: root,
      projectName: 'demo',
      knownScreenIds: known,
      document: {
        schemaVersion: '1.0',
        features: [
          {
            featureId: 'inquiry',
            name: 'お問い合わせ',
            displayOrder: 10,
            screenIds: ['inquiry-input', 'inquiry-confirm'],
          },
        ],
      },
    });
    const loaded = loadScreenFeatures({
      rootDir: root,
      projectName: 'demo',
      knownScreenIds: known,
    });
    expect(loaded.ungroupedScreenIds).toEqual([
      'inquiry-complete',
      'other-screen',
    ]);
  });

  it('duplicate featureId を拒否する', () => {
    expect(() =>
      validateScreenFeatureFile(
        {
          schemaVersion: '1.0',
          features: [
            {
              featureId: 'inquiry',
              name: 'A',
              displayOrder: 1,
              screenIds: ['inquiry-input'],
            },
            {
              featureId: 'inquiry',
              name: 'B',
              displayOrder: 2,
              screenIds: ['inquiry-confirm'],
            },
          ],
        },
        { knownScreenIds: known },
      ),
    ).toThrow(FeatureError);
    try {
      validateScreenFeatureFile(
        {
          schemaVersion: '1.0',
          features: [
            {
              featureId: 'inquiry',
              name: 'A',
              displayOrder: 1,
              screenIds: ['inquiry-input'],
            },
            {
              featureId: 'inquiry',
              name: 'B',
              displayOrder: 2,
              screenIds: ['inquiry-confirm'],
            },
          ],
        },
        { knownScreenIds: known },
      );
    } catch (err) {
      expect((err as FeatureError).code).toBe('SPEC_FEATURE_DUPLICATE_ID');
    }
  });

  it('duplicate displayOrder を拒否する', () => {
    try {
      validateScreenFeatureFile(
        {
          schemaVersion: '1.0',
          features: [
            {
              featureId: 'a',
              name: 'A',
              displayOrder: 10,
              screenIds: ['inquiry-input'],
            },
            {
              featureId: 'b',
              name: 'B',
              displayOrder: 10,
              screenIds: ['inquiry-confirm'],
            },
          ],
        },
        { knownScreenIds: known },
      );
      expect.fail('should throw');
    } catch (err) {
      expect((err as FeatureError).code).toBe('SPEC_FEATURE_ORDER_CONFLICT');
    }
  });

  it('membership 重複と unknown screen を区別する', () => {
    try {
      validateScreenFeatureFile(
        {
          schemaVersion: '1.0',
          features: [
            {
              featureId: 'a',
              name: 'A',
              displayOrder: 1,
              screenIds: ['inquiry-input'],
            },
            {
              featureId: 'b',
              name: 'B',
              displayOrder: 2,
              screenIds: ['inquiry-input'],
            },
          ],
        },
        { knownScreenIds: known },
      );
      expect.fail('should throw');
    } catch (err) {
      expect((err as FeatureError).code).toBe(
        'SPEC_FEATURE_DUPLICATE_MEMBERSHIP',
      );
    }

    try {
      validateScreenFeatureFile(
        {
          schemaVersion: '1.0',
          features: [
            {
              featureId: 'a',
              name: 'A',
              displayOrder: 1,
              screenIds: ['missing-screen'],
            },
          ],
        },
        { knownScreenIds: known },
      );
      expect.fail('should throw');
    } catch (err) {
      expect((err as FeatureError).code).toBe('SPEC_FEATURE_UNKNOWN_SCREEN');
    }
  });

  it('同一機能内の screenId 重複を拒否する', () => {
    try {
      validateScreenFeatureFile(
        {
          schemaVersion: '1.0',
          features: [
            {
              featureId: 'a',
              name: 'A',
              displayOrder: 1,
              screenIds: ['inquiry-input', 'inquiry-input'],
            },
          ],
        },
        { knownScreenIds: known },
      );
      expect.fail('should throw');
    } catch (err) {
      expect((err as FeatureError).code).toBe(
        'SPEC_FEATURE_DUPLICATE_MEMBERSHIP',
      );
    }
  });

  it('unsupported schema と invalid root を拒否する', () => {
    try {
      validateScreenFeatureFile(
        { schemaVersion: '9.0', features: [] },
        { knownScreenIds: known },
      );
      expect.fail('should throw');
    } catch (err) {
      expect((err as FeatureError).code).toBe(
        'SPEC_FEATURE_UNSUPPORTED_SCHEMA',
      );
    }
    try {
      validateScreenFeatureFile([], { knownScreenIds: known });
      expect.fail('should throw');
    } catch (err) {
      expect((err as FeatureError).code).toBe('SPEC_FEATURE_INVALID_FORMAT');
    }
  });

  it('unknown field と prototype key を拒否する', () => {
    expect(() =>
      validateScreenFeatureFile(
        { schemaVersion: '1.0', features: [], extra: true },
        { knownScreenIds: known },
      ),
    ).toThrow(FeatureError);
    expect(() =>
      validateScreenFeatureFile(
        JSON.parse('{"schemaVersion":"1.0","features":[],"__proto__":{}}'),
        { knownScreenIds: known },
      ),
    ).toThrow(FeatureError);
  });

  it('日本語名を保持する', () => {
    const doc = validateScreenFeatureFile(
      {
        schemaVersion: '1.0',
        features: [
          {
            featureId: 'inquiry',
            name: 'お問い合わせ',
            description: '入力から完了まで',
            displayOrder: 1,
            screenIds: ['inquiry-input'],
          },
        ],
      },
      { knownScreenIds: known },
    );
    expect(doc.features[0].name).toBe('お問い合わせ');
  });

  it('atomic write と同一 semantic の再書込み', () => {
    const root = tempRoot();
    const document = {
      schemaVersion: '1.0' as const,
      features: [
        {
          featureId: 'inquiry',
          name: 'お問い合わせ',
          displayOrder: 10,
          screenIds: ['inquiry-input', 'inquiry-confirm'],
        },
      ],
    };
    const first = persistScreenFeatures({
      rootDir: root,
      projectName: 'demo',
      knownScreenIds: known,
      document,
    });
    expect(first.status).toBe('created');
    const filePath = path.join(
      root,
      'spec',
      'demo',
      'src',
      'features.json',
    );
    const before = fs.readFileSync(filePath);
    const second = persistScreenFeatures({
      rootDir: root,
      projectName: 'demo',
      knownScreenIds: known,
      document,
    });
    expect(second.status).toBe('unchanged');
    expect(Buffer.compare(before, fs.readFileSync(filePath))).toBe(0);
    expect(fs.readdirSync(path.dirname(filePath)).every((n) => !n.includes('.tmp'))).toBe(
      true,
    );
  });

  it('不正な既存ファイルは Ungrouped に fallback しない', () => {
    const root = tempRoot();
    const dir = path.join(root, 'spec', 'demo', 'src');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'features.json'), '{broken');
    expect(() =>
      loadScreenFeatures({
        rootDir: root,
        projectName: 'demo',
        knownScreenIds: known,
      }),
    ).toThrow(FeatureError);
  });

  it('formatScreenFeatureFile は安定した並びを出す', () => {
    const text = formatScreenFeatureFile({
      schemaVersion: '1.0',
      features: [
        {
          featureId: 'z',
          name: 'Z',
          displayOrder: 2,
          screenIds: ['other-screen'],
        },
        {
          featureId: 'a',
          name: 'A',
          displayOrder: 1,
          screenIds: ['inquiry-input'],
        },
      ],
    });
    expect(text.endsWith('\n')).toBe(true);
    expect(text.indexOf('"featureId": "a"')).toBeLessThan(
      text.indexOf('"featureId": "z"'),
    );
  });
});
