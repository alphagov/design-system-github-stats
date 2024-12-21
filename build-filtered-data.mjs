import { writeFileSync } from 'fs'
import { json2csv } from 'json-2-csv'
import { RequestError } from 'octokit'

import denylist from './helpers/data/deny-list.json' assert { type: 'json' }
import governmentServiceOwners from './helpers/data/service-owners.json' assert { type: 'json' }
import {
  NoPackageJsonError,
  handleError,
  NoDataError,
} from './helpers/error-handling.mjs'
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
  console.log(`${performance.now()}: Analysis BEGIN`)

  for (const repo of rawDeps.all_public_dependent_repos) {
    try {
      console.log(`${performance.now()}: Getting repo data...`)
      const repoData = await analyseRepo(repo)
      if (repoData) {
        builtData.push(repoData)
        batchCounter++
      }
      console.log(`${performance.now()}: Analysis of ${repo.name} complete`)

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
  console.log(`${performance.now()}: We're done!`)
}

function log(message) {
  console.log(`${performance.now()}: ${message}`)
}

async function analyseRepo(repo) {
  const repoOwner = repo.owner
  const repoName = repo.repo_name
  const repoData = new RepoData(
    repoOwner,
    repoName,
    denylist,
    governmentServiceOwners
  )

  try {
    if (repoData.onDenyList) {
      log(`${repo.name} is on the 'deny' list and will not be processed`)
    }

    if (!(await repoData.fetchData())) {
      throw new NoDataError()
    }

    // TODO: Account for multiple package.json files, deeply nested
    if (!repoData.checkFileExists('package.json')) {
      throw new NoPackageJsonError()
    }

    if (repoData.builtByGovernment) {
      log(`${repo.name} looks like a GOV.UK service.`)
    } else {
      log(
        `${repo.name} looks like it ISN'T a GOV.UK service. This has been noted.`
      )
    }

    const packageFile = await repoData.getRepoFileContent('package.json')
    const packageObject = JSON.parse(packageFile.data)

    if (repoData.checkPrototype(packageObject)) {
      log(
        `${repo.name} looks like an instance of the prototype kit. This has been noted.`
      )
      repoData.isPrototype = true
    }

    // Handle indirect dependencies
    if (
      !('dependencies' in packageObject) ||
      !('govuk-frontend' in packageObject.dependencies)
    ) {
      repoData.indirectDependency = true
    }

    if (!repoData.indirectDependency) {
      repoData.frontendVersion = packageObject.dependencies['govuk-frontend']
      log(
        `${repo.name} is using GOV.UK Frontend version ${repoData.frontendVersion}`
      )
    }

    if (
      repoData.frontendVersion.startsWith('^') ||
      repoData.frontendVersion.startsWith('~') ||
      repoData.indirectDependency
    ) {
      repoData.versionDoubt = true
      repoData.frontendVersion = await repoData.getVersionFromLockfile()
    }
  } catch (error) {
    handleError(error, repoName)
    repoData.errorThrown = error.toString()
    if (error instanceof RequestError) {
      repoData.couldntAccess = true
      repoData.versionDoubt = true
    }
  }

  return repoData.getResult()
}

async function writeBatchToFiles(builtData) {
  // Write JSON file
  await writeFileSync(
    `data/${yyyymmdd}-${timestamp}-filtered-data.json`,
    JSON.stringify(builtData, null, 2)
  )
  // Write CSV file
  const csv = json2csv(builtData)
  await writeFileSync(`data/${yyyymmdd}-${timestamp}-filtered-data.csv`, csv)
  log(`Data file updated with batch of entries`)
}

filterDeps()
