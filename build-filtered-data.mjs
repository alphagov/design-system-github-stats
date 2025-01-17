import { appendFileSync } from 'fs'
import { json2csv } from 'json-2-csv'
import { RequestError } from 'octokit'
import fetch from 'node-fetch'

import denyList from './helpers/data/deny-list.json' with { type: 'json' }
import governmentOwners from './helpers/data/service-owners.json' with { type: 'json' }
import { getRemainingRateLimit } from './helpers/octokit.mjs'
import { RepoData } from './helpers/repo-data.mjs'
import { Result } from './helpers/result.mjs'

import rawDeps from './data/raw-deps.json' with { type: 'json' }

async function getServices () {
  const response = await fetch('https://govuk-digital-services.herokuapp.com/data.json')
  if (!response.ok) {
    throw new Error(`Failed to fetch data: ${response.statusText}`)
  }
  return await response.json()
}
const services = await getServices()

const serviceOwnersSet = new Set()

for (const service of services.services) {
  if (service.sourceCode) {
    for (const source of service.sourceCode) {
      const url = new URL(source.href)
      const owner = url.pathname.split('/')[1]
      if (owner) {
        serviceOwnersSet.add(owner)
      }
    }
  }
}

const serviceOwners = Array.from(serviceOwnersSet)

const governmentRepoOwners = [...new Set(governmentOwners.concat(serviceOwners))]
console.log(JSON.stringify(governmentRepoOwners, null, 2))

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

  // Check if the repo is in the services list
  // @TODO abstract this and optimise it away from a loop
  for (const service of services.services) {
    if (service.sourceCode) {
      for (const source of service.sourceCode) {
        if (source.href.includes(`/${repoOwner}/${repoName}`)) {
          result.service = {
            name: service.name,
            description: service.description,
            theme: service.theme,
            organisation: service.organisation,
            liveservice: service.liveservice,
            facing: service.facing,
            sourceCode: service.sourceCode,
            startPage: service['start-page']
          }

          if (service.tags?.includes('Top 75')) {
            result.service.top75 = true
          }
          break
        }
      }
    }
  }

  try {
    // Run some checks
    if (repoData.checkDenyList(denyList)) {
      return null
    }
    repoData.log('analyzing...')

    result.builtByGovernment = repoData.checkServiceOwner(governmentRepoOwners)

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
    result.errorsThrown = repoData.errorsThrown
  }

  return result.getResult(repoData)
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
