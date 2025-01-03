import Database from 'better-sqlite3'

const db = new Database('../data/database.db')

export function setupDatabase () {
  db.run(`
    CREATE TABLE IF NOT EXISTS repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repoOwner TEXT,
      repoName TEXT,
      couldntAccess BOOLEAN,
      lockfileFrontendVersion TEXT,
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
}

export function insertRepoData (repo) {
  const insertRepo = db.prepare(`
    INSERT OR REPLACE INTO repos (
      repoOwner,
      repoName,
      couldntAccess,
      lockfileFrontendVersion,
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

  insertRepo.run({
    repoOwner: repo.repoOwner,
    repoName: repo.repoName,
    couldntAccess: repo.couldntAccess,
    lockfileFrontendVersion: repo.lockfileFrontendVersion,
    directDependencyVersions: JSON.stringify(repo.directDependencyVersions),
    versionDoubt: repo.versionDoubt,
    builtByGovernment: repo.builtByGovernment,
    indirectDependency: repo.indirectDependency,
    isPrototype: repo.isPrototype,
    lastUpdated: repo.lastUpdated,
    repoCreated: repo.repoCreated,
    parentDependency: JSON.stringify(repo.parentDependency),
    errorThrown: repo.errorThrown
  })
}
