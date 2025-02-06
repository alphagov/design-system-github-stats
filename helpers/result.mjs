export class Result {
  /**
   * For storing and sharing results.
   * @param {string} repoOwner - The owner of the repository.
   * @param {string} repoName - The name of the repository.
   */
  constructor (repoOwner, repoName) {
    if (!repoOwner) {
      console.log('ERROR: repoOwner must be provided')
      throw new Error('repoOwner must be provided')
    }
    if (!repoName) {
      console.log('ERROR: repoName must be provided')
      throw new Error('repoName must be provided')
    }
    this.repoOwner = repoOwner
    this.repoName = repoName
    this.description = ''
    this.homepage = ''
    this.archived = false
    this.stargazerCount = 0
    this.forksCount = 0
    this.builtByGovernment = false
    this.isPrototype = false
    this.updatedAt = ''
    this.createdAt = ''
    this.directDependencies = []
    this.indirectDependencies = []
    this.errorsThrown = []
    this.unknownLockFileType = false
    this.isValid = false
    this.service = null

    // Non returned values
    this.latestCommitSHA = ''
    this.repoTree = []
  }

  validate () {
    let valid = true

    if (this.directDependencies.length === 0 && this.indirectDependencies.length === 0 && !this.unknownLockFileType) {
      console.log('Result validation failed: No dependencies found, but we think we support the lock file type')
      valid = false
    }

    if (this.errorsThrown.length > 0) {
      console.log('Result validation failed: Errors were thrown during analysis')
      valid = false
    }

    return valid
  }

  getResult (repoData) {
    this.unknownLockFileType = repoData.lockfileUnsupported
    this.isIndirect = this.directDependencies.length === 0
    this.isValid = this.validate()

    const result = {
      repoOwner: this.repoOwner,
      repoName: this.repoName,
      description: this.description,
      homepage: this.homepage,
      archived: this.archived,
      stargazerCount: this.stargazerCount,
      forksCount: this.forksCount,
      builtByGovernment: this.builtByGovernment,
      updatedAt: this.updatedAt,
      createdAt: this.createdAt,
      directDependencies: this.directDependencies,
      isPrototype: this.isPrototype,
      isIndirect: this.isIndirect,
      indirectDependencies: this.indirectDependencies,
      errorsThrown: this.errorsThrown,
      unknownLockFileType: this.unknownLockFileType,
      isValid: this.isValid
    }
    if (this.service) {
      result.name = this.service.name
      result['service-description'] = this.service.description
      result.synonyms = this.service.synonyms
      result.organisation = this.service.organisation
      result.phase = this.service.phase
      result.theme = this.service.theme
      result['start-page'] = this.service.startPage
      result.liveservice = this.service.liveservice
      result.timeline = this.service.timeline
      result.tags = this.service.tags
    }

    return result
  }
}
