export class Result {
  /**
   * For storing and sharing results.
   *
   * @param {string} repoOwner - The owner of the repository.
   * @param {string} repoName - The name of the repository.
   */
  constructor (repoOwner, repoName) {
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
    this.builtByGovernment = false
    this.isPrototype = false
    this.updatedAt = ''
    this.createdAt = ''
    this.directDependencies = []
    this.indirectDependencies = []

    // Non returned values
    this.latestCommitSHA = ''
    this.repoTree = []
  }

  getResult () {
    return {
      repoOwner: this.repoOwner,
      repoName: this.repoName,
      builtByGovernment: this.builtByGovernment,
      updatedAt: this.updatedAt,
      createdAt: this.createdAt,
      directDependencies: this.directDependencies,
      isPrototype: this.isPrototype,
      isIndirect: this.directDependencies.length === 0,
      indirectDependencies: this.indirectDependencies
    }
  }
}
