import { IndirectDependencyError } from './error-handling.mjs'
import {
  getFileContent,
  getLatestCommit,
  getRepoMetaData,
  getRepoTree,
} from './octokit.mjs'
import * as yarnLock from '@yarnpkg/lockfile'

export class RepoData {
  constructor(repoOwner, repoName, serviceOwners = []) {
    this.repoOwner = repoOwner
    this.repoName = repoName
    this.couldntAccess = false
    this.frontendVersion = null
    this.versionDoubt = false
    this.builtByGovernment = serviceOwners.includes(this.repoOwner)
    this.indirectDependency = false
    this.isPrototype = false
    this.lastUpdated = null
    this.repoCreated = null
    this.parentDependency = null
    this.errorThrown = null
    this.repoTree = null
  }

  checkDenyList(denyList) {
    return denyList.some(
      (item) => this.repoOwner === item.owner && this.repoName === item.name
    )
  }

  async fetchAndValidateMetaData() {
    const repoMetaData = await getRepoMetaData(this.repoOwner, this.repoName)
    if (repoMetaData) {
      this.lastUpdated = repoMetaData.data.pushed_at
      this.repoCreated = repoMetaData.data.created_at
    }

    // Some repos won't have a pushed_at
    if (!this.repoCreated) {
      throw new Error(`${this.repoName}: Couldn't fetch metadata`)
    }
  }

  async fetchAndValidateRepoTree() {
    const latestCommitSha = await this.getLatestCommitSha()
    this.repoTree = await getRepoTree(
      this.repoOwner,
      this.repoName,
      latestCommitSha
    )
    if (!this.repoTree) {
      throw new Error(`${this.repoName}: Couldn't fetch git tree`)
    }
  }

  async getLatestCommitSha() {
    const latestCommit = await getLatestCommit(this.repoOwner, this.repoName)
    return latestCommit?.sha
  }

  async checkPrototype(packageObject) {
    return (
      this.repoTree.data.tree.some(
        (file) => file.path == 'lib/usage_data.js'
      ) ||
      (packageObject.dependencies &&
        'govuk-prototype-kit' in packageObject.dependencies)
    )
  }

  async getRepoFileContent(filePath) {
    return await getFileContent(this.repoOwner, this.repoName, filePath)
  }

  checkFileExists(filePath) {
    return this.repoTree.data.tree.some((file) => file.path == filePath)
  }

  log(message) {
    console.log(`${this.repoOwner}/${this.repoName}: ${message}`)
  }

  async getVersionFromLockfile() {
    let lockfileType
    if (this.checkFileExists('package-lock.json')) {
      lockfileType = 'package-lock.json'
    } else if (this.checkFileExists('yarn.lock')) {
      lockfileType = 'yarn.lock'
    } else {
      // @TODO: support some package files - ruby (for GOV.UK) and maybe python?
      throw new IndirectDependencyError(
        `${this.repoName}: Couldn't find a supported lockfile`
      )
    }

    const lockfile = await this.getRepoFileContent(lockfileType)

    if (lockfileType == 'package-lock.json') {
      const lockfileObject = JSON.parse(lockfile.data)
      if (this.frontendVersion) {
        // If we found an ambiguous frontend version in the package.json file,
        // all we have to do is get the package version from the lockfile
        const packageVersion =
          lockfileObject.packages?.['node_modules/govuk-frontend']?.version ||
          lockfileObject.dependencies?.['node_modules/govuk-frontend']?.version
        if (packageVersion) {
          this.frontendVersion = packageVersion
        }
      } else {
        const deps = []
        // If we didn't find a frontend version in the package.json file,
        // we have to search the lockfile for the govuk-frontend entries
        for (const [packageName, packageData] of Object.entries({
          ...(lockfileObject.packages || {}),
          ...(lockfileObject.dependencies || {}),
        })) {
          if (packageData.dependencies?.['govuk-frontend']) {
            deps.push({
              parent: packageName,
              version: packageData.dependencies['govuk-frontend'].version,
            })
          }
        }
        this.parentDependency = deps
      }
    } else if (lockfileType === 'yarn.lock') {
      const yarnLockObject = yarnLock.default.parse(lockfile.data)
      this.frontendVersion =
        yarnLockObject.object[`govuk-frontend@${this.frontendVersion}`]
          ?.version || this.frontendVersion
    }
    return this.frontendVersion
  }

  getResult() {
    return {
      repoOwner: this.repoOwner,
      repoName: this.repoName,
      couldntAccess: this.couldntAccess,
      frontendVersion: this.frontendVersion,
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
