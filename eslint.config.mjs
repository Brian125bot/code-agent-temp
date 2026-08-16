import nextPlugin from 'eslint-config-next'

const eslintConfig = [
  {
    ignores: ['node_modules/**', '.next/**', 'out/**', 'build/**', 'next-env.d.ts'],
  },
  {
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  ...nextPlugin,
]

export default eslintConfig
