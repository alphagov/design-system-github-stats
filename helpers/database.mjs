import Database from 'better-sqlite3'

export class RepoDB {
  constructor () {
    this.db = new Database('./data/database.db')
    const setup = this.db.prepare(`
      CREATE TABLE IF NOT EXISTS repos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repoOwner TEXT,
        repoName TEXT,
        couldntAccess BOOLEAN,
        lockfileFrontendVersion TEXT,
        latestVersion TEXT,
        directDependencyVersions TEXT,
        versionDoubt BOOLEAN,
        builtByGovernment BOOLEAN,
        indirectDependency BOOLEAN,
        isPrototype BOOLEAN,
        lastUpdated TEXT,
        repoCreated TEXT,
        parentDependency TEXT,
        errorThrown TEXT,
        UNIQUE(repoOwner, repoName)
      )
    `)
    setup.run()

    // Create an index on repoOwner and repoName for faster lookups
    const indexSetup = this.db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_repo_owner_name ON repos (repoOwner, repoName)
    `)
    indexSetup.run()
  }

  getRepoData (repoOwner, repoName) {
    const query = this.db.prepare(`
      SELECT * FROM repos
      WHERE repoOwner = ? AND repoName = ?
    `)

    const result = query.get(repoOwner, repoName)
    if (!result) {
      return null
    }
    return this.denormaliseData(result)
  }

  isRepoUpToDate (repoOwner, repoName, lastUpdated) {
    const query = this.db.prepare(`
      SELECT lastUpdated FROM repos
      WHERE repoOwner = ? AND repoName = ?
    `)
    const result = query.get(repoOwner, repoName)
    return result && result.lastUpdated === lastUpdated
  }

  insertRepoData (repo) {
    try {
      const insertRepo = this.db.prepare(`
      INSERT OR REPLACE INTO repos (
        repoOwner,
        repoName,
        couldntAccess,
        lockfileFrontendVersion,
        latestVersion,
        directDependencyVersions,
        versionDoubt,
        builtByGovernment,
        indirectDependency,
        isPrototype,
        lastUpdated,
        repoCreated,
        parentDependency,
        errorThrown
      ) VALUES (
        @repoOwner,
        @repoName,
        @couldntAccess,
        @lockfileFrontendVersion,
        @latestVersion,
        @directDependencyVersions,
        @versionDoubt,
        @builtByGovernment,
        @indirectDependency,
        @isPrototype,
        @lastUpdated,
        @repoCreated,
        @parentDependency,
        @errorThrown
      )
    `)

      const dataForDB = this.normaliseData(repo)

      insertRepo.run(dataForDB)
    } catch (error) {
      console.log(error)
    }
  }

  getKeyData () {
    const query = this.db.prepare(`
      SELECT
      (SELECT COUNT(*) FROM repos) AS Total,
      (SELECT COUNT(*) FROM repos WHERE builtByGovernment = 1) AS NumberBuiltByGovernment,
      (SELECT COUNT(*) FROM repos WHERE latestVersion = '' OR latestVersion IS NULL) AS VersionUnknown,
      (SELECT COUNT(*) FROM repos WHERE latestVersion LIKE '0.%') AS version0,
      (SELECT COUNT(*) FROM repos WHERE latestVersion LIKE '1.%') AS version1,
      (SELECT COUNT(*) FROM repos WHERE latestVersion LIKE '2.%') AS version2,
      (SELECT COUNT(*) FROM repos WHERE latestVersion LIKE '3.%') AS version3,
      (SELECT COUNT(*) FROM repos WHERE latestVersion LIKE '4.%') AS version4,
      (SELECT COUNT(*) FROM repos WHERE latestVersion LIKE '5.%') AS version5,
      (SELECT COUNT(*) FROM repos WHERE isPrototype = 1) AS prototypes,
      (SELECT COUNT(*) FROM repos WHERE lastUpdated >= date('now', '-1 year')) AS activeRepos,
      (SELECT COUNT(*) FROM repos WHERE errorThrown IS NOT NULL AND errorThrown != '') AS errors
    `)

    return query.get()
  }

  getRowCount () {
    const query = this.db.prepare('SELECT COUNT(*) AS count FROM repos')
    const result = query.get()
    return result.count
  }

  normaliseData (dataset) {
    const normalisedData = {}
    for (const [key, value] of Object.entries(dataset)) {
      if (typeof value === 'boolean') {
        normalisedData[key] = value ? 1 : 0
      } else if (value === null || value === undefined) {
        normalisedData[key] = ''
      } else if (typeof value === 'object') {
        normalisedData[key] = JSON.stringify(value)
      } else {
        normalisedData[key] = value
      }
    }
    return normalisedData
  }

  denormaliseData (dataset) {
    const denormalisedData = {}
    for (const [key, value] of Object.entries(dataset)) {
      if (value === 0 || value === 1) {
        denormalisedData[key] = value === 1
      } else if (value === '') {
        denormalisedData[key] = null
      } else {
        try {
          denormalisedData[key] = JSON.parse(value)
        } catch (error) {
          denormalisedData[key] = value
        }
      }
    }
    return denormalisedData
  }

  close () {
    this.db.close()
  }
}
