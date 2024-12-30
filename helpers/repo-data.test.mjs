import { describe, it, expect, vi } from 'vitest'
import {
  RepoData,
  NoMetaDataError,
  NoRepoTreeError,
  NoCommitsError,
} from './repo-data.mjs'
import {
  getFileContent,
  getLatestCommit,
  getRepoMetaData,
  getRepoTree,
} from './octokit.mjs'

// Mock the octokit functions
vi.mock('./octokit.mjs', () => ({
  getFileContent: vi.fn(),
  getLatestCommit: vi.fn(),
  getRepoMetaData: vi.fn(),
  getRepoTree: vi.fn(),
}))

describe('RepoData', () => {
  const repoOwner = 'test-owner'
  const repoName = 'test-repo'
  const serviceOwners = ['test-owner']

  describe('constructor', () => {
    it('should create an instance of RepoData', () => {
      const repoData = new RepoData(repoOwner, repoName)
      expect(repoData.repoOwner).toBe(repoOwner)
      expect(repoData.repoName).toBe(repoName)
    })

    it('should throw an error if repoOwner is not provided', () => {
      expect(() => new RepoData(null, repoName)).toThrow(
        'repoOwner must be provided'
      )
    })

    it('should throw an error if repoName is not provided', () => {
      expect(() => new RepoData(repoOwner, null)).toThrow(
        'repoName must be provided'
      )
    })
  })

  describe('checkDenyList', () => {
    it.each([
      {
        denyList: [{ owner: 'test-owner', name: 'test-repo' }],
        expected: true,
      },
      { denyList: [], expected: false },
    ])(
      'should correctly check if repo is on deny list',
      ({ denyList, expected }) => {
        const repoData = new RepoData(repoOwner, repoName, serviceOwners)
        const isOnDenyList = repoData.checkDenyList(denyList)
        expect(isOnDenyList).toBe(expected)
      }
    )
  })

  describe('fetchAndValidateMetaData', () => {
    it('should throw a NoMetaDataError if metadata is missing', async () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      getRepoMetaData.mockResolvedValue({
        data: {
          pushed_at: null,
          created_at: null,
        },
      })

      await expect(repoData.fetchAndValidateMetaData()).rejects.toThrow(
        NoMetaDataError
      )
    })

    it('should fetch and validate metadata', async () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      getRepoMetaData.mockResolvedValue({
        data: {
          pushed_at: '2023-01-01T00:00:00Z',
          created_at: '2022-01-01T00:00:00Z',
        },
      })

      await repoData.fetchAndValidateMetaData()
      expect(repoData.lastUpdated).toBe('2023-01-01T00:00:00Z')
      expect(repoData.repoCreated).toBe('2022-01-01T00:00:00Z')
    })
  })

  describe('fetchAndValidateRepoTree', () => {
    it('should throw a NoRepoTreeError if metadata is missing', async () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      getRepoMetaData.mockResolvedValue({
        data: {
          pushed_at: null,
          created_at: null,
        },
      })

      await expect(repoData.fetchAndValidateMetaData()).rejects.toThrow(
        NoRepoTreeError
      )
    })

    it('should fetch and validate repo tree', async () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      getLatestCommit.mockResolvedValue({ sha: 'test-sha' })
      getRepoTree.mockResolvedValue({ data: { tree: [] } })

      await repoData.fetchAndValidateRepoTree()
      expect(repoData.repoTree).toEqual({ data: { tree: [] } })
    })
  })

  describe('getLatestCommitSha', () => {
    it('should throw a NoCommitsError if the repo has no commits', async () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      getLatestCommit.mockResolvedValue(undefined)

      await expect(repoData.getLatestCommitSha()).rejects.toThrow(
        NoCommitsError
      )
    })

    it('should get the SHA of the latest commit', async () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      getLatestCommit.mockResolvedValue({ sha: 'test-sha' })

      const sha = await repoData.getLatestCommitSha()
      expect(sha).toBe('test-sha')
    })
  })

  describe('checkPrototype', () => {
    it('should assume prototype if usage_data.js present', async () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      repoData.repoTree = { data: { tree: [{ path: 'lib/usage_data.js' }] } }
      const packageObjects = [
        {
          content: { dependencies: { 'other-dependency': '1.0.0' } },
        },
      ]

      const isPrototype = repoData.checkPrototype(packageObjects)
      expect(isPrototype).toBe(true)
    })

    it('should assume prototype if dependency present', async () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      repoData.repoTree = { data: { tree: [{ path: 'other-file.js' }] } }
      const packageObjects = [
        {
          content: { dependencies: { 'govuk-prototype-kit': '1.0.0' } },
        },
      ]

      const isPrototype = repoData.checkPrototype(packageObjects)
      expect(isPrototype).toBe(true)
    })

    it('should not assume prototype kit if conditions not met', async () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      repoData.repoTree = { data: { tree: [{ path: 'other-file.js' }] } }
      const packageObjects = [
        {
          content: { dependencies: { 'other-dependency': '1.0.0' } },
        },
      ]

      const isPrototype = repoData.checkPrototype(packageObjects)
      expect(isPrototype).toBe(false)
    })
  })

  describe('getAllFilesContent', () => {
    it('should get the content of all files with a given name', async () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      repoData.repoTree = {
        data: {
          tree: [
            { path: 'package.json' },
            { path: 'src/package.json' },
            { path: 'lib/package.json' },
            { path: 'test/package.json' },
          ],
        },
      }
      getFileContent.mockResolvedValue({ data: '{ test: "file content" }' })
      const fileContents = await repoData.getAllFilesContent('package.json')
      expect(fileContents).toEqual([
        { content: '{ test: "file content" }', path: 'package.json' },
        { content: '{ test: "file content" }', path: 'src/package.json' },
        { content: '{ test: "file content" }', path: 'lib/package.json' },
        { content: '{ test: "file content" }', path: 'test/package.json' },
      ])
    })
  })

  it('should get the content of a file in the repo', async () => {
    const repoData = new RepoData(repoOwner, repoName, serviceOwners)
    getFileContent.mockResolvedValue({ data: '{ test: "file content" }' })

    const fileContent = await repoData.getRepoFileContent('package.json')
    expect(fileContent).toEqual({ data: `{ test: "file content" }` })
  })

  it('should check if a file exists in the repo tree', () => {
    const repoData = new RepoData(repoOwner, repoName, serviceOwners)
    repoData.repoTree = { data: { tree: [{ path: 'package.json' }] } }

    const fileExists = repoData.checkFileExists('package.json')
    expect(fileExists).toBe(true)
  })

  it('should log messages consistently', () => {
    const repoData = new RepoData(repoOwner, repoName, serviceOwners)
    const consoleSpy = vi.spyOn(console, 'log')

    repoData.log('test message')
    expect(consoleSpy).toHaveBeenCalledWith(
      'test-owner/test-repo: test message'
    )
  })
})
