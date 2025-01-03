import {
  getRepo,
  getFileContent,
  getTree
} from './octokit.mjs'
import { parse as parseYaml } from 'yaml'
import yarnLock from '@yarnpkg/lockfile'
import { RequestError } from 'octokit'
import JSON5 from 'json5'

export class UnsupportedLockFileError extends Error {}
export class NoMetaDataError extends Error {}
export class NoRepoTreeError extends Error {}
export class NoCommitsError extends Error {}

/**
 * The RepoData class is used to store and manipulate data about a repository, and serves as an abstraction
 * of the GitHub API.
 */
export class RepoData {
  /**
   * Creates an instance of RepoData.
   *
   * @param {string} repoOwner - The owner of the repository.
   * @param {string} repoName - The name of the repository.
   * @param {Array<string>} [serviceOwners=[]] - The list of service owners.
   */
  constructor (repoOwner, repoName, serviceOwners = []) {
    if (!repoOwner) {
      this.log('repoOwner must be provided', 'error')
      throw new Error('repoOwner must be provided')
    }
    if (!repoName) {
      this.log('repoName must be provided', 'error')
      throw new Error('repoName must be provided')
    }
    this.repoOwner = repoOwner
    this.repoName = repoName
    this.couldntAccess = false
    this.lockfileFrontendVersion = null
    this.versionDoubt = false
    this.indirectDependency = false
    this.parentDependency = null
    this.errorThrown = []
    this.frontendVersions = []
    this.graphQLRateLimit = null
  }

  /**
   * Checks if repo on denyList
   *
   * @param {array} denyList - An array of objects with owner and name properties
   * @returns {boolean} - Whether the repo is on the deny list
   */
  checkDenyList (denyList) {
    return denyList.some(
      (item) => this.repoOwner === item.owner && this.repoName === item.name
    )
  }

  /**
   * Checks if the repo owner is in the serviceOwners list
   * @param {Array<string>} serviceOwners
   * @returns {boolean} - Whether the repo owner is in the serviceOwners list
   */
  checkServiceOwner (serviceOwners) {
    return serviceOwners.includes(this.repoOwner)
  }

  /**
   * Fetches metadata using GraphQL
   *
   * @returns {Promise<{createdAt: string, updatedAt: string, latestCommitSHA: string, graphQLRateLimit: object}>} - The metadata
   * @throws {NoMetaDataError} - If metadata could not be fetched
   * @throws {NoRepoTreeError} - If the tree could not be fetched
   * @throws {RequestError} - If the request fails
   */
  async getRepoInfo () {
    const response = await getRepo(this.repoOwner, this.repoName)
    const result = {
      createdAt: response.repository?.createdAt,
      updatedAt: response.repository?.updatedAt,
      latestCommitSHA: response.repository?.defaultBranchRef?.target?.oid,
      graphQLRateLimit: response.rateLimit
    }

    if (!result.createdAt) {
      throw new NoMetaDataError()
    }

    if (!result.latestCommitSHA) {
      throw new NoCommitsError()
    }

    return result
  }

  /**
   * Fetches and validates repo tree
   *
   * @param {string} commitSHA - The SHA of the commit to fetch the tree for
   * @returns {Promise<import('@octokit/rest').Response<import('@octokit/rest').GitGetTreeResponse>>} - The repo tree
   * @throws {NoRepoTreeError} - If the tree could not be fetched
   * @throws {RequestError} - If the request fails
   */
  async getRepoTree (commitSHA) {
    const response = await getTree(
      this.repoOwner,
      this.repoName,
      commitSHA
    )
    if (!response || !response.data || !response.data.tree) {
      throw new NoRepoTreeError()
    }

    return response.data.tree
  }

