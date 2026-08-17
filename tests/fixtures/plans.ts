export function createMockPlan(overrides: Record<string, unknown> = {}) {
  return {
    goal: 'Add user authentication with GitHub OAuth',
    assumptions: ['Using NextAuth.js', 'GitHub OAuth provider configured'],
    steps: [
      { description: 'Install NextAuth.js', files: ['package.json'] },
      { description: 'Create auth configuration', files: ['lib/auth.ts'] },
      { description: 'Add login page', files: ['app/login/page.tsx'] },
    ],
    ...overrides,
  }
}

export const MOCK_PLANS = {
  simple: createMockPlan(),
  autoFix: createMockPlan({
    goal: 'Fix CI failure',
    steps: [
      { description: 'Identify failing test', files: ['tests/app.test.ts'] },
      { description: 'Fix the test', files: ['tests/app.test.ts'] },
      { description: 'Verify fix', files: [] },
    ],
  }),
  complex: createMockPlan({
    goal: 'Implement real-time notifications',
    assumptions: ['Using WebSocket', 'Redis for pub/sub'],
    steps: Array.from({ length: 8 }, (_, i) => ({
      description: `Step ${i + 1}: Implementation task`,
      files: [`src/step-${i + 1}.ts`],
    })),
  }),
}
