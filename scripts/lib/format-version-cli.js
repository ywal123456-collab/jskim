'use strict';

/**
 * Screen Spec version CLI の human / JSON 投影（絶対 path・秘密情報なし）。
 */

/**
 * @param {string | null | undefined} hash
 * @returns {string}
 */
function shortHash(hash) {
  if (!hash || typeof hash !== 'string') return '(none)';
  return hash.length >= 7 ? hash.slice(0, 7) : hash;
}

/**
 * @param {'added'|'modified'|'deleted'|'typeChanged'} kind
 * @returns {string}
 */
function changeCode(kind) {
  if (kind === 'added') return 'A';
  if (kind === 'modified') return 'M';
  if (kind === 'deleted') return 'D';
  if (kind === 'typeChanged') return 'T';
  return '?';
}

/**
 * @param {object} change
 * @returns {object}
 */
function projectChange(change) {
  return {
    kind: change.kind,
    path: change.path,
    screenId: change.screenId ?? null,
    featureId: change.featureId ?? null,
    scope: change.scope ?? null,
  };
}

/**
 * @param {object} status VersionStatusResult
 * @param {{ recoveryRequired?: boolean }} [extra]
 * @returns {string}
 */
function formatVersionStatusHuman(status, extra = {}) {
  const lines = [];
  const branch =
    status.unborn && status.headRef
      ? `${status.headRef.replace(/^refs\/heads\//, '')} (unborn)`
      : status.headRef
        ? status.headRef.replace(/^refs\/heads\//, '')
        : status.headCommit
          ? `detached HEAD ${shortHash(status.headCommit)}`
          : '(unknown)';

  lines.push(`ブランチ: ${branch}`);
  lines.push(
    `HEAD: ${status.unborn ? '(unborn)' : shortHash(status.headCommit)}`
  );

  if (extra.recoveryRequired) {
    lines.push('recovery required: はい');
    lines.push(
      '  次の操作: jskim spec version recover <project> --inspect'
    );
  } else {
    lines.push('recovery required: いいえ');
  }

  if (status.clean) {
    lines.push('状態: clean');
  } else {
    lines.push('状態: dirty');
  }

  if (status.stagedChanges.length > 0) {
    lines.push('');
    lines.push('ステージ済み:');
    for (const change of status.stagedChanges) {
      lines.push(`  ${changeCode(change.kind)} ${change.path}`);
    }
  } else {
    lines.push('');
    lines.push('ステージ済み: (なし)');
  }

  if (status.unstagedChanges.length > 0) {
    lines.push('');
    lines.push('未ステージ:');
    for (const change of status.unstagedChanges) {
      lines.push(`  ${changeCode(change.kind)} ${change.path}`);
    }
  } else {
    lines.push('');
    lines.push('未ステージ: (なし)');
  }

  return lines.join('\n');
}

/**
 * @param {object} status
 * @param {{ recoveryRequired?: boolean }} [extra]
 */
function projectVersionStatusJson(status, extra = {}) {
  return {
    schemaVersion: '1.0',
    unborn: status.unborn,
    clean: status.clean,
    headCommit: status.headCommit,
    headRef: status.headRef,
    headShort: status.headCommit ? shortHash(status.headCommit) : null,
    indexRevision: status.indexRevision,
    headChangedSinceIndex: status.headChangedSinceIndex,
    recoveryRequired: Boolean(extra.recoveryRequired),
    stagedChanges: status.stagedChanges.map(projectChange),
    unstagedChanges: status.unstagedChanges.map(projectChange),
  };
}

/**
 * @param {object[]} changes
 * @param {'working'|'staged'} scope
 * @returns {string}
 */
function formatVersionDiffHuman(changes, scope) {
  if (changes.length === 0) {
    return scope === 'staged'
      ? 'ステージ済みの差分はありません。'
      : '作業ツリーの差分はありません。';
  }
  return changes
    .map((change) => `${changeCode(change.kind)} ${change.path}`)
    .join('\n');
}

/**
 * @param {object[]} changes
 * @param {'working'|'staged'} scope
 */
function projectVersionDiffJson(changes, scope) {
  return {
    schemaVersion: '1.0',
    scope,
    changes: changes.map(projectChange),
  };
}

/**
 * @param {object} logResult
 * @returns {string}
 */
function formatVersionLogHuman(logResult) {
  if (!logResult.commits || logResult.commits.length === 0) {
    return 'commit はありません。';
  }
  const blocks = [];
  for (const commit of logResult.commits) {
    const author = commit.author || {};
    const name = author.name || '(unknown)';
    const email = author.email || '';
    blocks.push(
      [
        `commit ${commit.hash}`,
        `Author: ${name}${email ? ` <${email}>` : ''}`,
        `Date:   ${commit.committedAt || ''}`,
        '',
        `    ${(commit.message || '').split(/\r?\n/)[0] || ''}`,
      ].join('\n')
    );
  }
  if (logResult.nextCursor) {
    blocks.push(`次のページ: --cursor ${logResult.nextCursor}`);
  }
  return blocks.join('\n\n');
}

/**
 * @param {object} logResult
 */
function projectVersionLogJson(logResult) {
  return {
    schemaVersion: '1.0',
    commits: (logResult.commits || []).map((commit) => ({
      hash: commit.hash,
      parents: commit.parents || [],
      message: commit.message,
      committedAt: commit.committedAt,
      author: commit.author
        ? { name: commit.author.name, email: commit.author.email }
        : null,
    })),
    nextCursor: logResult.nextCursor ?? null,
  };
}

/**
 * @param {object[]} branches
 * @returns {string}
 */
function formatVersionBranchesHuman(branches) {
  if (!branches.length) return 'branch はありません。';
  return branches
    .map((branch) => {
      const mark = branch.current ? '* ' : '  ';
      const hash = branch.unborn
        ? '(unborn)'
        : shortHash(branch.commitHash);
      return `${mark}${branch.name} ${hash}`;
    })
    .join('\n');
}

/**
 * @param {object[]} tags
 * @returns {string}
 */
function formatVersionTagsHuman(tags) {
  if (!tags.length) return 'tag はありません。';
  return tags
    .map(
      (tag) =>
        `${tag.name} -> ${shortHash(tag.targetCommitHash)}`
    )
    .join('\n');
}

/**
 * @param {object} fsck
 * @param {{ recoveryRequired?: boolean }} [extra]
 * @returns {string}
 */
function formatVersionFsckHuman(fsck, extra = {}) {
  const lines = [
    `検査した object 数: ${fsck.checkedObjects}`,
    `到達可能: ${fsck.reachableObjects}`,
    `dangling: ${fsck.danglingObjects.length}`,
    `warning: ${fsck.warnings.length}`,
    `error: ${fsck.errors.length}`,
    `recovery required: ${extra.recoveryRequired ? 'はい' : 'いいえ'}`,
  ];
  for (const warning of fsck.warnings.slice(0, 20)) {
    lines.push(`  warning: ${warning}`);
  }
  for (const error of fsck.errors.slice(0, 20)) {
    lines.push(`  error: ${error}`);
  }
  return lines.join('\n');
}

/**
 * @param {object} inspection
 */
function projectRecoveryInspectJson(inspection) {
  return {
    schemaVersion: '1.0',
    recoveryRequired: inspection.recoveryRequired,
    mutationLockPresent: Boolean(inspection.mutationLock?.present),
    indexLockPresent: Boolean(inspection.indexLockPresent),
    plans: (inspection.plans || []).map((plan) => ({
      operationId: plan.operationId,
      operation: plan.operation,
      phase: plan.phase,
      headState: plan.headState,
      indexState: plan.indexState,
      sourceState: plan.sourceState,
      recommendedAction: plan.recommendedAction,
    })),
  };
}

/**
 * @param {object} inspection
 * @returns {string}
 */
function formatRecoveryInspectHuman(inspection) {
  const lines = [
    `recovery required: ${inspection.recoveryRequired ? 'はい' : 'いいえ'}`,
    `mutation lock: ${inspection.mutationLock?.present ? 'あり' : 'なし'}`,
    `index lock: ${inspection.indexLockPresent ? 'あり' : 'なし'}`,
  ];
  const plans = inspection.plans || [];
  if (plans.length === 0) {
    lines.push('未完了 transaction: なし');
    return lines.join('\n');
  }
  lines.push(`未完了 transaction: ${plans.length}`);
  for (const plan of plans) {
    lines.push('');
    lines.push(`operationId: ${plan.operationId}`);
    lines.push(`operation: ${plan.operation}`);
    lines.push(`phase: ${plan.phase}`);
    lines.push(`headState: ${plan.headState}`);
    lines.push(`indexState: ${plan.indexState}`);
    lines.push(`sourceState: ${plan.sourceState}`);
    lines.push(`recommendedAction: ${plan.recommendedAction}`);
  }
  return lines.join('\n');
}

module.exports = {
  shortHash,
  changeCode,
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
};
