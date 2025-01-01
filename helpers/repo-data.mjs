import {
  getRepoInfo,
  getFileContent,
  getRepoTree,
} from './octokit.mjs'
import * as yarnLock from '@yarnpkg/lockfile'
import { RequestError } from 'octokit'

export class UnsupportedLockFileError extends Error {}
export class NoMetaDataError extends Error {}
export class NoRepoTreeError extends Error {}
export class NoCommitsError extends Error {}

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
    this.builtByGovernment = serviceOwners.includes(this.repoOwner)
    this.indirectDependency = false
    this.isPrototype = false
    this.lastUpdated = null
    this.repoCreated = null
    this.parentDependency = null
    this.errorThrown = null
    this.repoTree = null
    this.frontendVersions = []
    this.latestCommitSHA = null
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
   * Fetches metadata and repo tree using GraphQL
   *
   * @throws {NoMetaDataError} - If metadata could not be fetched
   * @throws {NoRepoTreeError} - If the tree could not be fetched
   * @throws {RequestError} - If the request fails
   */
  async fetchAndValidateRepoInfo () {
    const response = await getRepoInfo(this.repoOwner, this.repoName)

    this.repoCreated = response.repository?.createdAt
    this.lastUpdated = response.repository?.pushedAt
    this.latestCommitSHA = response.repository?.defaultBranchRef?.target?.oid
    this.graphQLRateLimit = response.rateLimit

    // Some repos won't have a pushed_at
    if (!this.repoCreated) {
      throw new NoMetaDataError()
    }

    if (!this.latestCommitSHA) {
      throw new NoCommitsError()
    }
  }

  /**
   * Fetches and validates repo tree
   *
   * @throws {NoRepoTreeError} - If the tree could not be fetched
   * @throws {RequestError} - If the request fails
   */
  async fetchAndValidateRepoTree () {
    this.repoTree = await getRepoTree(
      this.repoOwner,
      this.repoName,
      this.latestCommitSHA
    )
    if (!this.repoTree || !this.repoTree.data || !this.repoTree.data.tree) {
      throw new NoRepoTreeError()
    }
  }

  /**
   * Checks if repo is a prototype
   *
   * @param {array} packageObjects - an array of packageObjects
   * @returns {boolean} - Whether the repo is a prototype
   */
  checkPrototype (packageObjects) {
    if (
      this.repoTree.data.tree.some((file) => file.path === 'lib/usage_data.js')
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

  checkDirectDependency (packageObjects) {
    for (const packageObject of packageObjects) {
      if ('govuk-frontend' in packageObject.content.dependencies) {
        this.frontendVersions.push({
          packagePath: packageObject.path,
          frontendVersion: packageObject.content.dependencies['govuk-frontend'],
        })
      }
    }
    if (this.frontendVersions.length === 0) {
      this.indirectDependency = true
    }
    return this.frontendVersions.length > 0
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

  async getAllFilesContent (fileName) {
    const files = this.repoTree.data.tree.filter(
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
   * @returns {boolean} - Whether the file exists
   */
  checkFileExists (filePath) {
    return this.repoTree.data.tree.some((file) => file.path === filePath)
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
   * Checks for the type of lockfile
   *
   * @returns {string} - the lockfile type
   */
  getLockfileType () {
    let lockfileType
    if (this.checkFileExists('package-lock.json')) {
      lockfileType = 'package-lock.json'
    } else if (this.checkFileExists('yarn.lock')) {
      lockfileType = 'yarn.lock'
    } else {
      // @TODO: support some package files - ruby (for GOV.UK) and maybe python?
      throw new UnsupportedLockFileError()
    }
    return lockfileType
  }

  /**
   * Gets the version of govuk-frontend from the lockfile
   * @returns {string} - The version of govuk-frontend
   * @throws {UnsupportedLockFileError} - If the lockfile is not supported
   * @throws {RequestError} - If the request for the file data fails
   */
  async getVersionFromLockfile (lockfileType) {
    const lockfile = await this.getRepoFileContent(lockfileType)

    if (lockfileType === 'package-lock.json') {
      const lockfileObject = JSON.parse(lockfile.data)
      if (this.frontendVersions.length > 0) {
        // If we found an ambiguous frontend version in the package.json file,
        // all we have to do is get the package version from the lockfile
        const packageVersion =
          lockfileObject.packages?.['node_modules/govuk-frontend']?.version ||
          lockfileObject.dependencies?.['govuk-frontend']?.version
        if (packageVersion) {
          this.lockfileFrontendVersion = packageVersion
        }
      } else {
        const deps = []
        // If we didn't find a frontend version in the package.json file,
        // we have to search the lockfile for the govuk-frontend entries
        for (const [packageName, packageData] of Object.entries({
          ...(lockfileObject.packages || {}),
          ...(lockfileObject.dependencies || {})
        })) {
          if (packageData.dependencies?.['govuk-frontend']) {
            deps.push({
              parent: packageName,
              version: packageData.dependencies['govuk-frontend'].version,
            })
          }
        }
        this.parentDependency = deps
        // Set highest dependency number to frontendVersion.
        // Not sure this is the right approach, but we'll still have dependency data
        if (deps.length > 0) {
          const versions = deps.map(dep => dep.version)
          this.lockfileFrontendVersion = versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
        }
      }
    } else if (lockfileType === 'yarn.lock') {
      const yarnLockObject = yarnLock.parse(lockfile.data)
      let yarnLockVersion = '0'

      for (const [key, value] of Object.entries(yarnLockObject.object)) {
        if (key.startsWith('govuk-frontend@') && value.version > yarnLockVersion) {
          yarnLockVersion = value.version
        }
      }
      this.lockfileFrontendVersion = yarnLockVersion || this.lockfileFrontendVersion
    }
    return this.lockfileFrontendVersion
  }

  /**
   * Logs errors
   *
   * @param {Error} error - The error to handle
   *
   * @throws {Error} - If the error is not an expected type
   */
  handleError (error) {
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

  /**
   * Generates fields for output
   *
   * @returns {object} - The result of the analysis
   */
  getResult () {
    return {
      repoOwner: this.repoOwner,
      repoName: this.repoName,
      couldntAccess: this.couldntAccess,
      lockfileFrontendVersion: this.lockfileFrontendVersion,
      directDependencyVersions: this.frontendVersions,
      versionDoubt: this.versionDoubt,
      builtByGovernment: this.builtByGovernment,
      indirectDependency: this.indirectDependency,
      isPrototype: this.isPrototype,
      lastUpdated: this.lastUpdated,
      repoCreated: this.repoCreated,
      parentDependency: this.parentDependency,
      errorThrown: this.errorThrown,
    }
  }
}
