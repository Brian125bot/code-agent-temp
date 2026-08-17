import { vi } from 'vitest'

// Mock Drizzle ORM query builder
export function createMockDb() {
  const chainable = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    // Resolves to an array by default
    then: (resolve: (value: unknown[]) => unknown) => resolve([]),
  }

  // Make it thenable (Promise-like)
  const db = new Proxy(chainable, {
    get(target, prop) {
      if (prop === 'then') {
        return (resolve: (value: unknown[]) => unknown) => resolve([])
      }
      return target[prop as keyof typeof target]
    },
  })

  return db
}

// Mock for db.select().from().where().limit() returning specific data
export function mockDbSelectResult(data: unknown[]) {
  const chainable = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => Promise.resolve(data)),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockImplementation(() => Promise.resolve()),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockImplementation(() => Promise.resolve()),
    delete: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
  }

  return chainable
}
