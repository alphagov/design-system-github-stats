import { describe, it, expect, vi } from 'vitest'
import { RepoData, NoMetaDataError, NoRepoTreeError, NoCommitsError, UnsupportedLockFileError } from './repo-data.mjs'
import {
  getFileContent,
  getRepoTree,
  getRepoInfo
} from './octokit.mjs'

// Mock the octokit functions
vi.mock('./octokit.mjs', () => ({
  getFileContent: vi.fn(),
  getRepoInfo: vi.fn(),
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

  describe('fetchAndValidateRepoInfo', () => {
    it('should throw a NoMetaDataError if metadata is missing', async () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      getRepoInfo.mockResolvedValue({
        data: {
          repository: {
            createdAt: '2022-01-01T00:00:00Z',
            pushedAt: '2023-01-01T00:00:00Z'
          }
        }
      })

      await expect(repoData.fetchAndValidateRepoInfo()).rejects.toThrow(
        NoMetaDataError
      )
    })

    it('should throw a NoCommitsError if no latest commit', async () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      getRepoInfo.mockResolvedValue({
        repository: {
          createdAt: '2022-01-01T00:00:00Z',
          pushedAt: '2023-01-01T00:00:00Z'
        }
      })

      await expect(repoData.fetchAndValidateRepoInfo()).rejects.toThrow(
        NoCommitsError
      )
    })

    it('should fetch and validate repo info', async () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      getRepoInfo.mockResolvedValue({
        repository: {
          createdAt: '2022-01-01T00:00:00Z',
          pushedAt: '2023-01-01T00:00:00Z',
          defaultBranchRef: {
            target: {
              oid: 'test-sha'
            }
          }
        }
      })

      await repoData.fetchAndValidateRepoInfo()
      expect(repoData.lastUpdated).toBe('2023-01-01T00:00:00Z')
      expect(repoData.repoCreated).toBe('2022-01-01T00:00:00Z')
      expect(repoData.latestCommitSHA).toBe('test-sha')
    })
  })

  describe('fetchAndValidateRepoTree', () => {
    it('should throw a NoRepoTreeError if repo tree is missing', async () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      repoData.latestCommitSHA = 'test-sha'
      getRepoTree.mockResolvedValue({
        data: {
          tree: null,
        },
      })

      await expect(repoData.fetchAndValidateRepoTree()).rejects.toThrow(
        NoRepoTreeError
      )
    })

    it('should fetch and validate repo tree', async () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      getRepoTree.mockResolvedValue({ data: { tree: [] } })

      await repoData.fetchAndValidateRepoTree()
      expect(repoData.repoTree).toEqual({ data: { tree: [] } })
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

  describe('getLockfileType', () => {
    it('should return package-lock.json if it exists', () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      repoData.repoTree = { data: { tree: [{ path: 'package-lock.json' }] } }

      const lockfileType = repoData.getLockfileType()
      expect(lockfileType).toBe('package-lock.json')
    })

    it('should return yarn.lock if it exists', () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      repoData.repoTree = { data: { tree: [{ path: 'yarn.lock' }] } }

      const lockfileType = repoData.getLockfileType()
      expect(lockfileType).toBe('yarn.lock')
    })

    it('should throw UnsupportedLockFileError if no supported lockfile exists', () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      repoData.repoTree = { data: { tree: [{ path: 'other-file.lock' }] } }

      expect(() => repoData.getLockfileType()).toThrow(UnsupportedLockFileError)
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
  describe('checkDirectDependency', () => {
    it('should detect direct dependency on govuk-frontend', () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      const packageObjects = [
        {
          content: { dependencies: { 'govuk-frontend': '3.11.0' } },
          path: 'package.json',
        },
      ]

      const hasDirectDependency = repoData.checkDirectDependency(packageObjects)
      expect(hasDirectDependency).toBe(true)
      expect(repoData.frontendVersions).toEqual([
        { packagePath: 'package.json', frontendVersion: '3.11.0' },
      ])
    })

    it('should detect indirect dependency on govuk-frontend', () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      const packageObjects = [
        {
          content: { dependencies: { 'other-dependency': '1.0.0' } },
          path: 'package.json',
        },
      ]

      const hasDirectDependency = repoData.checkDirectDependency(packageObjects)
      expect(hasDirectDependency).toBe(false)
      expect(repoData.indirectDependency).toBe(true)
    })
  })
  describe('getVersionFromLockfile', () => {
    it('should get version from package-lock.json if ambiguous version in package.json', async () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      repoData.frontendVersions = [{ packagePath: 'package.json', frontendVersion: '3.11.0' }]
      const lockfileContent = {
        data: JSON.stringify({
          packages: {
            'node_modules/govuk-frontend': { version: '3.11.0' },
          },
        }),
      }
      getFileContent.mockResolvedValue(lockfileContent)

      const version = await repoData.getVersionFromLockfile('package-lock.json')
      expect(version).toBe('3.11.0')
    })

    it('should get version from package-lock.json if no versions in package.json', async () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      const lockfileContent = {
        data: JSON.stringify(
          {
            packages: {
              'parent-dependency': {
                dependencies: {
                  'govuk-frontend': { version: '3.11.0' },
                },
              }
            }
          }),
      }
      getFileContent.mockResolvedValue(lockfileContent)

      const version = await repoData.getVersionFromLockfile('package-lock.json')
      expect(version).toBe('3.11.0')
    })

    it('should get version from yarn.lock', async () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      const lockfileContent = {
        data: `
govuk-frontend@^3.11.0:
  version "3.11.0"
  resolved "https://registry.yarnpkg.com/govuk-frontend/-/govuk-frontend-3.11.0.tgz#hash"
  integrity sha512-hash
`
      }
      getFileContent.mockResolvedValue(lockfileContent)

      const version = await repoData.getVersionFromLockfile('yarn.lock')
      expect(version).toBe('3.11.0')
    })
  })
  describe('handleError', () => {
    it('should log NoMetaDataError', () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      const consoleSpy = vi.spyOn(console, 'log')
      const error = new NoMetaDataError()

      repoData.handleError(error)
      expect(consoleSpy).toHaveBeenCalledWith(
        "test-owner/test-repo: ERROR: couldn't fetch metadata"
      )
    })

    it('should log NoCommitsError', () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      const consoleSpy = vi.spyOn(console, 'log')
      const error = new NoCommitsError()

      repoData.handleError(error)
      expect(consoleSpy).toHaveBeenCalledWith(
        "test-owner/test-repo: ERROR: couldn't fetch repo tree as repo has no commits"
      )
    })

    it('should log NoRepoTreeError', () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      const consoleSpy = vi.spyOn(console, 'log')
      const error = new NoRepoTreeError()

      repoData.handleError(error)
      expect(consoleSpy).toHaveBeenCalledWith(
        "test-owner/test-repo: ERROR: couldn't fetch repo tree"
      )
    })

    it('should log UnsupportedLockFileError', () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      const consoleSpy = vi.spyOn(console, 'log')
      const error = new UnsupportedLockFileError()

      repoData.handleError(error)
      expect(consoleSpy).toHaveBeenCalledWith(
        "test-owner/test-repo: ERROR: couldn't find a supported lockfile. Skipping version check."
      )
    })

    it('should rethrow unknown errors', () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      const error = new Error('Unknown error')

      expect(() => repoData.handleError(error)).toThrow('Unknown error')
    })
  })
  describe('getResult', () => {
    it('should return the result of the analysis', () => {
      const repoData = new RepoData(repoOwner, repoName, serviceOwners)
      repoData.couldntAccess = true
      repoData.lockfileFrontendVersion = '3.11.0'
      repoData.versionDoubt = true
      repoData.builtByGovernment = true
      repoData.indirectDependency = true
      repoData.isPrototype = true
      repoData.lastUpdated = '2023-01-01T00:00:00Z'
      repoData.repoCreated = '2022-01-01T00:00:00Z'
      repoData.parentDependency = [{ parent: 'test-parent', version: '1.0.0' }]
      repoData.errorThrown = 'Some error'

      const result = repoData.getResult()
      expect(result).toEqual({
        repoOwner: 'test-owner',
        repoName: 'test-repo',
        couldntAccess: true,
        lockfileFrontendVersion: '3.11.0',
        directDependencyVersions: [],
        versionDoubt: true,
        builtByGovernment: true,
        indirectDependency: true,
        isPrototype: true,
        lastUpdated: '2023-01-01T00:00:00Z',
        repoCreated: '2022-01-01T00:00:00Z',
        parentDependency: [{ parent: 'test-parent', version: '1.0.0' }],
        errorThrown: 'Some error',
      })
    })
  })

  it('should get the content of a file in the repo', async () => {
    const repoData = new RepoData(repoOwner, repoName, serviceOwners)
    getFileContent.mockResolvedValue({ data: '{ test: "file content" }' })

    const fileContent = await repoData.getRepoFileContent('package.json')
    expect(fileContent).toEqual({ data: '{ test: "file content" }' })
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