  /**
   * Asynchronously retrieves and parses the content of all 'package.json' files.
   * @param {Array<Object>} tree - The repo tree
   * @returns {Promise<Array<{content: Object, path: string}>>} - The package.json objects
   */
  async getPackageFiles (tree) {
    const packageFiles = await this.getAllFilesContent('package.json', tree)
    const packageObjects = []
    if (packageFiles.length > 0) {
      for (const file of packageFiles) {
        try {
          packageObjects.push({
            content: JSON5.parse(file.content),
            path: file.path
          })
        } catch (error) {
          console.log('what')
          this.log('problem parsing one of the package.json files . It\'s likely malformed')
        }
      }
    }

    return packageObjects
  }

  /**
   * Checks if repo is a prototype
   *
   * @param {array} packageObjects - an array of packageObjects
   * @param {array} tree - the repo tree
   * @returns {boolean} - Whether the repo is a prototype
   */
  checkPrototype (packageObjects, tree) {
    if (
      tree.some((file) => file.path === 'lib/usage_data.js')
    ) {
      return true
    } else if (packageObjects.length === 0) {
      return false
    } else {
      for (const packageObject of packageObjects) {
        if (
          packageObject.content.dependencies &&
          'govuk-prototype-kit' in packageObject.content.dependencies
        ) {
          return true
        }
      }
    }
    return false
  }

  /**
   * Retrieves all instances of 'govuk-frontend' in the dependencies of the package.json files.
   *
   * @param {Array<Object>} packageObjects - An array of package objects to inspect.
   * @param {Object} packageObjects[].content - The content of the package object.
   * @param {Object} [packageObjects[].content.dependencies] - The dependencies of the package.
   * @param {Object} [packageObjects[].content.devDependencies] - The devDependencies of the package.
   * @param {string} packageObjects[].path - The path of the package.
   * @returns {Array<Object>} The frontend versions found in the package.json files.
   * @returns {string} results[].packagePath - The path of the package.
   * @returns {string} results[].frontendVersion - The version of 'govuk-frontend' dependency.
   */
  getDirectDependencies (packageObjects) {
    const results = []
    for (const packageObject of packageObjects) {
      let version = null
      if (packageObject.content.dependencies?.['govuk-frontend']) {
        version = packageObject.content.dependencies['govuk-frontend']
      } else if (packageObject.content.devDependencies?.['govuk-frontend']) {
        version = packageObject.content.devDependencies['govuk-frontend']
      }

      if (version) {
        results.push({
          packagePath: packageObject.path,
          frontendVersion: version
        })
      }
    }
    return results
  }

  /**
   * Gets the content of a file in the repo
   *
   * @param {string} filePath - The path to the file
   * @returns {Promise<import('@octokit/rest').Response<import('@octokit/rest').ReposGetContentsResponse>>} - The file content
   * @throws {RequestError} - If the request fails
   */
  async getRepoFileContent (filePath) {
    return await getFileContent(this.repoOwner, this.repoName, filePath)
  }

  /**
   * Gets the content from a repo for all files with a given file name.
   *
   * @param {string} fileName - The filename.
   * @param {Array<Object>} tree - The repo tree.
   * @returns {Promise<Array<{path: string, content: string}>>} - An array of objects containing the file path and content.
   */
  async getAllFilesContent (fileName, tree) {
    const files = tree.filter(
      (file) =>
        file.path.endsWith(fileName) && !file.path.includes('node_modules')
    )
    const fileContents = await Promise.all(
      files.map(async (file) => {
        const content = await this.getRepoFileContent(file.path)
        return { path: file.path, content: content.data }
      })
    )
    return fileContents
  }

  /**
   * Checks if a file exists in the repo tree
   *
   * @param {string} filePath
   * @param {Array<Object>} tree
   * @returns {boolean} - Whether the file exists
   */
  checkFileExists (filePath, tree) {
    return tree.some((file) => file.path === filePath)
  }

  /**
   * Logs messages consistently
   *
   * @param {string} message - the message to log
   * @param {[string]} type - type of message (error)
   */
  log (message, type = '') {
    const typeMsg = type === 'error' ? ' ERROR:' : ''
    console.log(`${this.repoOwner}/${this.repoName}:${typeMsg} ${message}`)
  }

