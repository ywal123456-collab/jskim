'use strict';

const { loadConfig } = require('../lib/load-config');
const { selectProjectName } = require('../lib/select-project-name');
const { resolveProject } = require('../lib/resolve-project');
const { resolveScreenSpecModule } = require('../lib/resolve-screen-spec-module');
const {
  EXIT_SUCCESS,
  mapVersionCliExitCode,
  projectVersionCliError,
  writeVersionJson,
} = require('../lib/version-cli-errors');
const {
  shortHash,
  formatVersionStatusHuman,
  projectVersionStatusJson,
  formatVersionDiffHuman,
  projectVersionDiffJson,
  formatVersionLogHuman,
  projectVersionLogJson,
  formatVersionBranchesHuman,
  formatVersionTagsHuman,
  formatVersionFsckHuman,
  projectRecoveryInspectJson,
  formatRecoveryInspectHuman,
} = require('../lib/format-version-cli');

/**
 * @param {object} options
 * @param {string} [options.projectName]
 * @param {string} [options.revision]
 * @param {string} options.versionCommand
 * @param {object} options.versionOptions
 * @param {string} [options.workspaceRoot]
 * @param {string} [options.modulePath]
 * @param {string} [options.usageLine]
 */
async function runSpecVersionCommand(options = {}) {
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const versionCommand = options.versionCommand;
  const vo = options.versionOptions || {};
  const json = Boolean(vo.json);
  const usageLine =
    options.usageLine || `jskim spec version ${versionCommand} [<project>]`;

  let projectName;
  try {
    const { config } = loadConfig(workspaceRoot);
    projectName = selectProjectName({
      config,
      projectName: options.projectName,
      commandName: `spec version ${versionCommand}`,
      usageLine,
    });
    resolveProject({
      config,
      workspaceRoot,
      projectName,
      commandName: `spec version ${versionCommand}`,
      usageLine,
    });
  } catch (err) {
    return finishError({
      json,
      command: versionCommand,
      project: options.projectName,
      err,
    });
  }

  let api;
  try {
    api = await resolveScreenSpecModule({
      projectRoot: workspaceRoot,
      modulePath: options.modulePath,
      requireVersion: true,
    });
  } catch (err) {
    return finishError({
      json,
      command: versionCommand,
      project: projectName,
      err,
    });
  }

  const ctx = { rootDir: workspaceRoot, projectName };

  try {
    const result = await dispatchVersionCommand({
      api,
      ctx,
      versionCommand,
      revision: options.revision,
      vo,
    });
    return finishSuccess({
      json,
      command: versionCommand,
      project: projectName,
      human: result.human,
      result: result.jsonResult,
      warnings: result.warnings,
      exitCode: result.exitCode ?? EXIT_SUCCESS,
    });
  } catch (err) {
    return finishError({
      json,
      command: versionCommand,
      project: projectName,
      err,
      recoverHint: true,
    });
  }
}

/**
 * @param {object} params
 */
async function dispatchVersionCommand(params) {
  const { api, ctx, versionCommand, revision, vo } = params;

  switch (versionCommand) {
    case 'init':
      return runInit(api, ctx);
    case 'config':
      return runConfig(api, ctx, vo);
    case 'status':
      return runStatus(api, ctx);
    case 'diff':
      return runDiff(api, ctx, vo);
    case 'add':
      return runAdd(api, ctx, vo);
    case 'commit':
      return runCommit(api, ctx, vo);
    case 'log':
      return runLog(api, ctx, vo);
    case 'branch':
      return runBranch(api, ctx, vo);
    case 'tag':
      return runTag(api, ctx, vo);
    case 'checkout':
      return runCheckout(api, ctx, revision);
    case 'revert':
      return runRevert(api, ctx, revision, vo);
    case 'fsck':
      return runFsck(api, ctx);
    case 'recover':
      return runRecover(api, ctx, vo);
    default: {
      const err = new Error(
        `[JSKim] 不明な version サブコマンドです: ${versionCommand}`
      );
      err.code = 'JSKIM_USAGE_ERROR';
      err.exitCode = 2;
      throw err;
    }
  }
}

