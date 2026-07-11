/**
 * JSKim 設定ファイル
 *
 * パスの基準:
 * - sourceDir / outputDir → ワークスペースルート（このファイルの場所）
 * - render[].from, templates[], copy[].from → sourceDir 基準
 * - render[].to, copy[].to → outputDir 基準
 *
 * マージ規則:
 * - スカラー / オブジェクト: プロジェクト設定が優先（必要な範囲で shallow merge）
 * - 配列: プロジェクト側の配列が defaults を丸ごと置き換え
 */
module.exports = {
  // 各プロジェクトに共通で適用されるデフォルト設定
  defaults: {
    // Nunjucks で HTML にレンダリングする対象
    render: [
      {
        from: 'pages', // sourceDir 配下
        to: '', // outputDir 配下（'' は出力ルート）
        include: ['**/*.njk'],
        extension: '.html',
      },
    ],

    // Nunjucks の追加検索パス（sourceDir 配下）
    templates: [
      'layouts',
      'components',
    ],

    // 変換せずにコピーする静的ファイル
    copy: [
      {
        from: 'assets',
        to: 'assets',
      },
    ],

    build: {
      // ビルド前に outputDir を削除する
      clean: true,
    },

    // ウォッチ: 最後の変更から指定ミリ秒待ってから再ビルド
    watch: {
      debounce: 150,
    },

    // ローカル確認用の静的サーバー設定です。
    serve: {
      host: '127.0.0.1',
      port: 3000,
    },

    // 開発サーバー（build + watch + serve）設定です。
    // host / port / debounce は serve / watch を再利用します。
    dev: {
      liveReload: true,
    },
  },

  // 名前付きプロジェクト: npm run build -- <name>
  projects: {
    sample: {
      sourceDir: 'src/sample',
      outputDir: 'dist/sample',
    },
  },
};
