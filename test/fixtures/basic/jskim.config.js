/**
 * テスト用 fixture 設定
 */
module.exports = {
  defaults: {
    render: [
      {
        from: 'pages',
        to: '',
        include: ['**/*.njk'],
        extension: '.html',
      },
    ],
    templates: ['layouts', 'components'],
    copy: [
      {
        from: 'assets',
        to: 'assets',
      },
    ],
    build: {
      clean: true,
    },
    watch: {
      debounce: 100,
    },
    serve: {
      host: '127.0.0.1',
      port: 3000,
    },
    dev: {
      liveReload: true,
    },
  },
  projects: {
    sample: {
      sourceDir: 'src/sample',
      outputDir: 'dist/sample',
    },
  },
};
