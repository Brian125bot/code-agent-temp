import type { TaskMessage } from '@/lib/db/schema'

export function createMockTaskMessage(overrides: Partial<TaskMessage> = {}): TaskMessage {
  return {
    id: 'msg_test123',
    taskId: 'task_test123',
    role: 'user',
    content: 'Add authentication to the app',
    createdAt: new Date('2024-01-01'),
    ...overrides,
  }
}

export function createMockAgentMessage(overrides: Partial<TaskMessage> = {}): TaskMessage {
  return createMockTaskMessage({
    id: 'msg_agent123',
    role: 'agent',
    content: 'I will add authentication to the app using NextAuth.js.',
    ...overrides,
  })
}

export const MOCK_MESSAGES = {
  user: createMockTaskMessage(),
  agent: createMockAgentMessage(),
  conversation: [
    createMockTaskMessage({ id: 'msg_1', content: 'Add auth' }),
    createMockAgentMessage({ id: 'msg_2', content: 'I will add auth.' }),
    createMockTaskMessage({ id: 'msg_3', content: 'Use GitHub OAuth' }),
    createMockAgentMessage({ id: 'msg_4', content: 'Configuring GitHub OAuth.' }),
  ],
}
