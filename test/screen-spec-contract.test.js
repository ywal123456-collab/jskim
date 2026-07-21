'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCHEMA_DIR = path.join(REPO_ROOT, 'docs', 'screen-spec', 'schema');
const SOURCE_DIR = path.join(REPO_ROOT, 'docs', 'screen-spec', 'examples', 'source');
const DESCRIPTION_DIR = path.join(REPO_ROOT, 'docs', 'screen-spec', 'examples', 'description');
const README_PATH = path.join(REPO_ROOT, 'docs', 'screen-spec', 'README.md');

const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ALLOWED_ACTION_TYPES = new Set(['click', 'fill', 'select', 'check', 'uncheck', 'wait']);
const ALLOWED_INTERACTION_TYPES = new Set(['state-transition', 'screen-transition', 'external-link']);
const DOCUMENTED_ACTION_TYPES = ['click', 'check', 'uncheck', 'fill', 'select', 'wait'];
const EXPECTED_INTERACTION_CATEGORIES = ['modal', 'tab', 'accordion', 'validation', 'navigation'];

function listJsonFiles(dir) {
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => path.join(dir, name)).sort();
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertKebabId(value, label) {
  assert.equal(typeof value, 'string', label + ' must be string');
  assert.match(value, ID_PATTERN, label + ' must be kebab-case: ' + value);
}

function collectActionTypeConsts(schema) {
  const oneOf = schema && schema.$defs && schema.$defs.collectAction && schema.$defs.collectAction.oneOf;
  assert.ok(Array.isArray(oneOf), 'source schema collectAction.oneOf must be array');
  return oneOf.map((branch) => {
    const constType = branch && branch.properties && branch.properties.type && branch.properties.type.const;
    assert.equal(typeof constType, 'string', 'collectAction type.const must be string');
    return constType;
  });
}

const sourceFiles = listJsonFiles(SOURCE_DIR);
const descriptionFiles = listJsonFiles(DESCRIPTION_DIR);
const sourceByScreenId = new Map();
const descriptionByScreenId = new Map();

for (const filePath of sourceFiles) {
  const data = loadJson(filePath);
  sourceByScreenId.set(data.screen.id, { filePath, data });
}
for (const filePath of descriptionFiles) {
  const data = loadJson(filePath);
  descriptionByScreenId.set(path.basename(filePath, '.json'), { filePath, data });
}

const allSourceScreenIds = new Set(sourceByScreenId.keys());

