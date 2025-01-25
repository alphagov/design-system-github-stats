import {
  getRepo,
  getFileContent,
  getTree
} from './octokit.mjs'
import { parse as parseYaml } from 'yaml'
import yarnLock from '@yarnpkg/lockfile'
import JSON5 from 'json5'

/**
 * The RepoData class is used to store and manipulate data about a repository, and serves as an abstraction
 * of the GitHub API.
 */
export class RepoData {
  /**
   * Creates an instance of RepoData.
   * @param {string} repoOwner - The owner of the repository.
   * @param {string} repoName - The name of the repository.
   * @param {Array<string>} [serviceOwners] - The list of service owners.
   */
  constructor (repoOwner, repoName, serviceOwners = []) {
    if (!repoOwner) {
      throw new TypeError('repoOwner must be provided')
    }
    if (!repoName) {
      throw new TypeError('repoName must be provided')
    }
    this.repoOwner = repoOwner
    this.repoName = repoName
    this.errorsThrown = []
    this.rootLockfileVersion = null
  }

  /**
   * Checks if repo on denyList
   * @param {Array} denyList - An array of objects with owner and name properties
   * @returns {boolean} - Whether the repo is on the deny list
   */
  checkDenyList (denyList) {
    const isOnDenyList = denyList.some(
      (item) => this.repoOwner === item.owner && this.repoName === item.name)

    if (isOnDenyList) {
      this.log('on Deny List. Will not be processed.')
    }

    return isOnDenyList
  }

  /**
   * Checks if the repo owner is in the serviceOwners list
   * @param {object} serviceOwners - The list of service owners
   * @returns {boolean} - Whether the repo owner is in the serviceOwners list
   */
  checkServiceOwner (serviceOwners) {
    const isServiceOwner = Object.hasOwn(serviceOwners, this.repoOwner)

    if (isServiceOwner) {
      this.log('looks like a GOV.UK service.')
    } else {
      this.log('not a GOV.UK service.')
    }

    return isServiceOwner
  }

  /**
   * Fetches metadata using GraphQL
   * @returns {Promise<{createdAt: string, updatedAt: string, latestCommitSHA: string, graphQLRateLimit: object}>} - The metadata
   * @throws {Error} - If metadata or tree could not be fetched
   */
  async getRepoInfo () {
    this.log('fetching repository information')

    const response = await getRepo(this.repoOwner, this.repoName)
    const result = {
      createdAt: response.repository?.createdAt,
      updatedAt: response.repository?.updatedAt,
      latestCommitSHA: response.repository?.defaultBranchRef?.target?.oid,
      graphQLRateLimit: response.rateLimit
    }

    if (!result.createdAt) {
      throw new Error('Could not fetch createdAt from repository')
    }

    if (!result.latestCommitSHA) {
      throw new Error('Could not fetch latest commit SHA from repository')
    }

    this.log('repository information fetched')
    this.log(`GraphQL rate limit remaining: ${result.graphQLRateLimit.remaining}`)

    return result
  }

  /**
   * Fetches and validates repo tree
   * @param {string} commitSHA - The SHA of the commit to fetch the tree for
   * @returns {Promise<import('@octokit/rest').RestEndpointMethodTypes['git']['getTree']['response']['data']['tree']>} - The repo tree
   * @throws {Error} - If the tree could not be fetched
   */
  async getRepoTree (commitSHA) {
    this.log('fetching repository tree')

    const response = await getTree(
      this.repoOwner,
      this.repoName,
      commitSHA
    )
    if (!response || !response.data || !response.data.tree) {
      throw new Error('Could not fetch tree from repository')
    }

    this.log('repository tree fetched')

    return response.data.tree
  }