function runInit(api, ctx) {
  const result = api.initVersionRepository(ctx);
  if (result.status === 'existing') {
    const human = [
      '[JSKim] Screen Spec のローカル版管理は既に初期化されています。',
      `プロジェクト: ${ctx.projectName}`,
      'ブランチ: main',
    ].join('\n');
    return {
      human,
      jsonResult: {
        status: 'existing',
        project: ctx.projectName,
        branch: 'main',
      },
    };
  }
  const human = [
    '[JSKim] Screen Spec のローカル版管理を初期化しました。',
    `プロジェクト: ${ctx.projectName}`,
    'ブランチ: main',
    `次の操作: jskim spec version add ${ctx.projectName} --all`,
  ].join('\n');
  return {
    human,
    jsonResult: {
      status: 'created',
      project: ctx.projectName,
      branch: 'main',
    },
  };
}

function runConfig(api, ctx, vo) {
  const status = api.persistVersionAuthorConfig({
    ...ctx,
    config: {
      schemaVersion: '1.0',
      user: { name: vo.name, email: vo.email },
    },
  });
  const human =
    status === 'unchanged'
      ? `[JSKim] author 設定は変更ありません。\n名前: ${vo.name}`
      : `[JSKim] author 設定を${status === 'created' ? '作成' : '更新'}しました。\n名前: ${vo.name}\nメール: ${vo.email}`;
  return {
    human,
    jsonResult: {
      status,
      user: { name: vo.name, email: vo.email },
    },
  };
}

function runStatus(api, ctx) {
  const status = api.getVersionStatus(ctx);
  const inspection = api.inspectVersionRecovery(ctx);
  const recoveryRequired = Boolean(inspection.recoveryRequired);
  return {
    human: [
      `プロジェクト: ${ctx.projectName}`,
      formatVersionStatusHuman(status, { recoveryRequired }),
    ].join('\n'),
    jsonResult: projectVersionStatusJson(status, { recoveryRequired }),
  };
}

function runDiff(api, ctx, vo) {
  const status = api.getVersionStatus(ctx);
  const scope = vo.staged ? 'staged' : 'working';
  const changes = vo.staged ? status.stagedChanges : status.unstagedChanges;
  return {
    human: formatVersionDiffHuman(changes, scope),
    jsonResult: projectVersionDiffJson(changes, scope),
  };
}

function runAdd(api, ctx, vo) {
  let stageResult;
  let scopeLabel;
  if (vo.all) {
    stageResult = api.stageProject(ctx);
    scopeLabel = 'project (--all)';
  } else if (vo.screen != null) {
    stageResult = api.stageScreen({ ...ctx, screenId: vo.screen });
    scopeLabel = `screen:${vo.screen}`;
  } else if (vo.features) {
    stageResult = api.stageFeature({ ...ctx, featureId: null });
    scopeLabel = 'features.json';
  } else {
    stageResult = api.stageFeature({ ...ctx, featureId: vo.feature });
    scopeLabel = `feature:${vo.feature}`;
  }

  const status = api.getVersionStatus(ctx);
  const stagedCount = status.stagedChanges.length;
  const unchanged = stageResult.status === 'unchanged';
  const human = unchanged
    ? `[JSKim] 変更なし（${scopeLabel}）\nステージ済み変更: ${stagedCount}`
    : `[JSKim] ステージしました（${scopeLabel}）\nステージ済み変更: ${stagedCount}`;
  return {
    human,
    jsonResult: {
      status: stageResult.status,
      scope: scopeLabel,
      stagedCount,
      indexRevision: stageResult.indexRevision,
      treeHash: stageResult.treeHash,
    },
  };
}

