import globals from 'globals'
import pluginJs from '@eslint/js'

export default [
  { ignores: ['node_modules/**', 'pyenv/**'] },
  pluginJs.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      // Deliberately unused bindings are prefixed with an underscore.
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: { globals: { ...globals.mocha } },
  },
]
