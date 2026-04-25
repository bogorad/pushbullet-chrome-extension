import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        ...globals.webextensions,
        importScripts: 'readonly',
        chrome: 'readonly',
        DEBUG_CONFIG: 'writable',
        DebugConfigManager: 'readonly',
        connectWebSocket: 'readonly',
        createNotificationWithTimeout: 'readonly',
        sessionCache: 'writable',
        deviceIden: 'writable',
        apiKey: 'writable',
        websocket: 'writable',
        reconnectAttempts: 'writable',
        reconnectTimeout: 'writable'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      indent: ['warn', 2],
      'linebreak-style': 0,
      quotes: 0,
      semi: ['error', 'always'],
      'no-unused-vars': 'off',
      'no-unused-expressions': 'off',
      'no-console': 'off',
      'no-undef': 'warn',
      'no-redeclare': 'warn',
      'no-global-assign': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowShortCircuit: true, allowTernary: true }
      ]
    }
  },
  {
    files: [
      'src/background/**/*.ts',
      'src/lib/security/**/*.ts',
      'src/lib/logging/**/*.ts'
    ],
    rules: {
      'no-undef': 'error',
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  }
];
