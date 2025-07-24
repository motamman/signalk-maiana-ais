module.exports = {
  env: {
    node: true,
    es2020: true
  },
  extends: [
    'eslint:recommended'
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module'
  },
  rules: {
    'prefer-const': 'error',
    'no-console': 'warn',
    'no-unused-vars': 'off' // Disable base rule for TypeScript
  },
  overrides: [
    {
      files: ['**/*.ts'],
      rules: {
        'no-undef': 'off' // TypeScript handles this
      }
    }
  ]
};