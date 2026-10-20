import { readFileSync, writeFileSync } from 'fs'
import { argv } from 'process'
import { fileURLToPath } from 'url'
import path from 'path'

import { getAllDeps, repoKey } from '../helpers/raw-deps.mjs'
import denyList from '../helpers/data/deny-list.json' with { type: 'json' }

const __filename = fileURLToPath(import.meta.url)

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

/**
 * The first digit of a version string, if it has one.
 *
 * Versions like 'latest', 'workspace:*' or git URLs contain no digits and
 * return null rather than throwing.
 *
 * @param {string} versionString - eg '^5.2.0'
 * @returns {string|null} - eg '5'
 */
export function getMajorVersion (versionString) {
  const match = String(versionString ?? '').match(/\d/)
  return match ? match[0] : null
}

/**
 * All dependency entries for a repo, direct and indirect
 *
 * @param {object} repo - A repo result from filtered-data.json
 * @returns {Array<object>} - The dependency entries
 */
function getAllDependencies (repo) {
  return [...repo.directDependencies, ...(repo.indirectDependencies || []).flat()]
}

/**
 * The set of GOV.UK Frontend major versions a repo uses, across all of its
 * direct and indirect dependencies
 *
 * @param {object} repo - A repo result from filtered-data.json
 * @returns {Set<string>} - eg new Set(['4', '5'])
 */
export function getRepoMajorVersions (repo) {
  const majors = new Set()
  for (const dep of getAllDependencies(repo)) {
    const major = getMajorVersion(dep.actualVersion ?? dep.specifiedVersion)
    if (major) {
      majors.add(major)
    }
  }
  return majors
}

function isActive (repo) {
  return new Date(repo.updatedAt) > new Date(Date.now() - ONE_YEAR_MS)
}

/**
 * Counts repos per GOV.UK Frontend major version. A repo counts towards
 * every major it uses (eg a monorepo on both v4 and v5 counts for both).
 *
 * @param {Array<object>} repos - Repo results
 * @returns {object} - eg { '4': 160, '5': 505, other: 3 }
 */
export function countByVersion (repos) {
  const counts = {}
  for (const repo of repos) {
    const majors = getRepoMajorVersions(repo)
    if (majors.size === 0) {
      // Repo has dependencies, but none with a parseable numeric version
      if (getAllDependencies(repo).length > 0) {
        counts.other = (counts.other || 0) + 1
      }
      continue
    }
    for (const major of majors) {
      counts[major] = (counts[major] || 0) + 1
    }
  }
  return counts
}

/**
 * Adds version stats for a cohort of repos to the key data, with one key
 * per major version in use (eg prefix 'prototypesV' gives prototypesV5)
 *
 * @param {object} keyData - The key data being built
 * @param {string} prefix - The key prefix
 * @param {Array<object>} repos - The cohort of repos
 * @param {Array<string>} allMajors - Every major version in use across all repos
 */
function addVersionStats (keyData, prefix, repos, allMajors) {
  const counts = countByVersion(repos)
  for (const major of allMajors) {
    keyData[`${prefix}${major}`] = counts[major] || 0
  }
  keyData[`${prefix}Other`] = counts.other || 0
}

function getParents (data, verbose) {
  const parents = {}
  for (const repo of data) {
    for (const dep of (repo.indirectDependencies || []).flat()) {
      if (dep.parent) {
        parents[dep.parent] = (parents[dep.parent] || 0) + 1
      }
    }
  }
  if (verbose) {
    const sortedParents = Object.entries(parents).sort((a, b) => b[1] - a[1])
    for (const [parent, count] of sortedParents) {
      console.log(`${parent} is used in ${count} packages.`)
    }
  }
  return parents
}

function validateKeyData (keyData) {
  keyData.keyDataValidated = true

  // Deny-listed repos are processed but produce no result, so they're
  // neither in totalProcessed nor totalUnprocessed
  const accountedFor = keyData.totalProcessed + keyData.totalUnprocessed + keyData.denyListed
  if (accountedFor !== keyData.totalRepos) {
    console.log(`ERROR: processed (${keyData.totalProcessed}) + unprocessed (${keyData.totalUnprocessed}) + deny-listed (${keyData.denyListed}) does not equal total repos (${keyData.totalRepos})`)
    keyData.keyDataValidated = false
  }

  // Every repo with dependencies should count towards at least one version
  // bucket, or towards 'other'
  const reposWithDeps = keyData.totalProcessed - keyData.reposWithoutDependencies
  const reposCounted = keyData.versionedRepos + keyData.usingOther
  if (reposCounted !== reposWithDeps) {
    console.log(`ERROR: ${reposWithDeps} repos have dependencies but only ${reposCounted} are counted in a version bucket`)
    keyData.keyDataValidated = false
  }
}

