import { describe, it, expect, vi } from 'vitest'
import { analyseRepo } from './build-filtered-data.mjs'

vi.mock('./helpers/repo-data.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    fetchAndValidateMetaData: vi.fn(),
    fetchAndValidateRepoTree: vi.fn(),
    getAllFilesContent: vi.fn(),
    checkPrototype: vi.fn(),
    getVersionFromLockfile: vi.fn(),
    getResult: vi.fn(),
    handleError: vi.fn(),
  }
})

describe('analyseRepo', () => {
  it('should return null if repo is on deny list', async () => {
    const repo = { owner: 'alphagov', repo_name: 'govuk-frontend' }

    const result = await analyseRepo(repo)
    expect(result).toBeNull()
  })
})