  /**
   * Retrieves indirect dependencies from the provided package objects.
   *
   * @param {Array<Object>} packageObjects - An array of package objects.
   * @param {string} packageObjects[].path - The path to the package file.
   * @param {Object} packageObjects[].content - The content of the package file.
   * @param {Array<Object>} tree - The repo tree.
   * @returns {Promise<Array<Object>>} A promise that resolves to an array of indirect dependencies.
   */
  async getIndirectDependencies (packageObjects, tree) {
    const results = []
    // We want to try the root directory in all cases
    if (!packageObjects.some(pkg => pkg.path === 'package.json')) {
      packageObjects.push({ path: '', content: {} })
    }
    for (const packageObject of packageObjects) {
      try {
        const lockfileType = this.getLockfileType(packageObject.path, tree)
        const lockfile = await this.getRepoFileContent(packageObject.path.replace('package.json', lockfileType))
        const lockfileObject = this.parseLockfile(lockfile, lockfileType)
        results.push(await this.getIndirectDependencyFromLockfile(lockfileObject, lockfileType, packageObject.path))
      } catch (error) {
        this.handleError(error)
      }
    }
    return results
  }

  /**
   * Disambiguates the given dependencies by resolving their versions from the lockfile if necessary.
   *
   * @param {Array} dependencies - An array of dependency objects, each containing a `packagePath` and `frontendVersion`.
   * @param {Array<Object>} tree - The repo tree.
   * @returns {Promise<Array>} A promise that resolves to an array of disambiguated dependencies.
   */
  async disambiguateDependencies (dependencies, tree) {
    const results = []
    // We want to try the root directory in all cases
    if (!dependencies.some(dep => dep.packagePath === 'package.json')) {
      dependencies.push({ packagePath: '', frontendVersion: '*' })
    }
    for (const dependency of dependencies) {
      try {
        if (/^[~^*]/.test(dependency.frontendVersion)) {
          const lockfileType = this.getLockfileType(dependency.packagePath, tree)
          const lockfile = await this.getRepoFileContent(dependency.packagePath.replace('package.json', lockfileType))
          const lockfileObject = this.parseLockfile(lockfile, lockfileType)
          results.push(await this.getDirectDependencyFromLockfile(lockfileObject, lockfileType, dependency.packagePath))
        } else {
          results.push(dependency)
        }
      } catch (error) {
        this.handleError(error)
      }
    }
    return results
  }

  /**
   * Retrieves the version of the 'govuk-frontend' dependency from a lockfile object.
   *
   * @param {Object} lockfileObject - The parsed lockfile object.
   * @param {string} lockfileType - The type of lockfile ('package-lock.json' or 'yarn.lock').
   * @param {string} path - The path to the package.
   * @returns {Promise<Object>} An object containing the version of 'govuk-frontend' and the package path.
   */
  async getDirectDependencyFromLockfile (lockfileObject, lockfileType, path) {
    let version
    if (lockfileType === 'package-lock.json') {
      version =
          lockfileObject?.packages?.['node_modules/govuk-frontend']?.version ||
          lockfileObject?.dependencies?.['govuk-frontend']?.version
    } else if (lockfileType === 'yarn.lock') {
      const dependencyKey = Object.keys(lockfileObject).find(key => key.startsWith('govuk-frontend@'))
      version = lockfileObject[dependencyKey]?.version
    }
    return {
      frontendVersion: version,
      packagePath: path
    }
  }

