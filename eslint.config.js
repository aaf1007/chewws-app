const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'ios/*', 'android/*', '.expo/*', 'src/data/database.types.ts'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    },
  },
  {
    // Tests drive the app through data-layer actions only (spec: Testing Decisions).
    files: ['tests/**/*.{ts,tsx}'],
    ignores: ['tests/harness.ts', 'tests/global-setup.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='from']:not([callee.object.name=/^(Array|Buffer|Object|Promise|Uint8Array)$/])",
          message: 'Tests may not query tables. Call a data-layer action instead.',
        },
        {
          selector: "CallExpression[callee.property.name='rpc']",
          message: 'Tests may not call RPCs directly. Call a data-layer action instead.',
        },
      ],
    },
  },
  {
    // Screens and components draw with src/ui: colour roles and Text variants, never raw values.
    files: ['src/app/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i]',
          message: 'No raw colours in screens. Use a colour role from src/ui (colors.accent).',
        },
        {
          selector: 'Literal[value=/^(?:rgba?|hsla?)\\(/i]',
          message: 'No raw colours in screens. Use a colour role from src/ui (colors.accent).',
        },
        {
          selector: 'TemplateElement[value.raw=/(?:^|[^\\w&])#[0-9a-f]{3,8}\\b|(?:rgba?|hsla?)\\(/i]',
          message: 'No raw colours in screens. Use a colour role from src/ui (colors.accent).',
        },
        {
          selector:
            "Property:matches([key.name='fontSize'], [key.value='fontSize']):matches([value.type='Literal'], [value.type='UnaryExpression'], [value.type='BinaryExpression'])",
          message: 'No font sizes in screens. Use <Text variant="..."> from src/ui.',
        },
      ],
    },
  },
  {
    ignores: ['src/data/**', 'tests/harness.ts', 'tests/global-setup.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@supabase/*'],
              message:
                'Only src/data talks to Supabase. Import the action you need from src/data instead.',
            },
          ],
        },
      ],
    },
  },
]);
