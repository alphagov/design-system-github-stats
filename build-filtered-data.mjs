import { appendFileSync } from 'fs'
import { json2csv } from 'json-2-csv'
import { RequestError } from 'octokit'

import denyList from './helpers/data/deny-list.json' with { type: 'json' }
import governmentServiceOwners from './helpers/data/service-owners.json' with { type: 'json' }
import { getRemainingRateLimit } from './helpers/octokit.mjs'
import { RepoData } from './helpers/repo-data.mjs'
import { Result } from './helpers/result.mjs'

import rawDeps from './data/raw-deps.json' with { type: 'json' }

// Set up date for file naming
const currentDate = new Date()
const yyyymmdd = currentDate.toISOString().split('T')[0]
const timestamp = currentDate.getTime()

async function filterDeps () {
  const builtData = []
  const batchSize = 500
  const processedIndexes = []
  let batchCounter = 0
  console.log('Beginning dependency analysis...')

  for (const repo of rawDeps.all_public_dependent_repos.slice(0, 20)) {
    try {
      console.log(`${repo.name}: Getting repo data...`)
      const repoData = await analyseRepo(repo)
      if (repoData) {
        builtData.push(repoData)
        batchCounter++
      }
      console.log(`${repo.name}: Analysis complete`)

      const index = rawDeps.all_public_dependent_repos.slice(0, 20).findIndex(
        (item) => item === repo
      )
      processedIndexes.push(index)
      console.log(
        `This was repo number ${index + 1} of ${
          rawDeps.all_public_dependent_repos.slice(0, 20).length
        }`
      )

      const remaining = await getRemainingRateLimit()
      console.log(`${remaining} remaining on rate limit`)
    } catch (error) {
      if (error instanceof RequestError) {
        continue
      }
    }
    if (batchCounter >= batchSize) {
      await writeBatchToFiles(builtData)
      builtData.length = 0
      batchCounter = 0
    }
  }

  if (builtData.length > 0) {
    await writeBatchToFiles(builtData)
  }

  const unprocessedItems = rawDeps.all_public_dependent_repos.filter((_, index) => !processedIndexes.includes(index))

  await appendFileSync(
    `data/${yyyymmdd}-${timestamp}-unprocessedItems.json`,
    JSON.stringify(unprocessedItems, null, 2)
  )
  console.log("We're done!")
}

export async function analyseRepo (repo) {
  const repoOwner = repo.owner
  const repoName = repo.repo_name
  const repoData = new RepoData(repoOwner, repoName)
  const result = new Result(repoOwner, repoName)

  try {
    // Run some checks
    if (repoData.checkDenyList(denyList)) {
      repoData.log('on Deny List. Will not be processed.')
      return null
    }
    repoData.log('analyzing...')

    if (repoData.checkServiceOwner(governmentServiceOwners)) {
      repoData.log('looks like a GOV.UK service.')
      result.builtByGovernment = true
    } else {
      repoData.log("looks like it ISN'T a GOV.UK service.")
    }

    // Get the repo metadata
    const repoInfo = await repoData.getRepoInfo()
    Object.assign(result, repoInfo)
    repoData.log('repo fetched.')
    repoData.log(`GraphQL rate limit remaining: ${result.graphQLRateLimit.remaining}`)

    // Get the repo tree
    result.repoTree = await repoData.getRepoTree(result.latestCommitSHA)
    repoData.log('tree fetched.')

    // Get the package.json files
    const packageObjects = await repoData.getPackageFiles(result.repoTree)
    repoData.log(
      `${packageObjects.length} package file${
        packageObjects.length === 0 || packageObjects.length > 1 ? 's' : ''
      } found.`
    )

    repoData.log(`${packageObjects.length} package file(s) found.`)

    // Check if repo is instance of the GOV.UK Prototype Kit
    if (repoData.checkPrototype(packageObjects, result.repoTree)) {
      repoData.log('looks like an instance of the prototype kit.')
      result.isPrototype = true
    }

    repoData.log('Looking for direct dependencies')
    // Get all dependency versions
    result.directDependencies = repoData.getDirectDependencies(packageObjects)
    repoData.log(`${result.directDependencies.length} direct dependencies found.`)

    if (result.directDependencies.length === 0) {
      repoData.log('govuk-frontend is not a direct dependency.')
      repoData.log('searching for indirect dependencies')
      result.indirectDependencies = await repoData.getIndirectDependencies(packageObjects, result.repoTree)
      repoData.log(`${result.indirectDependencies.length} direct dependencies found.`)
    } else {
      result.directDependencies = await repoData.disambiguateDependencies(result.directDependencies, result.repoTree)
    }
  } catch (error) {
    repoData.handleError(error)
    if (error instanceof RequestError) {
      repoData.couldntAccess = true
      repoData.versionDoubt = true
    }
  }

  return result.getResult()
}

async function writeBatchToFiles (builtData) {
  // Write JSON file
  await appendFileSync(
    `data/${yyyymmdd}-${timestamp}-filtered-data.json`,
    JSON.stringify(builtData, null, 2)
  )
  // Write CSV file
  const csv = json2csv(builtData)
  await appendFileSync(`data/${yyyymmdd}-${timestamp}-filtered-data.csv`, csv)
  console.log('Data file updated with batch of entries')
}

filterDeps()