  /**
   * Retrieves indirect dependencies from a lockfile object.
   *
   * @param {Object} lockfileObject - The parsed lockfile object.
   * @param {string} lockfileType - The type of lockfile ('package-lock.json' or 'yarn.lock').
   * @param {string} path - The path to the package.
   * @returns {Promise<Array<Object>>} A promise that resolves to an array of indirect dependencies.
   * @returns {string} results[].parent - The parent package name.
   * @returns {string} results[].frontendVersion - The version of 'govuk-frontend' dependency.
   * @returns {string} results[].packagePath - The path of the package.
   */
  async getIndirectDependencyFromLockfile (lockfileObject, lockfileType, path) {
    const deps = []
    if (lockfileType === 'package-lock.json') {
      for (const [packageName, packageData] of Object.entries({
        ...(lockfileObject.packages || {}),
        ...(lockfileObject.dependencies || {})
      })) {
        const version = packageData.dependencies?.['govuk-frontend'] ||
          packageData.devDependencies?.['govuk-frontend'] ||
          packageData.peerDependencies?.['govuk-frontend']

        if (version) {
          deps.push({
            parent: packageName,
            frontendVersion: version,
            packagePath: path
          })
        }
      }
    } else if (lockfileType === 'yarn.lock') {
      const dependencyKey = Object.keys(lockfileObject).find(key => key.startsWith('govuk-frontend@'))
      const version = lockfileObject[dependencyKey]?.version

      if (version) {
        deps.push({
          parent: dependencyKey,
          frontendVersion: version,
          packagePath: path
        })
      }
    }
    return deps
  }

  /**
   * Parses a lockfile based on its type and returns the parsed object.
   *
   * @param {Object} lockfile - The lockfile object containing the data to be parsed.
   * @param {string} lockfile.data - The raw data of the lockfile.
   * @param {string} lockfileType - The type of the lockfile, either 'package-lock.json' or 'yarn.lock'.
   * @returns {Object|undefined} The parsed lockfile object, or undefined if parsing fails.
   */
  parseLockfile (lockfile, lockfileType) {
    let parsedLockfile

    if (lockfileType === 'package-lock.json') {
      try {
        parsedLockfile = JSON5.parse(lockfile.data)
      } catch (error) {
        this.log('problem parsing package-lock.json', 'error')
      }
    } else if (lockfileType === 'yarn.lock') {
      try {
        // First, try the old yarn.lock format
        parsedLockfile = yarnLock.parse(lockfile.data).object
      } catch (error) {
        // Otherwise, try the new format
        parsedLockfile = parseYaml(lockfile.data)
      }
    }

    return parsedLockfile
  }

  /**
   * Checks for the type of lockfile
   *
   * @param {string} packagePath - the path to the package.json file
   * @param {Array<Object>} tree - the repo tree
   *
   * @returns {string} - the lockfile type
   */
  getLockfileType (packagePath = '', tree) {
    let lockfileType
    if (this.checkFileExists('package-lock.json', tree) || this.checkFileExists(packagePath.replace('package.json', 'package-lock.json'), tree)) {
      lockfileType = 'package-lock.json'
    } else if (this.checkFileExists('yarn.lock') || this.checkFileExists(packagePath.replace('package.json', 'yarn.lock'), tree)) {
      lockfileType = 'yarn.lock'
    } else {
      throw new UnsupportedLockFileError()
    }
    return lockfileType
  }

  /**
   * Logs errors
   *
   * @param {Error} error - The error to handle
   *
   * @throws {Error} - If the error is not an expected type
   */
  handleError (error) {
    this.errorThrown.push(error.toString())
    if (error instanceof RequestError) {
      this.log(`problem accessing repo: ${error.message}`, 'error')
    } else if (error instanceof NoMetaDataError) {
      this.log("couldn't fetch metadata", 'error')
    } else if (error instanceof NoCommitsError) {
      this.log("couldn't fetch repo tree as repo has no commits", 'error')
    } else if (error instanceof NoRepoTreeError) {
      this.log("couldn't fetch repo tree", 'error')
    } else if (error instanceof UnsupportedLockFileError) {
      this.log(
        "couldn't find a supported lockfile. Skipping version check.",
        'error'
      )
    } else {
      throw error
    }
  }
}