describe('スクリーン仕様 screen-spec 契約', () => {
  it('スキーマ JSON がパースできる', () => {
    const sourceSchema = loadJson(path.join(SCHEMA_DIR, 'source-spec.v1.schema.json'));
    const descriptionSchema = loadJson(path.join(SCHEMA_DIR, 'description-spec.v1.schema.json'));
    assert.equal(typeof sourceSchema, 'object');
    assert.equal(typeof descriptionSchema, 'object');
  });

  it('schemaVersion の const が 1.0 である', () => {
    const sourceSchema = loadJson(path.join(SCHEMA_DIR, 'source-spec.v1.schema.json'));
    const descriptionSchema = loadJson(path.join(SCHEMA_DIR, 'description-spec.v1.schema.json'));
    assert.equal(sourceSchema.properties.schemaVersion.const, '1.0');
    assert.equal(descriptionSchema.properties.schemaVersion.const, '1.0');
  });

  it('description-spec.v1.1 schema JSON がパースでき、itemOrder が必須である（サンプルは 1.0 のまま維持）', () => {
    const descriptionSchemaV11 = loadJson(
      path.join(SCHEMA_DIR, 'description-spec.v1.1.schema.json')
    );
    assert.equal(typeof descriptionSchemaV11, 'object');
    assert.equal(descriptionSchemaV11.properties.schemaVersion.const, '1.1');
    assert.ok(descriptionSchemaV11.required.includes('itemOrder'));
    assert.equal(descriptionSchemaV11.properties.itemOrder.type, 'array');
    assert.equal(descriptionSchemaV11.properties.itemOrder.uniqueItems, true);
    assert.equal(descriptionSchemaV11.additionalProperties, false);
  });

  it('description-spec.v1.2 schema JSON がパースでき、excludedItems が必須である（excludedItemIds は持たない）', () => {
    const descriptionSchemaV12 = loadJson(
      path.join(SCHEMA_DIR, 'description-spec.v1.2.schema.json')
    );
    assert.equal(typeof descriptionSchemaV12, 'object');
    assert.equal(descriptionSchemaV12.properties.schemaVersion.const, '1.2');
    assert.ok(descriptionSchemaV12.required.includes('itemOrder'));
    assert.ok(descriptionSchemaV12.required.includes('excludedItems'));
    assert.ok(descriptionSchemaV12.required.includes('items'));
    assert.equal(descriptionSchemaV12.properties.excludedItems.type, 'object');
    assert.equal(descriptionSchemaV12.additionalProperties, false);
    assert.equal(
      descriptionSchemaV12.properties.excludedItemIds,
      undefined,
      'excludedItemIds は採用しない（keys(excludedItems) が除外集合）'
    );
  });

  it('description-spec.v1.3 schema JSON がパースでき、rootNodes / groups が必須で itemOrder を持たない', () => {
    const descriptionSchemaV13 = loadJson(
      path.join(SCHEMA_DIR, 'description-spec.v1.3.schema.json')
    );
    assert.equal(typeof descriptionSchemaV13, 'object');
    assert.equal(descriptionSchemaV13.properties.schemaVersion.const, '1.3');
    assert.ok(descriptionSchemaV13.required.includes('rootNodes'));
    assert.ok(descriptionSchemaV13.required.includes('groups'));
    assert.ok(descriptionSchemaV13.required.includes('excludedItems'));
    assert.ok(descriptionSchemaV13.required.includes('items'));
    assert.equal(descriptionSchemaV13.properties.itemOrder, undefined);
    assert.equal(descriptionSchemaV13.additionalProperties, false);
  });

  it('interactionCategory の enum がドキュメント一覧と一致する', () => {
    const sourceSchema = loadJson(path.join(SCHEMA_DIR, 'source-spec.v1.schema.json'));
    assert.deepEqual(sourceSchema.$defs.interactionCategory.enum, EXPECTED_INTERACTION_CATEGORIES);
  });

  it('ドキュメントの action type が source schema の oneOf const に含まれる', () => {
    const sourceSchema = loadJson(path.join(SCHEMA_DIR, 'source-spec.v1.schema.json'));
    const schemaTypes = new Set(collectActionTypeConsts(sourceSchema));
    for (const actionType of DOCUMENTED_ACTION_TYPES) {
      assert.ok(schemaTypes.has(actionType), 'documented action type missing in schema: ' + actionType);
    }
    const readme = fs.readFileSync(README_PATH, 'utf8');
    for (const actionType of DOCUMENTED_ACTION_TYPES) {
      assert.match(readme, new RegExp('\\|\\s*`' + actionType + '`'), 'README missing action type: ' + actionType);
    }
  });

  it('source / description の例が存在し JSON パースできる', () => {
    assert.ok(sourceFiles.length > 0);
    assert.ok(descriptionFiles.length > 0);
    for (const filePath of sourceFiles.concat(descriptionFiles)) {
      const data = loadJson(filePath);
      assert.equal(typeof data, 'object');
      assert.notEqual(data, null);
    }
  });

  it('すべての例で schemaVersion が 1.0 である', () => {
    for (const filePath of sourceFiles.concat(descriptionFiles)) {
      const data = loadJson(filePath);
      assert.equal(data.schemaVersion, '1.0', path.relative(REPO_ROOT, filePath));
    }
  });

  it('source 例の ID・遷移・action / interaction type が契約に合う', () => {
    for (const entry of sourceByScreenId.values()) {
      const filePath = entry.filePath;
      const data = entry.data;
      const rel = path.relative(REPO_ROOT, filePath);
      assertKebabId(data.screen.id, rel + ' screen.id');
      const stateIds = new Set();
      for (const state of data.states) {
        assertKebabId(state.id, rel + ' state.id');
        assert.equal(stateIds.has(state.id), false, rel + ' duplicate state.id: ' + state.id);
        stateIds.add(state.id);
        for (const action of state.collect.actions) {
          assert.ok(ALLOWED_ACTION_TYPES.has(action.type), rel + ' bad action.type: ' + action.type);
          if (action.target !== undefined) {
            assertKebabId(action.target, rel + ' action.target');
          }
        }
      }
      for (const interaction of data.interactions) {
        assertKebabId(interaction.itemId, rel + ' interaction.itemId');
        assert.ok(ALLOWED_INTERACTION_TYPES.has(interaction.type), rel + ' bad interaction.type: ' + interaction.type);
        if (interaction.type === 'state-transition') {
          assertKebabId(interaction.targetStateId, rel + ' targetStateId');
          assert.ok(stateIds.has(interaction.targetStateId), rel + ' missing targetStateId: ' + interaction.targetStateId);
        }
        if (interaction.type === 'screen-transition') {
          assertKebabId(interaction.targetScreenId, rel + ' targetScreenId');
          assert.ok(allSourceScreenIds.has(interaction.targetScreenId), rel + ' missing targetScreenId: ' + interaction.targetScreenId);
        }
      }
    }
  });

  it('description 例の screen / item ID が kebab-case である', () => {
    for (const entry of descriptionByScreenId.values()) {
      const filePath = entry.filePath;
      const data = entry.data;
      const rel = path.relative(REPO_ROOT, filePath);
      const basename = path.basename(filePath, '.json');
      assert.equal(data.screen.id, basename, rel + ' screen.id basename mismatch');
      assertKebabId(data.screen.id, rel + ' screen.id');
      for (const itemId of Object.keys(data.items)) {
        assertKebabId(itemId, rel + ' items key');
      }
    }
  });

  it('対応する description がある source は itemId / screen.id が一致する', () => {
    for (const pair of sourceByScreenId) {
      const screenId = pair[0];
      const filePath = pair[1].filePath;
      const data = pair[1].data;
      const desc = descriptionByScreenId.get(screenId);
      if (!desc) continue;
      const rel = path.relative(REPO_ROOT, filePath);
      assert.equal(desc.data.screen.id, data.screen.id, rel + ' screen.id mismatch with description');
      const itemIds = new Set(Object.keys(desc.data.items));
      for (const interaction of data.interactions) {
        assert.ok(itemIds.has(interaction.itemId), rel + ' itemId missing in description: ' + interaction.itemId);
      }
    }
  });

  it('description ファイルは同名 screen.id の source と対になる', () => {
    for (const pair of descriptionByScreenId) {
      const screenId = pair[0];
      const filePath = pair[1].filePath;
      assert.ok(sourceByScreenId.has(screenId), path.relative(REPO_ROOT, filePath) + ' missing source for ' + screenId);
    }
  });
});
