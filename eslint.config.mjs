import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'

/**
 * ESLint 9 flat config for Next.js 16.
 *
 * `next lint` was removed in Next 16, so linting now runs through the ESLint
 * CLI directly (see the `lint` script in package.json). `eslint-config-next`
 * ships native flat-config arrays, so we spread them in directly — no
 * `FlatCompat` / `.eslintrc` shim needed.
 */
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'node_modules/**',
      'next-env.d.ts',
    ],
  },
  {
    // The React Compiler lint rules (shipped as errors by eslint-config-next 16)
    // flag patterns that are safe at runtime but not yet Compiler-ready. Keep
    // them as warnings so the lint gate stays green while we migrate these
    // call sites incrementally.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
  {
    // Honor the underscore-throwaway convention and rest-sibling key omission
    // (e.g. `const { secret: _s, ...rest } = row`) instead of flagging them.
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
]

export default eslintConfig