/**
 * Builds the key data summary from the analysis results
 *
 * @param {object} inputs
 * @param {Array<object>} inputs.data - The repo results from filtered-data.json
 * @param {number} inputs.totalRepos - The total number of known dependent repos
 * @param {number} inputs.totalUnprocessed - The number of repos analysis didn't process
 * @param {number} [inputs.denyListed=0] - The number of known dependents on the deny list
 * @param {boolean} [inputs.verbose=false] - Whether to log details
 * @returns {object} - The key data
 */
export function buildKeyData ({ data, totalRepos, totalUnprocessed, denyListed = 0, verbose = false }) {
  const keyData = {}

  const government = data.filter(repo => repo.builtByGovernment)
  const prototypes = data.filter(repo => repo.isPrototype)
  const active = data.filter(isActive)
  const activeGov = active.filter(repo => repo.builtByGovernment)
  const activePrototypes = prototypes.filter(isActive)
  const activeGovPrototypes = activePrototypes.filter(repo => repo.builtByGovernment)

  const cohorts = {
    using: data,
    activeV: active,
    activeGovV: activeGov,
    prototypesV: prototypes,
    activePrototypesV: activePrototypes,
    activeGovPrototypesV: activeGovPrototypes
  }

  // Collect every major version in use so each cohort reports the same keys
  const allMajors = [...new Set(data.flatMap(repo => [...getRepoMajorVersions(repo)]))].sort()

  keyData.dateRun = new Date().toISOString()
  keyData.totalRepos = totalRepos
  keyData.totalProcessed = data.length
  keyData.totalUnprocessed = totalUnprocessed
  keyData.denyListed = denyListed
  keyData.totalDependencies = data.reduce((total, repo) => total + getAllDependencies(repo).length, 0)
  keyData.reposWithoutDependencies = data.filter(repo => getAllDependencies(repo).length === 0).length
  keyData.reposWithServiceInfo = data.filter(repo => repo.name).length
  keyData.invalidRepos = data.filter(repo => !repo.isValid).length
  keyData.builtByGovernment = government.length
  keyData.prototypes = prototypes.length
  keyData.activeRepos = active.length
  keyData.activeGovRepos = activeGov.length
  keyData.activeGovReposWithServiceData = activeGov.filter(repo => repo.name).length
  keyData.activePrototypes = activePrototypes.length
  keyData.activeGovPrototypes = activeGovPrototypes.length
  keyData.top75 = data.filter(repo => repo.tags?.includes('Top 75')).length
  keyData.parentPackageCount = Object.keys(getParents(data, verbose)).length

  // Repos using at least one parseable version
  keyData.versionedRepos = data.filter(repo => getRepoMajorVersions(repo).size > 0).length

  for (const [prefix, repos] of Object.entries(cohorts)) {
    addVersionStats(keyData, prefix, repos, allMajors)
  }

  if (verbose) {
    for (const repo of data) {
      if (getAllDependencies(repo).length === 0) {
        console.log(`${repo.repoOwner}/${repo.repoName} has no dependencies.`)
      }
      if (!repo.isValid) {
        console.log(`${repo.repoOwner}/${repo.repoName} is invalid.`)
      }
    }
  }

  validateKeyData(keyData)

  return keyData
}

// Only run when executed directly, not when imported (eg by tests)
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const verbose = argv.includes('--verbose')

  const data = JSON.parse(readFileSync('data/filtered-data.json', 'utf8'))
  const unprocessed = JSON.parse(readFileSync('data/unprocessedItems.json', 'utf8'))
  const allDeps = getAllDeps()
  const denyListed = denyList.filter(item => allDeps.has(repoKey({ owner: item.owner, repo_name: item.name }))).length

  const keyData = buildKeyData({
    data,
    totalRepos: allDeps.size,
    totalUnprocessed: unprocessed.length,
    denyListed,
    verbose
  })

  writeFileSync('data/key-data.json', JSON.stringify(keyData, null, 2))
  console.log(`Key data written to data/key-data.json (validated: ${keyData.keyDataValidated})`)
}
