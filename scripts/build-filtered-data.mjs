import { appendFileSync } from 'fs'
import { json2csv } from 'json-2-csv'
import { RequestError } from 'octokit'

import denyList from '../helpers/data/deny-list.json' with { type: 'json' }
import governmentServiceOwners from '../helpers/data/service-owners.json' with { type: 'json' }
import { getRemainingRateLimit } from '../helpers/octokit.mjs'
import { RepoData } from '../helpers/repo-data.mjs'
import { Result } from '../helpers/result.mjs'

import rawDeps from '../data/raw-deps.json' with { type: 'json' }

async function filterDeps () {
  const builtData = []
  const batchSize = 500
  const processedIndexes = []
  let batchCounter = 0
  console.log('Beginning dependency analysis...')

  for (const repo of rawDeps.all_public_dependent_repos) {
    try {
      console.log(`${repo.name}: Getting repo data...`)
      const repoData = await analyseRepo(repo)
      if (repoData) {
        builtData.push(repoData)
        batchCounter++
      }
      console.log(`${repo.name}: Analysis complete`)

      const index = rawDeps.all_public_dependent_repos.findIndex(
        (item) => item === repo
      )
      processedIndexes.push(index)
      console.log(
        `This was repo number ${index + 1} of ${
          rawDeps.all_public_dependent_repos.length
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
      await writeBatchToFiles(builtData, batchCounter, batchSize)
      builtData.length = 0
      batchCounter = 0
    }
  }

  if (builtData.length > 0) {
    writeBatchToFiles(builtData, batchCounter, batchSize)
  }

  const unprocessedItems = rawDeps.all_public_dependent_repos.filter((_, index) => !processedIndexes.includes(index))

  appendFileSync(
    'data/unprocessedItems.json',
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
      return null
    }
    repoData.log('analyzing...')

    result.builtByGovernment = repoData.checkServiceOwner(governmentServiceOwners)

    if (governmentServiceOwners[repoOwner]?.[repoName]) {
      result.service = governmentServiceOwners[repoOwner][repoName]
    }

    // Get the repo metadata
    const repoInfo = await repoData.getRepoInfo()
    Object.assign(result, repoInfo)

    // Get the repo tree
    result.repoTree = await repoData.getRepoTree(result.latestCommitSHA)

    // Get the package.json files
    const packageObjects = await repoData.getPackageFiles(result.repoTree)

    // Check if repo is instance of the GOV.UK Prototype Kit
    if (repoData.checkPrototype(packageObjects, result.repoTree)) {
      result.isPrototype = true
    }

    // Get all dependency versions
    result.directDependencies = repoData.getDirectDependencies(packageObjects)

    if (result.directDependencies.length === 0) {
      result.indirectDependencies = await repoData.getIndirectDependencies(packageObjects, result.repoTree)
    } else {
      result.directDependencies = await repoData.disambiguateDependencies(result.directDependencies, result.repoTree)
    }
  } catch (error) {
    repoData.handleError(error)
  }
  result.errorsThrown = repoData.errorsThrown

  return result.getResult(repoData)
}

function writeBatchToFiles (builtData, batchCounter, batchSize) {
  // Write JSON file
  const jsonFilePath = 'data/filtered-data.json'
  const jsonData = JSON.stringify(builtData, null, 2)

  if (batchCounter === 0) {
    // First batch, write the opening bracket
    appendFileSync(jsonFilePath, jsonData.slice(0, -1) + ',')
  } else if (builtData.length < batchSize) {
    // Final batch, include the closing bracket
    appendFileSync(jsonFilePath, jsonData.slice(1))
  } else {
    // Subsequent batches, replace the opening bracket with a comma
    appendFileSync(jsonFilePath, ',' + jsonData.slice(1, -1))
  }

  // Write CSV file
  const csv = json2csv(builtData)
  appendFileSync('data/filtered-data.csv', csv)
  console.log('Data file updated with batch of entries')
}

filterDeps()
