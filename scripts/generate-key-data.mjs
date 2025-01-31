import { writeFileSync } from 'fs'
import { argv } from 'process'

import data from '../data/filtered-data.json' with { type: 'json' }
import rawDeps from '../data/raw-deps.json' with { type: 'json' }
import denyList from '../helpers/data/deny-list.json' with { type: 'json' }

const verbose = argv.includes('--verbose')

function countDependencies (data) {
  let count = 0
  for (const repo of data) {
    count += repo.directDependencies.length
    count += repo.indirectDependencies.flat().length
  }
  return count
}

function countEmptyDependencies (data) {
  let count = 0
  for (const repo of data) {
    if (repo.directDependencies.length === 0 && repo.indirectDependencies.flat().length === 0) {
      if (verbose) {
        console.log(`${repo.repoOwner}/${repo.repoName} has no dependencies.`)
      }
      count++
    }
  }
  return count
}

function countInvalidRepos (data) {
  const invalidRepos = data.filter(repo => !repo.isValid)

  if (verbose) {
    for (const repo of invalidRepos) {
      console.log(`${repo.repoOwner}/${repo.repoName} is invalid.`)
    }
  }

  return invalidRepos.length
}

function countVersions (data) {
  const versions = { missingVersions: [] }
  for (const repo of data) {
    if (repo.directDependencies.length === 0 && repo.indirectDependencies.flat().length === 0) {
      versions.missingVersions.push(`${repo.repoOwner}/${repo.repoName}`)
    } else {
      if (repo.directDependencies.length > 0) {
        for (const dep of repo.directDependencies) {
          if (dep.actualVersion) {
            const majorNumber = dep.actualVersion.replace(/[~^=<>]/g, '').slice(0, 1)
            if (!versions[majorNumber]) {
              if (isNaN(majorNumber)) {
                versions[dep.actualVersion] = 1
              } else {
                versions[majorNumber] = { direct: [dep.actualVersion], indirect: [] }
              }
            } else {
              if (isNaN(majorNumber)) {
                versions[dep.actualVersion]++
              } else {
                versions[majorNumber].direct.push(dep.actualVersion)
              }
            }
          }
        }
      }
      if (repo.indirectDependencies.flat().length > 0) {
        for (const dep of repo.indirectDependencies.flat()) {
          if (dep.actualVersion) {
            const majorNumber = dep.actualVersion.replace(/^[~^=>]/, '').slice(0, 1)
            if (!versions[majorNumber]) {
              versions[majorNumber] = { direct: [], indirect: [dep.actualVersion] }
            } else {
              versions[majorNumber].indirect.push(dep.actualVersion)
            }
          }
        }
      }
    }
  }
  return versions
}

function countOtherVersions (versions) {
  let count = 0
  const keys = Object.keys(versions)
    .filter(version => !['0', '1', '2', '3', '4', '5', 'missingVersions'].includes(version))
  for (const key of keys) {
    count += versions[key]
  }

  return count
}

function hasDependencyOnVersion (version, repo) {
  const directDep = repo.directDependencies.some(dep => dep.actualVersion && dep.actualVersion.match(/\d/)[0] === version)
  const indirectDep = repo.indirectDependencies.flat().some(dep => dep.actualVersion && dep.actualVersion.match(/\d/)[0] === version)

  return directDep || indirectDep
}

function validateData (keyData) {
  keyData.keyDataValidated = true
  if (keyData.totalRepos < keyData.totalProcessed) {
    console.log('ERROR: Total processed exceeds total repos')
    keyData.keyDataValidated = false
  }
  if (keyData.totalRepos - keyData.totalProcessed > denyList.length) {
    console.log('ERROR: There are unprocessed repos which are not on the deny list')
    keyData.keyDataValidated = false
  }
  const totalVersions = keyData.usingVersion0 +
    keyData.usingVersion1 +
    keyData.usingVersion2 +
    keyData.usingVersion3 +
    keyData.usingVersion4 +
    keyData.usingVersion5 +
    keyData.usingOtherVersions
  if (totalVersions !== keyData.totalDependencies) {
    console.log('ERROR: Some package results are missing versions.')
    keyData.keyDataValidated = false
  }
}

const keyData = {}
const versions = countVersions(data)
const activeGovRepos = data.filter(repo => repo.builtByGovernment && !repo.isPrototype && new Date(repo.updatedAt) > new Date().setFullYear(new Date().getFullYear() - 1))

keyData.dateRun = new Date().toISOString()
keyData.totalRepos = rawDeps.all_public_dependent_repos.length
keyData.totalProcessed = data.length
keyData.totalDependencies = countDependencies(data)
keyData.reposWithoutDependencies = countEmptyDependencies(data)
keyData.reposWithServiceInfo = data.filter(repo => repo.name).length
keyData.invalidRepos = countInvalidRepos(data)
keyData.prototypes = data.filter(repo => repo.isPrototype).length
keyData.builtByGovernment = data.filter(repo => repo.builtByGovernment).length
keyData.usingVersion0 = versions['0'].direct.length + versions['0'].indirect.length
keyData.usingVersion1 = versions['1'].direct.length + versions['1'].indirect.length
keyData.usingVersion2 = versions['2'].direct.length + versions['2'].indirect.length
keyData.usingVersion3 = versions['3'].direct.length + versions['3'].indirect.length
keyData.usingVersion4 = versions['4'].direct.length + versions['4'].indirect.length
keyData.usingVersion5 = versions['5'].direct.length + versions['5'].indirect.length
keyData.usingOtherVersions = countOtherVersions(versions)
keyData.missingVersions = versions.missingVersions.length
keyData.totalVersions = keyData.usingVersion0 + keyData.usingVersion1 + keyData.usingVersion2 + keyData.usingVersion3 + keyData.usingVersion4 + keyData.usingVersion5 + keyData.usingOtherVersions + keyData.missingVersions
keyData.activeGovRepos = activeGovRepos.length
keyData.activeGovV5 = activeGovRepos.filter(repo => hasDependencyOnVersion('5', repo)).length
keyData.activeGovV4 = activeGovRepos.filter(repo => hasDependencyOnVersion('4', repo)).length
keyData.activeGovV3 = activeGovRepos.filter(repo => hasDependencyOnVersion('3', repo)).length
keyData.activeGovV2 = activeGovRepos.filter(repo => hasDependencyOnVersion('2', repo)).length
keyData.activeGovV1 = activeGovRepos.filter(repo => hasDependencyOnVersion('1', repo)).length
keyData.activeGovReposWithServiceData = activeGovRepos.filter(repo => repo.name).length
keyData.top75 = data.filter(repo => repo.tags?.includes('Top 75')).length

validateData(keyData)

writeFileSync('data/key-data.json', JSON.stringify(keyData, null, 2))
