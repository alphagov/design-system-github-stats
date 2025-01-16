import { describe, it, expect } from 'vitest'
import { Result } from './result.mjs'

describe('Result', () => {
  describe('validate', () => {
    it('should return false if no dependencies and no unknown lock file type', () => {
      const result = new Result('owner', 'repo')
      result.directDependencies = []
      result.indirectDependencies = []
      result.unknownLockFileType = false
      expect(result.validate()).toBe(false)
    })

    it('should return false if errors were thrown during analysis', () => {
      const result = new Result('owner', 'repo')
      result.errorsThrown.push(new Error('Test error'))
      expect(result.validate()).toBe(false)
    })
  })
})
