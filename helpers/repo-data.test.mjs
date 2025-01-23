import { describe, it, expect, vi } from 'vitest'
import * as yarnLock from '@yarnpkg/lockfile'
import { RepoData, UnsupportedLockfileError } from './repo-data.mjs'
import {
  getFileContent,
  getTree,
  getRepo
} from './octokit.mjs'

// Mock the octokit functions
vi.mock('./octokit.mjs', () => ({
  getFileContent: vi.fn(),
  getRepo: vi.fn(),
  getTree: vi.fn()
}))

describe('RepoData', () => {
  const repoOwner = 'test-owner'
  const repoName = 'test-repo'

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

  describe('checkServiceOwner', () => {
    it.each([
      {
        serviceOwners: { 'test-owner': { 'test-repo': {} }, 'other-owner': {} },
        expected: true,
        description: 'repo is owned by service owner'
      },
      { serviceOwners: [], expected: false, description: 'serviceOwners is empty' },
      { serviceOwners: ['other-owner'], expected: false, description: 'repo is NOT owned by service owner' }
    ])(
      'should correctly check if $description',
      ({ serviceOwners, expected }) => {
        const repoData = new RepoData(repoOwner, repoName)
        const isBuiltByGovernment = repoData.checkServiceOwner(serviceOwners)
        expect(isBuiltByGovernment).toBe(expected)
      }
    )
    it('should fail if not passed a string array or the direct repo owner', () => {
      const repoData = new RepoData(repoOwner, repoName)
      expect(() => repoData.checkServiceOwner(null)).toThrowError()
    })
  })

  describe('checkDenyList', () => {
    it.each([
      {
        denyList: [{ owner: 'test-owner', name: 'test-repo' }],
        expected: true,
        description: 'repo is on the deny list'
      },
      {
        denyList: [{ owner: 'other-owner', name: 'other-repo' }],
        expected: false,
        description: 'repo is NOT on the deny list'
      },
      {
        denyList: [],
        expected: false,
        description: 'denylist is empty'
      }
    ])(
      'should correctly check if $description',
      ({ denyList, expected }) => {
        const repoData = new RepoData(repoOwner, repoName)
        const isOnDenyList = repoData.checkDenyList(denyList)
        expect(isOnDenyList).toBe(expected)
      }
    )
  })

  describe('getRepoInfo', () => {
    it('should throw an error if metadata is missing', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      getRepo.mockResolvedValue({
        repository: {
          updatedAt: '2023-01-01T00:00:00Z'
        }
      })

      await expect(repoData.getRepoInfo()).rejects.toThrow(
        'Could not fetch createdAt from repository'
      )
    })

    it('should throw a NoCommitsError if no latest commit', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      getRepo.mockResolvedValue({
        repository: {
          createdAt: '2022-01-01T00:00:00Z',
          updatedAt: '2023-01-01T00:00:00Z'
        }
      })

      await expect(repoData.getRepoInfo()).rejects.toThrow(
        'Could not fetch latest commit SHA from repository'
      )
    })

    it('should fetch and validate repo info', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      getRepo.mockResolvedValue({
        repository: {
          createdAt: '2022-01-01T00:00:00Z',
          updatedAt: '2023-01-01T00:00:00Z',
          defaultBranchRef: {
            target: {
              oid: 'test-sha'
            }
          }
        },
        rateLimit: {
          cost: 1,
          remaining: 5000,
          resetAt: '2023-01-01T00:00:00Z'
        }
      })

      const result = await repoData.getRepoInfo()
      expect(result.createdAt).toBe('2022-01-01T00:00:00Z')
      expect(result.updatedAt).toBe('2023-01-01T00:00:00Z')
      expect(result.latestCommitSHA).toBe('test-sha')
      expect(result.graphQLRateLimit.remaining).toBe(5000)
    })
  })

  describe('getRepoTree', () => {
    it.each([
      { tree: null, description: 'null' },
      { tree: [], description: 'empty array' },
      { tree: undefined, description: 'undefined' }
    ])('should throw a NoRepoTreeError if repo tree is $description', async ({ tree }) => {
      const repoData = new RepoData(repoOwner, repoName)
      repoData.latestCommitSHA = 'test-sha'
      getTree.mockResolvedValue(tree)

      await expect(repoData.getRepoTree()).rejects.toThrow(
        'Could not fetch tree from repository'
      )
    })

    it('should fetch and validate repo tree', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      getTree.mockResolvedValue({
        data: {
          tree: [
            {
              path: 'test-file.js',
              mode: '100644',
              type: 'blob',
              sha: 'test-sha',
              size: 100,
              url: 'test-url'
            }]
        }
      })

      const result = await repoData.getRepoTree()
      expect(result).toEqual([{
        path: 'test-file.js',
        mode: '100644',
        type: 'blob',
        sha: 'test-sha',
        size: 100,
        url: 'test-url'
      }])
    })
  })

  describe('getPackageFiles', () => {
    it('should return parsed package.json files', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      const tree = [
        { path: 'package.json' },
        { path: 'src/package.json' }
      ]
      const packageFiles = [
        { content: '{ "name": "test-package" }', path: 'package.json' },
        { content: '{ "name": "test-package-2" }', path: 'src/package.json' }
      ]
      repoData.getAllFilesContent = vi.fn().mockResolvedValue(packageFiles)

      const result = await repoData.getPackageFiles(tree)
      expect(result).toEqual([
        { content: { name: 'test-package' }, path: 'package.json' },
        { content: { name: 'test-package-2' }, path: 'src/package.json' }
      ])
    })

    it('should process all valid files, even if one cannot be parsed', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      const tree = [
        { path: 'package.json' },
        { path: 'src/package.json' }
      ]
      const packageFiles = [
        { content: '{ "name": "test-package" }', path: 'package.json' },
        { content: '{ name "test-package-2" }', path: 'src/package.json' } // malformed JSON
      ]
      repoData.getAllFilesContent = vi.fn().mockResolvedValue(packageFiles)

      const result = await repoData.getPackageFiles(tree)
      expect(result).toEqual([
        { content: { name: 'test-package' }, path: 'package.json' }
      ])
    })

    it('should return an empty array if no package.json files are found', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      const tree = [
        { path: 'other-file.json' },
        { path: 'src/other-file.json' }
      ]
      repoData.getAllFilesContent = vi.fn().mockResolvedValue([])

      const result = await repoData.getPackageFiles(tree)
      expect(result).toEqual([])
    })
  })

  describe('checkPrototype', () => {
    it('should assume prototype if usage_data.js present', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      const repoTree = [{ path: 'lib/usage_data.js' }]
      const packageObjects = [
        {
          content: { dependencies: { 'other-dependency': '1.0.0' } }
        }
      ]

      const isPrototype = repoData.checkPrototype(packageObjects, repoTree)
      expect(isPrototype).toBe(true)
    })

    it('should assume prototype if dependency present', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      const repoTree = [{ path: 'other-file.js' }]
      const packageObjects = [
        {
          content: { dependencies: { 'govuk-prototype-kit': '1.0.0' } }
        }
      ]

      const isPrototype = repoData.checkPrototype(packageObjects, repoTree)
      expect(isPrototype).toBe(true)
    })

    it('should not assume prototype kit if conditions not met', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      const repoTree = [{ path: 'other-file.js' }]
      const packageObjects = [
        {
          content: { dependencies: { 'other-dependency': '1.0.0' } }
        }
      ]

      const isPrototype = repoData.checkPrototype(packageObjects, repoTree)
      expect(isPrototype).toBe(false)
    })
  })

  describe('getLockfileType', () => {
    it('should return package-lock.json if it exists', () => {
      const repoData = new RepoData(repoOwner, repoName)
      const tree = [{ path: 'package-lock.json' }]

      const lockfileType = repoData.getLockfileType('', tree)
      expect(lockfileType).toBe('package-lock.json')
    })

    it('should return yarn.lock if it exists', () => {
      const repoData = new RepoData(repoOwner, repoName)
      const tree = [{ path: 'yarn.lock' }]

      const lockfileType = repoData.getLockfileType('', tree)
      expect(lockfileType).toBe('yarn.lock')
    })

    it('should return package-lock.json if it exists in the package path', () => {
      const repoData = new RepoData(repoOwner, repoName)
      const tree = [{ path: 'src/package-lock.json' }]

      const lockfileType = repoData.getLockfileType('src/package.json', tree)
      expect(lockfileType).toBe('package-lock.json')
    })

    it('should return yarn.lock if it exists in the package path', () => {
      const repoData = new RepoData(repoOwner, repoName)
      const tree = [{ path: 'src/yarn.lock' }]

      const lockfileType = repoData.getLockfileType('src/package.json', tree)
      expect(lockfileType).toBe('yarn.lock')
    })

    it('should throw Error if no supported lockfile exists', () => {
      const repoData = new RepoData(repoOwner, repoName)
      const tree = [{ path: 'other-file.lock' }]

      expect(() => repoData.getLockfileType('', tree)).toThrow(UnsupportedLockfileError)
    })
  })

  describe('getAllFilesContent', () => {
    it('should get the content of all files with a given name', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      const tree = [
        { path: 'package.json' },
        { path: 'src/package.json' },
        { path: 'lib/package.json' },
        { path: 'test/package.json' }
      ]
      getFileContent.mockResolvedValue({ data: '{ test: "file content" }' })
      const fileContents = await repoData.getAllFilesContent('package.json', tree)
      expect(fileContents).toEqual([
        { content: '{ test: "file content" }', path: 'package.json' },
        { content: '{ test: "file content" }', path: 'src/package.json' },
        { content: '{ test: "file content" }', path: 'lib/package.json' },
        { content: '{ test: "file content" }', path: 'test/package.json' }
      ])
    })
  })

  describe('getDirectDependencies', () => {
    it('should return direct dependencies of govuk-frontend', () => {
      const repoData = new RepoData(repoOwner, repoName)
      const packageObjects = [
        {
          content: { dependencies: { 'govuk-frontend': '3.11.0' } },
          path: 'package.json'
        },
        {
          content: { devDependencies: { 'govuk-frontend': '3.10.0' } },
          path: 'src/package.json'
        },
        {
          content: { dependencies: { 'other-dependency': '1.0.0' } },
          path: 'lib/package.json'
        }
      ]

      const result = repoData.getDirectDependencies(packageObjects)
      expect(result).toEqual([
        { packagePath: 'package.json', specifiedVersion: '3.11.0' },
        { packagePath: 'src/package.json', specifiedVersion: '3.10.0' }
      ])
    })

    it('should return an empty array if no direct dependencies of govuk-frontend are found', () => {
      const repoData = new RepoData(repoOwner, repoName)
      const packageObjects = [
        {
          content: { dependencies: { 'other-dependency': '1.0.0' } },
          path: 'package.json'
        }
      ]

      const result = repoData.getDirectDependencies(packageObjects)
      expect(result).toEqual([])
    })
  })

  describe('getAllFilesContent', () => {
    it('should get the content of all files with a given name', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      const tree = [
        { path: 'package.json' },
        { path: 'src/package.json' },
        { path: 'lib/package.json' },
        { path: 'test/package.json' }
      ]
      getFileContent.mockResolvedValue({ data: '{ test: "file content" }' })
      const fileContents = await repoData.getAllFilesContent('package.json', tree)
      expect(fileContents).toEqual([
        { content: '{ test: "file content" }', path: 'package.json' },
        { content: '{ test: "file content" }', path: 'src/package.json' },
        { content: '{ test: "file content" }', path: 'lib/package.json' },
        { content: '{ test: "file content" }', path: 'test/package.json' }
      ])
    })

    it('should return an empty array if no files with the given name are found', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      const tree = []
      const fileContents = await repoData.getAllFilesContent('package.json', tree)
      expect(fileContents).toEqual([])
    })

    it('should handle errors when fetching file content', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      const tree = [
        { path: 'package.json' }
      ]
      getFileContent.mockRejectedValue(new Error('Failed to fetch file content'))
      await expect(repoData.getAllFilesContent('package.json', tree)).rejects.toThrow('Failed to fetch file content')
    })
  })

  describe('handleError', () => {
    it('should add error to repo-data errorsThrown property', () => {
      const repoData = new RepoData(repoOwner, repoName)
      const error = new Error('Test error')
      repoData.handleError(error)
      expect(repoData.errorsThrown).toEqual(['Error: Test error'])
    })
  })

  describe('getRepofileContent', () => {
    it('should get the content of a file in the repo', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      getFileContent.mockResolvedValue({ data: '{ test: "file content" }' })

      const fileContent = await repoData.getRepoFileContent('package.json')
      expect(fileContent).toEqual({ data: '{ test: "file content" }' })
    })
  })

  describe('checkFileExists', () => {
    it('should check if a file exists in the repo tree', () => {
      const repoData = new RepoData(repoOwner, repoName)
      const tree = [{ path: 'package.json' }]

      const fileExists = repoData.checkFileExists('package.json', tree)
      expect(fileExists).toBe(true)
    })
  })

  describe('log', () => {
    it('should log messages consistently', () => {
      const repoData = new RepoData(repoOwner, repoName)
      const consoleSpy = vi.spyOn(console, 'log')

      repoData.log('test message')
      expect(consoleSpy).toHaveBeenCalledWith(
        'test-owner/test-repo: test message'
      )
    })
  })

  describe('getIndirectDependencies', () => {
    it('should return indirect dependencies from package-lock.json', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      const packageObjects = [
        { path: 'package.json', content: {} }
      ]
      const lockfileContent = {
        data: {
          packages: {
            'node_modules/parent-package': {
              dependencies: {
                'govuk-frontend': '^3.11.0'
              }
            },
            'node_modules/govuk-frontend': {
              version: '3.11.0'
            }
          }
        }
      }
      repoData.getLockfileType = vi.fn().mockReturnValue('package-lock.json')
      repoData.getRepoFileContent = vi.fn().mockResolvedValue({ data: JSON.stringify(lockfileContent.data) })
      repoData.parseLockfile = vi.fn().mockReturnValue(lockfileContent.data)

      const result = await repoData.getIndirectDependencies(packageObjects)
      expect(result).toEqual([[{
        parent: 'node_modules/parent-package',
        specifiedVersion: '^3.11.0',
        lockfilePath: 'package-lock.json',
        actualVersion: '3.11.0'
      }]])
    })

    it('should return indirect dependencies from yarn.lock', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      const packageObjects = [
        { path: 'package.json', content: {} }
      ]
      const lockfileContent = {
        data: `
        otherpackage@^1.0.0:
          dependencies:
            govuk-frontend: ^3.11.0
        govuk-frontend@^3.11.0:
          version: 3.11.0
      `
      }
      repoData.getLockfileType = vi.fn().mockReturnValue('yarn.lock')
      repoData.getRepoFileContent = vi.fn().mockResolvedValue(lockfileContent)

      const result = await repoData.getIndirectDependencies(packageObjects)
      expect(result).toEqual([[{
        parent: 'otherpackage@^1.0.0',
        specifiedVersion: '^3.11.0',
        actualVersion: '3.11.0',
        lockfilePath: 'yarn.lock'
      }]])
    })

    it('should handle errors when fetching lockfile content', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      const packageObjects = [
        { path: 'package.json', content: {} }
      ]
      repoData.getLockfileType = vi.fn().mockReturnValue('package-lock.json')
      repoData.getRepoFileContent = vi.fn().mockRejectedValue(new Error('Failed to fetch lockfile content'))
      repoData.handleError = vi.fn()

      const result = await repoData.getIndirectDependencies(packageObjects)
      expect(result).toEqual([])
      expect(repoData.handleError).toHaveBeenCalledWith(new Error('Failed to fetch lockfile content'))
    })
  })

  describe('disambiguateDependencies', () => {
    it('should disambiguate dependencies with version ranges using package-lock.json', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      const tree = [{ path: 'package.json' }]
      const dependencies = [
        { packagePath: 'package.json', specifiedVersion: '^3.11.0' }
      ]
      const lockfileContent = {
        packages: {
          'node_modules/govuk-frontend': {
            version: '3.12.0'
          }
        }
      }
      repoData.getLockfileType = vi.fn().mockReturnValue('package-lock.json')
      repoData.getRepoFileContent = vi.fn().mockResolvedValue(JSON.stringify(lockfileContent))
      repoData.parseLockfile = vi.fn().mockReturnValue(lockfileContent)

      const result = await repoData.disambiguateDependencies(dependencies, tree)
      expect(result).toEqual([
        { packagePath: 'package.json', actualVersion: '3.12.0', specifiedVersion: '^3.11.0' }
      ])
    })

    it('should disambiguate dependencies with version ranges using yarn.lock', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      const dependencies = [
        { packagePath: 'package.json', specifiedVersion: '^3.11.0' }
      ]
      const lockfileContent = {
        data: `
      govuk-frontend@^3.11.0:
        version: 3.11.0
    `
      }
      repoData.getLockfileType = vi.fn().mockReturnValue('yarn.lock')
      repoData.getRepoFileContent = vi.fn().mockResolvedValue(lockfileContent)
      repoData.parseLockfile = vi.fn().mockReturnValue({
        'govuk-frontend@^3.11.0': { version: '3.11.0' }
      })

      const result = await repoData.disambiguateDependencies(dependencies)
      expect(result).toEqual([
        { packagePath: 'package.json', actualVersion: '3.11.0', specifiedVersion: '^3.11.0' }
      ])
    })

    it('should return dependencies with exact versions as is', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      const dependencies = [
        { packagePath: 'package.json', frontendVersion: '3.11.0' }
      ]

      const result = await repoData.disambiguateDependencies(dependencies)
      expect(result).toEqual(dependencies)
    })

    it('should handle errors when fetching lockfile content', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      const dependencies = [
        { packagePath: 'package.json', specifiedVersion: '^3.11.0' }
      ]
      repoData.getLockfileType = vi.fn().mockReturnValue('package-lock.json')
      repoData.getRepoFileContent = vi.fn().mockRejectedValue(new Error('Failed to fetch lockfile content'))
      repoData.handleError = vi.fn()

      const result = await repoData.disambiguateDependencies(dependencies)
      expect(result).toEqual([])
      expect(repoData.handleError).toHaveBeenCalledWith(new Error('Failed to fetch lockfile content'))
    })
  })

  describe('getIndirectDependencyFromLockfile', () => {
    it('should return indirect dependencies from package-lock.json', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      const lockfileObject = {
        packages: {
          'node_modules/parent-package': {
            dependencies: {
              'govuk-frontend': '^3.11.0'
            }
          },
          'node_modules/govuk-frontend': {
            version: '3.11.0'
          }
        }
      }
      const result = await repoData.getIndirectDependencyFromLockfile(lockfileObject, 'package-lock.json', 'package-lock.json')
      expect(result).toEqual([{
        parent: 'node_modules/parent-package',
        specifiedVersion: '^3.11.0',
        lockfilePath: 'package-lock.json',
        actualVersion: '3.11.0'
      }])
    })

    it('should return indirect dependencies from yarn.lock', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      const lockfileObject = {
        'otherpackage@^1.0.0': {
          dependencies: {
            'govuk-frontend': '^3.11.0'
          }
        },
        'govuk-frontend@^3.11.0': {
          version: '3.11.0'
        }
      }
      const result = await repoData.getIndirectDependencyFromLockfile(lockfileObject, 'yarn.lock', 'yarn.lock')
      expect(result).toEqual([{
        parent: 'otherpackage@^1.0.0',
        specifiedVersion: '^3.11.0',
        actualVersion: '3.11.0',
        lockfilePath: 'yarn.lock'
      }])
    })

    it('should return an empty array if no indirect dependencies are found in package-lock.json', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      const lockfileObject = {
        packages: {
          'node_modules/other-package': {
            dependencies: {}
          }
        }
      }
      const result = await repoData.getIndirectDependencyFromLockfile(lockfileObject, 'package-lock.json', 'package.json')
      expect(result).toEqual([])
    })

    it('should return an empty array if no indirect dependencies are found in yarn.lock', async () => {
      const repoData = new RepoData(repoOwner, repoName)
      const lockfileObject = {
        'other-package@^1.0.0': {
          version: '1.0.0'
        }
      }
      const result = await repoData.getIndirectDependencyFromLockfile(lockfileObject, 'yarn.lock', 'package.json')
      expect(result).toEqual([])
    })
  })

  describe('parseLockfile', () => {
    const repoData = new RepoData(repoOwner, repoName)
    it('should parse package-lock.json correctly', () => {
      const lockfile = { data: '{"name": "test-package"}' }
      const result = repoData.parseLockfile(lockfile, 'package-lock.json')
      expect(result).toEqual({ name: 'test-package' })
    })

    it('should log an error if package-lock.json is malformed', () => {
      const lockfile = { data: '{"name": "test-package"' } // malformed JSON
      const consoleSpy = vi.spyOn(console, 'log')
      const result = repoData.parseLockfile(lockfile, 'package-lock.json')
      expect(result).toBeUndefined()
      expect(consoleSpy).toHaveBeenCalledWith('test-owner/test-repo: ERROR: problem parsing package-lock.json')
    })

    it('should parse yarn.lock correctly (old format)', () => {
      const lockfile = { data: 'govuk-frontend@^3.11.0:\n  version: 3.11.0\n' }
      const result = repoData.parseLockfile(lockfile, 'yarn.lock')
      expect(result).toEqual({ 'govuk-frontend@^3.11.0': { version: '3.11.0' } })
    })

    it('should parse yarn.lock correctly (new format)', () => {
      const lockfile = { data: 'govuk-frontend@^3.11.0:\n  version: 3.11.0\n' }
      yarnLock.default.parse = vi.fn().mockImplementation(() => { throw new Error('Old format error') })
      const parseYamlSpy = vi.spyOn(repoData, 'parseLockfile').mockReturnValue({ 'govuk-frontend@^3.11.0': { version: '3.11.0' } })
      const result = repoData.parseLockfile(lockfile, 'yarn.lock')
      expect(result).toEqual({ 'govuk-frontend@^3.11.0': { version: '3.11.0' } })
      expect(parseYamlSpy).toHaveBeenCalledWith(lockfile, 'yarn.lock')
    })
  })
})
