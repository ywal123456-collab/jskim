'use strict';

/**
 * defaults とプロジェクト設定をマージします。
 *
 * - スカラー: プロジェクト側があれば優先
 * - オブジェクト (build / watch / serve / dev): 1段階の shallow merge
 * - 配列 (render / templates / copy): プロジェクト側配列が defaults を丸ごと置き換え
 *
 * 元の defaults / プロジェクトオブジェクトは変更しません。
 *
 * @param {object} defaults
 * @param {object} project
 * @returns {object}
 */
function mergeConfig(defaults, project) {
  const base = defaults && typeof defaults === 'object' ? defaults : {};
  const override = project && typeof project === 'object' ? project : {};

  const merged = {
    sourceDir: pickScalar(override.sourceDir, base.sourceDir),
    outputDir: pickScalar(override.outputDir, base.outputDir),
    render: pickArray(override.render, base.render, []),
    templates: pickArray(override.templates, base.templates, []),
    copy: pickArray(override.copy, base.copy, []),
    build: mergeBuild(base.build, override.build),
    watch: mergeWatch(base.watch, override.watch),
    serve: mergeServe(base.serve, override.serve),
    dev: mergeDev(base.dev, override.dev),
  };

  return {
    sourceDir: merged.sourceDir,
    outputDir: merged.outputDir,
    render: merged.render.map((rule) => ({ ...rule })),
    templates: [...merged.templates],
    copy: merged.copy.map((rule) => ({ ...rule })),
    build: { ...merged.build },
    watch: { ...merged.watch },
    serve: { ...merged.serve },
    dev: { ...merged.dev },
  };
}

function pickScalar(projectValue, defaultValue) {
  return projectValue !== undefined ? projectValue : defaultValue;
}

function pickArray(projectValue, defaultValue, fallback) {
  if (Array.isArray(projectValue)) {
    return projectValue.slice();
  }
  if (Array.isArray(defaultValue)) {
    return defaultValue.slice();
  }
  return fallback.slice();
}

function mergeBuild(defaultBuild, projectBuild) {
  const base =
    defaultBuild && typeof defaultBuild === 'object' ? defaultBuild : {};
  const override =
    projectBuild && typeof projectBuild === 'object' ? projectBuild : {};

  return {
    clean:
      override.clean !== undefined
        ? Boolean(override.clean)
        : base.clean !== undefined
          ? Boolean(base.clean)
          : true,
  };
}

function mergeWatch(defaultWatch, projectWatch) {
  const base =
    defaultWatch && typeof defaultWatch === 'object' ? defaultWatch : {};
  const override =
    projectWatch && typeof projectWatch === 'object' ? projectWatch : {};

  return {
    debounce:
      override.debounce !== undefined
        ? override.debounce
        : base.debounce !== undefined
          ? base.debounce
          : 150,
  };
}

function mergeServe(defaultServe, projectServe) {
  const base =
    defaultServe && typeof defaultServe === 'object' ? defaultServe : {};
  const override =
    projectServe && typeof projectServe === 'object' ? projectServe : {};

  return {
    host:
      override.host !== undefined
        ? override.host
        : base.host !== undefined
          ? base.host
          : '127.0.0.1',
    port:
      override.port !== undefined
        ? override.port
        : base.port !== undefined
          ? base.port
          : 3000,
  };
}

function mergeDev(defaultDev, projectDev) {
  const base = defaultDev && typeof defaultDev === 'object' ? defaultDev : {};
  const override =
    projectDev && typeof projectDev === 'object' ? projectDev : {};

  return {
    liveReload:
      override.liveReload !== undefined
        ? override.liveReload
        : base.liveReload !== undefined
          ? base.liveReload
          : true,
  };
}

module.exports = {
  mergeConfig,
};
