import neostandard from 'neostandard'
import babelParser from '@babel/eslint-parser'

export default [
  ...neostandard(),
  {
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          plugins: ['@babel/plugin-syntax-import-assertions'],
        },
      },
    },
  },
]
