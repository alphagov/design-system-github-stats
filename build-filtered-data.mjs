import { appendFileSync } from 'fs'
import { json2csv } from 'json-2-csv'
import { RequestError } from 'octokit'

import denyList from './helpers/data/deny-list.json' assert { type: 'json' }
import governmentServiceOwners from './helpers/data/service-owners.json' assert { type: 'json' }
import { handleError } from './helpers/error-handling.mjs'
import { getRemainingRateLimit } from './helpers/octokit.mjs'
import { RepoData } from './helpers/repo-data.mjs'

import rawDeps from './data/raw-deps.json' assert { type: 'json' }

// Set up date for file naming
const currentDate = new Date()
const yyyymmdd = currentDate.toISOString().split('T')[0]
const timestamp = currentDate.getTime()

async function filterDeps() {
  const builtData = []
  const batchSize = 500
  let batchCounter = 0
  console.log(`Beginning dependency analysis...`)

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
  console.log(`We're done!`)
}

async function analyseRepo(repo) {
  const repoOwner = repo.owner
  const repoName = repo.repo_name
  const repoData = new RepoData(repoOwner, repoName, governmentServiceOwners)

  try {
    if (repoData.checkDenyList(denyList)) {
      repoData.log(`on Deny List. Will not be processed.`)
      return null
    }
    repoData.log(`analyzing...`)

    await repoData.fetchAndValidateMetaData()
    repoData.log(`metadata fetched and validated.`)
    await repoData.fetchAndValidateRepoTree()
    repoData.log(`tree fetched and validated.`)

    if (repoData.builtByGovernment) {
      repoData.log(`looks like a GOV.UK service.`)
    } else {
      repoData.log(`looks like it ISN'T a GOV.UK service. This has been noted.`)
    }

    const packageFile = await repoData.getRepoFileContent('package.json')
    const packageObject = JSON.parse(packageFile.data)

    if (await repoData.checkPrototype(packageObject)) {
      repoData.log(`looks like an instance of the prototype kit.`)
      repoData.isPrototype = true
    }

    // Handle indirect dependencies
    if (
      !('dependencies' in packageObject) ||
      !('govuk-frontend' in packageObject.dependencies)
    ) {
      repoData.indirectDependency = true
      repoData.log(`govuk-frontend is not a direct dependency.`)
    }

    if (!repoData.indirectDependency) {
      repoData.frontendVersion = packageObject.dependencies['govuk-frontend']
      repoData.log(`using GOV.UK Frontend version ${repoData.frontendVersion}`)
    }

    if (
      !!repoData.frontendVersion?.startsWith('^') ||
      !!repoData.frontendVersion?.startsWith('~') ||
      repoData.indirectDependency
    ) {
      repoData.log(`searching for version in lockfile`)
      repoData.versionDoubt = true
      // @TODO: Get lockfile type here and log it. Pass to next function
      repoData.frontendVersion = await repoData.getVersionFromLockfile()
    }
  } catch (error) {
    repoData.errorThrown = error.toString()
    handleError(error, repoName)
    if (error instanceof RequestError) {
      repoData.couldntAccess = true
      repoData.versionDoubt = true
    }
  }

  return repoData.getResult()
}

async function writeBatchToFiles(builtData) {
  // Write JSON file
  await appendFileSync(
    `data/${yyyymmdd}-${timestamp}-filtered-data.json`,
    JSON.stringify(builtData, null, 2)
  )
  // Write CSV file
  const csv = json2csv(builtData)
  await appendFileSync(`data/${yyyymmdd}-${timestamp}-filtered-data.csv`, csv)
  console.log(`Data file updated with batch of entries`)
}

filterDeps()
