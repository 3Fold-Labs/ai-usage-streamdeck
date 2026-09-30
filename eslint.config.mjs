import js from '@eslint/js';
import globals from 'globals';
export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.cache/**',
      'com.3foldlabs.ai-usage.sdPlugin/**',
      'src/generated/**'
    ]
  },
  {
    files: ['scripts/**/*.mjs', '*.mjs'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node
    },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none' }
      ]
    }
  },
  {
    files: ['src/inspector/**/*.js'],
    ...js.configs.recommended,
    languageOptions: { globals: globals.browser },
    rules: {
      'no-undef': 'error',
      'no-shadow': 'error',
      'no-unused-vars': ['error', { caughtErrors: 'none' }]
    }
  }
];
