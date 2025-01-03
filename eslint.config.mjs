import neostandard from 'neostandard'
import babelParser from '@babel/eslint-parser'

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...neostandard({}),
  {
    languageOptions: {
      // We need Babel to parse the import assertions.
      // This will likely change since these are stage 4 proposals, and neostandard
      // should soon support them natively.
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false
      }
    },
    rules: {
      // neostandard relaxes the comma-dangle rule, but we prefer not to
      '@stylistic/comma-dangle': ['error', 'never']
    }
  }
]
