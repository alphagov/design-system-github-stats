module.exports = {
  opts: {
    destination: './jsdoc',
    recurse: true
  },
  source: {
    include: [
      './build-filtered-data.mjs',
      './helpers/repo-data.mjs',
      './helpers/octokit.mjs'
    ],
    includePattern: '.+\\.m?js$',
    excludePattern: '.+\\.test.m?js$'
  },
  templates: {
    cleverLinks: true
  }
}