function runCommit(api, ctx, vo) {
  const result = api.commitVersion({
    ...ctx,
    message: vo.message,
  });
  const headLabel = result.detached
    ? `detached HEAD ${shortHash(result.commitHash)}`
    : `${(result.headRef || 'refs/heads/main').replace(/^refs\/heads\//, '')} ${shortHash(result.commitHash)}`;
  const firstLine = (vo.message || '').split(/\r?\n/, 1)[0] || '';
  return {
    human: `[${headLabel}] ${firstLine}`,
    jsonResult: {
      commitHash: result.commitHash,
      treeHash: result.treeHash,
      parents: result.parents,
      message: result.message,
      detached: result.detached,
      headRef: result.headRef,
    },
  };
}

function runLog(api, ctx, vo) {
  const limit =
    vo.limit != null ? Number(vo.limit) : undefined;
  const result = api.getVersionLog({
    ...ctx,
    limit,
    cursor: vo.cursor,
  });
  return {
    human: formatVersionLogHuman(result),
    jsonResult: projectVersionLogJson(result),
  };
}

function runBranch(api, ctx, vo) {
  if (vo.create != null) {
    const created = api.createVersionBranch({
      ...ctx,
      name: vo.create,
      startPoint: vo.start,
    });
    return {
      human: `[JSKim] branch ${created.name} を作成しました: ${shortHash(created.commitHash)}`,
      jsonResult: {
        action: 'create',
        name: created.name,
        commitHash: created.commitHash,
      },
    };
  }
  if (vo.delete != null) {
    api.deleteVersionBranch({ ...ctx, name: vo.delete });
    return {
      human: `[JSKim] branch ${vo.delete} を削除しました。`,
      jsonResult: { action: 'delete', name: vo.delete },
    };
  }
  const branches = api.listVersionBranches(ctx);
  return {
    human: formatVersionBranchesHuman(branches),
    jsonResult: {
      branches: branches.map((branch) => ({
        name: branch.name,
        commitHash: branch.commitHash,
        current: branch.current,
        unborn: branch.unborn,
      })),
    },
  };
}

function runTag(api, ctx, vo) {
  if (vo.create != null) {
    const tag = api.createVersionTag({
      ...ctx,
      name: vo.create,
      message: vo.message,
      target: vo.target,
    });
    return {
      human: `タグ ${tag.name} を作成しました: ${shortHash(tag.targetCommitHash)}`,
      jsonResult: {
        action: 'create',
        name: tag.name,
        targetCommitHash: tag.targetCommitHash,
        tagObjectHash: tag.tagObjectHash,
      },
    };
  }
  const tags = api.listVersionTags(ctx);
  return {
    human: formatVersionTagsHuman(tags),
    jsonResult: {
      tags: tags.map((tag) => ({
        name: tag.name,
        targetCommitHash: tag.targetCommitHash,
        tagObjectHash: tag.tagObjectHash,
      })),
    },
  };
}