  /**
   * Asynchronously retrieves and parses the content of all 'package.json' files.
   * @param {import('@octokit/rest').RestEndpointMethodTypes['git']['getTree']['response']['data']['tree']} tree - The repo tree
   * @returns {Promise<Array<{content: object, path: string}>>} - The package.json objects
   */
  async getPackageFiles (tree) {
    this.log('fetching package.json files')

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
          this.log('problem parsing one of the package.json files . It\'s likely malformed', 'error')
        }
      }
    }

    this.log(`${packageObjects.length} package file${
        packageObjects.length === 0 || packageObjects.length > 1 ? 's' : ''
      } found.`)

    return packageObjects
  }

  /**
   * Checks if repo is a prototype
   * @param {Array} packageObjects - an array of packageObjects
   * @param {Array} tree - the repo tree
   * @returns {boolean} - Whether the repo is a prototype
   */
  checkPrototype (packageObjects, tree) {
    let isPrototype = false
    if (
      tree.some((file) => file.path === 'lib/usage_data.js')
    ) {
      isPrototype = true
    } else if (packageObjects.length === 0) {
      isPrototype = false
    } else {
      for (const packageObject of packageObjects) {
        if (
          packageObject.content.dependencies &&
          'govuk-prototype-kit' in packageObject.content.dependencies
        ) {
          isPrototype = true
        }
      }
    }

    if (isPrototype) {
      this.log('looks like an instance of the prototype kit.')
    }

    return isPrototype
  }

  /**
   * Retrieves all instances of 'govuk-frontend' in the dependencies of the package.json files.
   * @param {Array} packageObjects - An array of package objects to inspect.
   * @returns {Array<{packagePath, specifiedVersion}>} The paths and versions found in the package.json files.
   */
  getDirectDependencies (packageObjects) {
    this.log('searching for govuk-frontend direct dependencies in package.json files')

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
          specifiedVersion: version
        })
      }
    }

    this.log(`${results.length} direct dependencies found.`)

    return results
  }

  /**
   * Gets the content of a file in the repo
   * @param {string} filePath - The path to the file
   * @returns {Promise<import('@octokit/rest').RestEndpointMethodTypes['repos']['getContent']['response']>} - The file content
   */
  async getRepoFileContent (filePath) {
    return await getFileContent(this.repoOwner, this.repoName, filePath)
  }

  /**
   * Gets the content from a repo for all files with a given file name.
   * @param {string} fileName - The filename.
   * @param {Array<object>} tree - The repo tree.
   * @returns {Promise<Array<{path, content}>>} - An array of objects containing the file path and content.
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
   * @param {string} filePath - The path to the file
   * @param {Array<object>} tree - The repo tree
   * @returns {boolean} - Whether the file exists
   */
  checkFileExists (filePath, tree) {
    return tree.some((file) => file.path === filePath)
  }

  /**
   * Logs messages consistently
   * @param {string} message - the message to log
   * @param {string} type - type of message (error)
   */
  log (message, type = '') {
    const typeMsg = type === 'error' ? ' ERROR:' : ''
    console.log(`${this.repoOwner}/${this.repoName}:${typeMsg} ${message}`)
  }

  /**
   * Retrieves indirect dependencies from the provided package objects.
   * @param {Array<{path, content}>} packageObjects - An array of package objects.
   * @param {Array<object>} tree - The repo tree.
   * @returns {Promise<Array<object>>} A promise that resolves to an array of indirect dependencies.
   */
  async getIndirectDependencies (packageObjects, tree) {
    this.log('searching for govuk-frontend indirect dependencies in lockfiles')

    const results = []
    // We want to try the root directory in all cases
    if (!packageObjects.some(pkg => pkg.path === 'package.json')) {
      packageObjects.push({ path: 'package.json', content: {} })
    }
    for (const packageObject of packageObjects) {
      try {
        const lockfileType = this.getLockfileType(packageObject.path, tree)
        if (lockfileType) {
          const lockfilePath = packageObject.path.replace('package.json', lockfileType)
          if (this.checkFileExists(lockfilePath, tree)) {
            const lockfile = await this.getRepoFileContent(packageObject.path.replace('package.json', lockfileType))
            const lockfileObject = this.parseLockfile(lockfile, lockfileType)
            const deps = await this.getIndirectDependencyFromLockfile(lockfileObject, lockfileType, lockfilePath)
            if (deps.length > 0) {
              results.push(deps)
            }
          }
        }
      } catch (error) {
        this.handleError(error)
      }
    }
    this.log(`${results.length} indirect dependencies found.`)
    if (results.length > 0) {
      return results
    }
  }

  /**
   * Disambiguates the given dependencies by resolving their versions from the lockfile if necessary.
   * @param {Array} dependencies - An array of dependency objects, each containing a `packagePath` and `specifiedVersion`.
   * @param {Array<object>} tree - The repo tree.
   * @returns {Promise<Array>} A promise that resolves to an array of disambiguated dependencies.
   */
  async disambiguateDependencies (dependencies, tree) {
    this.log('disambiguating direct dependencies')

    const results = []
    // We want to fall back to the root lockfile if we can't find a local lockfile
    if (!this.rootLockfileVersion) {
      const rootLockfileType = this.getLockfileType('package.json', tree)
      if (rootLockfileType) {
        const rootLockfile = await this.getRepoFileContent(rootLockfileType)
        const rootLockfileObject = this.parseLockfile(rootLockfile, rootLockfileType)
        this.rootLockfileVersion = await this.getLockfileVersion(rootLockfileObject, rootLockfileType, rootLockfileType, tree)
      }
    }

    for (const dependency of dependencies) {
      try {
        if (/^[~^*]/.test(dependency.specifiedVersion)) {
          const lockfileType = this.getLockfileType(dependency.packagePath, tree)
          const lockfilePath = dependency.packagePath.replace('package.json', lockfileType)
          if (this.checkFileExists(lockfilePath, tree)) {
            const lockfile = await this.getRepoFileContent(lockfilePath)
            const lockfileObject = this.parseLockfile(lockfile, lockfileType)
            dependency.actualVersion = await this.getLockfileVersion(lockfileObject, lockfileType, dependency.packagePath, tree)
          } else {
            dependency.actualVersion = this.rootLockfileVersion ? this.rootLockfileVersion : dependency.specifiedVersion
          }
        } else {
          dependency.actualVersion = dependency.specifiedVersion
        }
        results.push(dependency)
      } catch (error) {
        this.handleError(error)
      }
    }

    this.log('direct dependencies disambiguated')

    return results
  }

  /**
   * Retrieves the version of the 'govuk-frontend' dependency from a lockfile object.
   * @param {object} lockfileObject - The parsed lockfile object.
   * @param {string} lockfileType - The type of lockfile ('package-lock.json' or 'yarn.lock').
   * @param {string} path - The path to the package.
   * @param {Array<object>} tree - The repo tree
   * @returns {Promise<string>} The lockfile govuk-frontend semver string.
   */
  async getLockfileVersion (lockfileObject, lockfileType, path, tree) {
    let version

    if (lockfileType === 'package-lock.json') {
      version =
        lockfileObject?.packages?.['node_modules/govuk-frontend']?.version ||
        lockfileObject?.dependencies?.['govuk-frontend']?.version
    } else if (lockfileType === 'yarn.lock') {
      const dependencyKey = Object.keys(lockfileObject).find(key => key.startsWith('govuk-frontend@'))
      version = lockfileObject[dependencyKey]?.version
    }

    return version
  }

  /**
   * Retrieves indirect dependencies from a lockfile object.
   * @param {object} lockfileObject - The parsed lockfile object.
   * @param {string} lockfileType - The type of lockfile ('package-lock.json' or 'yarn.lock').
   * @param {string} path - The path to the lockfile.
   * @returns {Promise<Array<{parent, specifiedVersion, lockfilePath, actualVersion}>>} A promise that resolves to an array of indirect dependencies.
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
            specifiedVersion: version,
            lockfilePath: path,
            actualVersion: lockfileObject.packages?.['node_modules/govuk-frontend']?.version
          })
        }
      }
    } else if (lockfileType === 'yarn.lock') {
      // Find the key where the value has `govuk-frontend` in the `dependencies` object
      for (const [key, value] of Object.entries(lockfileObject)) {
        if (value.dependencies?.['govuk-frontend']) {
          deps.push({
            parent: key,
            specifiedVersion: value.dependencies['govuk-frontend'],
            lockfilePath: path,
            actualVersion: lockfileObject[`govuk-frontend@${value.dependencies['govuk-frontend']}`]?.version
          })
        }
      }
    }
    return deps
  }

  /**
   * Parses a lockfile based on its type and returns the parsed object.
   * @param {object} lockfile - The lockfile object containing the data to be parsed.
   * @param {import('@octokit/rest').RestEndpointMethodTypes['repos']['getContent']['response']['data']} lockfile.data - The raw data of the lockfile.
   * @param {string} lockfileType - The type of the lockfile, either 'package-lock.json' or 'yarn.lock'.
   * @returns {object | undefined} The parsed lockfile object, or undefined if parsing fails.
   */
  parseLockfile (lockfile, lockfileType) {
    let parsedLockfile

    if (lockfileType === 'package-lock.json') {
      try {
        parsedLockfile = JSON5.parse(lockfile.data.toString())
      } catch (error) {
        this.log('problem parsing package-lock.json', 'error')
      }
    } else if (lockfileType === 'yarn.lock') {
      try {
        // First, try the old yarn.lock format
        parsedLockfile = yarnLock.parse(lockfile.data.toString()).object
      } catch (error) {
        // Otherwise, try the new format
        parsedLockfile = parseYaml(lockfile.data.toString())
      }
    }

    return parsedLockfile
  }

  /**
   * Checks for the type of lockfile
   * @param {string} packagePath - the path to the package.json file
   * @param {Array<object>} tree - the repo tree
   * @returns {string} - the lockfile type
   */
  getLockfileType (packagePath = 'package.json', tree) {
    let lockfileType
    if (this.checkFileExists(packagePath.replace('package.json', 'package-lock.json'), tree)) {
      lockfileType = 'package-lock.json'
    } else if (this.checkFileExists(packagePath.replace('package.json', 'yarn.lock'), tree)) {
      lockfileType = 'yarn.lock'
    } else {
      return null
    }
    return lockfileType
  }

  /**
   * Logs errors
   * @param {Error} error - The error to handle
   * @throws {Error} - If the error is not an expected type
   */
  handleError (error) {
    this.log(`${error.message}. Added to result.`, 'error')
    this.errorsThrown.push(error.toString())
  }
}
