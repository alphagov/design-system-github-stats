import globals from 'globals'
import pluginJs from '@eslint/js'
import babelParser from '@babel/eslint-parser'

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    languageOptions: {
      globals: globals.node,
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          plugins: ['@babel/plugin-syntax-import-assertions'],
        },
      },
    },
  },
  pluginJs.configs.recommended,
]