function runCheckout(api, ctx, revision) {
  const result = api.checkoutVersion({
    ...ctx,
    target: revision,
  });
  let human;
  if (result.headKind === 'symbolic' && result.headRef) {
    const name = result.headRef.replace(/^refs\/heads\//, '');
    human = result.noop
      ? `[JSKim] すでにブランチ ${name} にいます。`
      : `[JSKim] ブランチ ${name} に切り替えました。`;
  } else {
    human = result.noop
      ? `[JSKim] すでに detached HEAD ${shortHash(result.commitHash)} です。`
      : `[JSKim] detached HEAD: ${shortHash(result.commitHash)}`;
  }
  return {
    human,
    jsonResult: {
      commitHash: result.commitHash,
      treeHash: result.treeHash,
      headKind: result.headKind,
      headRef: result.headRef,
      noop: result.noop,
    },
  };
}

function runRevert(api, ctx, revision, vo) {
  const result = api.revertVersionCommit({
    ...ctx,
    target: revision,
    message: vo.message,
  });
  if (result.noop) {
    return {
      human: '[JSKim] revert する変更はありませんでした（noop）。',
      jsonResult: {
        noop: true,
        commitHash: result.commitHash,
        revertedCommit: result.revertedCommit,
      },
    };
  }
  return {
    human: [
      `${shortHash(result.revertedCommit)} の変更を取り消しました。`,
      `新しいcommit: ${shortHash(result.commitHash)}`,
    ].join('\n'),
    jsonResult: {
      noop: false,
      commitHash: result.commitHash,
      treeHash: result.treeHash,
      revertedCommit: result.revertedCommit,
      conflicts: result.conflicts || [],
    },
  };
}

function runFsck(api, ctx) {
  const fsck = api.fsckVersionRepository(ctx);
  const inspection = api.inspectVersionRecovery(ctx);
  const recoveryRequired = Boolean(inspection.recoveryRequired);
  const exitCode = fsck.errors.length > 0 ? 1 : EXIT_SUCCESS;
  return {
    human: formatVersionFsckHuman(fsck, { recoveryRequired }),
    jsonResult: {
      schemaVersion: '1.0',
      checkedObjects: fsck.checkedObjects,
      reachableObjects: fsck.reachableObjects,
      danglingObjects: fsck.danglingObjects,
      warnings: fsck.warnings,
      errors: fsck.errors,
      incompleteTransactions: fsck.incompleteTransactions,
      recoveryRequired,
    },
    exitCode,
  };
}

function runRecover(api, ctx, vo) {
  if (vo.inspect) {
    const inspection = api.inspectVersionRecovery(ctx);
    return {
      human: formatRecoveryInspectHuman(inspection),
      jsonResult: projectRecoveryInspectJson(inspection),
    };
  }

  const before = api.inspectVersionRecovery(ctx);
  const plan = (before.plans || []).find(
    (item) => item.operationId === vo.operationId
  );
  if (!plan) {
    const err = new Error(
      '[JSKim] 指定した operationId の未完了 transaction が見つかりません。\n' +
        '先に jskim spec version recover <project> --inspect を実行してください。'
    );
    err.code = 'SPEC_VERSION_RECOVERY_UNSAFE';
    throw err;
  }
  if (plan.recommendedAction === 'unsafe') {
    const err = new Error(
      '[JSKim] この transaction は自動回復できません（recommendedAction: unsafe）。'
    );
    err.code = 'SPEC_VERSION_RECOVERY_UNSAFE';
    throw err;
  }

  const after = api.recoverVersionRepository({
    ...ctx,
    confirm: true,
    expectedOperationId: vo.operationId,
  });

  const actionLabel =
    plan.recommendedAction === 'rollback'
      ? 'rollback 完了'
      : plan.recommendedAction === 'complete'
        ? 'forward completion 完了'
        : 'cleanup 完了';

  return {
    human: `[JSKim] ${actionLabel}\noperationId: ${vo.operationId}`,
    jsonResult: {
      action: plan.recommendedAction,
      operationId: vo.operationId,
      recoveryRequired: after.recoveryRequired,
      plans: projectRecoveryInspectJson(after).plans,
    },
  };
}

function finishSuccess({
  json,
  command,
  project,
  human,
  result,
  warnings,
  exitCode,
}) {
  if (json) {
    writeVersionJson({
      command,
      project,
      result,
      warnings,
    });
  } else if (human) {
    console.log(human);
  }
  process.exitCode = exitCode;
  return { ok: true, exitCode, result };
}

function finishError({ json, command, project, err, recoverHint }) {
  const exitCode = mapVersionCliExitCode(err);
  const projected = projectVersionCliError(err);
  let message = projected.message;
  if (
    recoverHint &&
    projected.code === 'SPEC_VERSION_RECOVERY_REQUIRED' &&
    project
  ) {
    message += `\n次の操作: jskim spec version recover ${project} --inspect`;
  }
  if (
    projected.code === 'SPEC_VERSION_WORKING_TREE_DIRTY' &&
    project
  ) {
    message += `\n確認: jskim spec version status ${project}`;
  }

  if (json) {
    writeVersionJson({
      command,
      project,
      error: { code: projected.code, message },
    });
  } else {
    console.error(message.startsWith('[JSKim]') ? message : `[JSKim] ${message}`);
  }
  process.exitCode = exitCode;
  return { ok: false, exitCode, error: projected };
}

module.exports = {
  runSpecVersionCommand,
};
