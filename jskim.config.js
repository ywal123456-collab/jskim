/**
 * JSKim 設定ファイル
 *
 * パスの基準:
 * - sourceDir / outputDir → ワークスペースルート（このファイルの場所）
 * - files[].from / templates[] → sourceDir 基準
 * - files[].to → outputDir 基準
 *
 * files pipeline:
 * - *.njk は末尾の .njk だけを外してレンダリング
 * - それ以外のファイルはそのままコピー
 * - templates[] 配下は直接出力せず、extends / include 用に使う
 */
module.exports = {
  // 各プロジェクトに共通で適用されるデフォルト設定
  defaults: {
    // pages 配下の HTML / CSS / JS / 画像をまとめて処理する
    files: [{ from: 'pages', to: '' }],

    // Nunjucks の追加検索パス（sourceDir 配下）
    templates: ['layouts', 'components'],

    // 全テンプレートへ渡す共通データ
    data: {
      site: {
        name: 'JSKim UI Sample',
        language: 'ja',
        themeColor: '#222222',
      },
      samplePrice: 12000,
    },

    // Nunjucks のカスタム filter / global
    nunjucks: {
      filters: {
        formatPrice(value) {
          return `${Number(value).toLocaleString('ja-JP')}円`;
        },
        toJson(value) {
          const nunjucks = require('nunjucks');
          return new nunjucks.runtime.SafeString(JSON.stringify(value));
        },
      },
      globals: {
        currentYear() {
          return new Date().getFullYear();
        },
      },
    },

    build: {
      // ビルド前に outputDir を削除する
      clean: true,
    },

    // ウォッチ: 最後の変更から指定ミリ秒待ってから再ビルド
    watch: {
      debounce: 150,
    },

    // ローカル確認用の静的サーバー設定
    serve: {
      host: '127.0.0.1',
      port: 3000,
    },

    // 開発サーバー（build + watch + serve）設定
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
