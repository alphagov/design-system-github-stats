import { writeFileSync, readdirSync, readFileSync } from 'fs'
import { json2csv } from 'json-2-csv'
import { RequestError } from 'octokit'
import { fileURLToPath } from 'url'
import path, { dirname } from 'path'

import denyList from '../helpers/data/deny-list.json' with { type: 'json' }
import governmentServiceOwners from '../helpers/data/service-owners.json' with { type: 'json' }
import { getRemainingRateLimit } from '../helpers/octokit.mjs'
import { RepoData } from '../helpers/repo-data.mjs'
import { Result } from '../helpers/result.mjs'

import rawDeps from '../data/raw-deps.json' with { type: 'json' }

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function filterDeps () {
  const builtData = []
  const processedIndexes = []

  // Add port raw deps
  const allDeps = new Set()

  const rawDepFiles = readdirSync(path.resolve(__dirname, '../data')).filter(file => file.startsWith('raw-deps'))
  if (rawDepFiles && rawDepFiles.length > 0) {
    for (const file of rawDepFiles) {
      const rawDepData = JSON.parse(readFileSync(path.resolve(__dirname, `../data/${file}`), 'utf8'))
      rawDepData.all_public_dependent_repos.forEach(repo => allDeps.add(repo))
    }
  }

  console.log('Beginning dependency analysis...')

  for (const repo of allDeps) {
    try {
      console.log(`${repo.name}: Getting repo data...`)
      const repoData = await analyseRepo(repo)
      if (repoData) {
        builtData.push(repoData)
      }
      console.log(`${repo.name}: Analysis complete`)

      const index = allDeps.findIndex(
        (item) => item === repo
      )
      processedIndexes.push(index)
      console.log(
        `This was repo number ${index + 1} of ${
          allDeps.length
        }`
      )

      const remaining = await getRemainingRateLimit()
      console.log(`${remaining} remaining on rate limit`)
    } catch (error) {
      if (error instanceof RequestError) {
        continue
      }
    }
  }

  if (builtData.length > 0) {
    writeToFiles(builtData, processedIndexes)
  }
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

function writeToFiles (builtData, processedIndexes) {
  // Write JSON file
  const jsonData = JSON.stringify(builtData, null, 2)
  writeFileSync('data/filtered-data.json', jsonData)

  // Write CSV file
  const csv = json2csv(builtData)
  writeFileSync('data/filtered-data.csv', csv)
  console.log('Data file updated with batch of entries')

  // Write Unprocessed Items file
  const unprocessedItems = rawDeps.all_public_dependent_repos.filter((_, index) => !processedIndexes.includes(index))
  writeFileSync(
    'data/unprocessedItems.json',
    JSON.stringify(unprocessedItems, null, 2)
  )
}

filterDeps()
