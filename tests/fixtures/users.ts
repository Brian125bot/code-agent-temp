import type { User } from '@/lib/db/schema'

export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user_test123',
    provider: 'github',
    externalId: '12345678',
    accessToken: 'encrypted_access_token',
    refreshToken: null,
    scope: 'repo',
    username: 'testuser',
    email: 'test@example.com',
    name: 'Test User',
    avatarUrl: 'https://avatars.githubusercontent.com/u/12345678',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    lastLoginAt: new Date('2024-01-01'),
    ...overrides,
  }
}

export function createMockVercelUser(overrides: Partial<User> = {}): User {
  return createMockUser({
    provider: 'vercel',
    externalId: 'usr_abc123',
    username: 'verceluser',
    ...overrides,
  })
}

export const MOCK_USERS = {
  github: createMockUser(),
  vercel: createMockVercelUser(),
}
