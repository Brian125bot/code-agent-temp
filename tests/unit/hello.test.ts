import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('HELLO.md', () => {
  it('exists in root directory and contains Hello World text', () => {
    const helloPath = path.join(process.cwd(), 'HELLO.md')
    expect(fs.existsSync(helloPath)).toBe(true)
    const content = fs.readFileSync(helloPath, 'utf8')
    expect(content.trim()).toBe('Hello World')
  })
})
