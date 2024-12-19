import { writeFileSync } from 'fs'
import { json2csv } from 'json-2-csv'
import { RequestError } from 'octokit'

import * as yarnLock from '@yarnpkg/lockfile'
import checkDenyList from './helpers/check-deny-list.mjs'
import checkServiceOwner from './helpers/check-service-owner.mjs'
import {
  NoPackageJsonError,
  CouldntReadPackageError,
  IndirectDependencyError,
  handleError,
} from './helpers/error-handling.mjs'
import {
  getRepoMetaData,
  getLatestCommit,
  getFileContent,
  getRepoTree,
} from './helpers/octokit.mjs'

import rawDeps from './data/raw-deps.json' assert { type: 'json' }

// Set up date for file naming
const currentDate = new Date()
const yyyymmdd = currentDate.toISOString().split('T')[0]
const timestamp = currentDate.getTime()

async function analyseRepo(repo) {
  // Output data columns
  const repoOwner = repo.owner
  const repoName = repo.repo_name
  let builtByGovernment = false
  let indirectDependency = false
  let isPrototype = false
  let frontendVersion = null
  let lockfileType = null
  let versionDoubt = false
  let couldntAccess = false
  let lastUpdated = null
  let repoCreated = null

  try {
    if (checkDenyList(repoName, repoOwner)) {
      console.log(
        `${performance.now()}: ${
          repo.name
        } is on the 'deny' list and will not be processed`
      )
    }

    builtByGovernment = checkServiceOwner(repoOwner)
    if (builtByGovernment) {
      console.log(
        `${performance.now()}: ${repo.name} looks like a GOV.UK service.`
      )
    } else {
      console.log(
        `${performance.now()}: ${
          repo.name
        } looks like it ISN'T a GOV.UK service. This has been noted.`
      )
    }

    // Get repo data
    const repoMetaData = await getRepoMetaData(repoOwner, repoName)
    if (repoMetaData) {
      lastUpdated = repoMetaData.data.pushed_at
      repoCreated = repoMetaData.data.created_at
    }

    const latestCommit = await getLatestCommit(repoOwner, repoName)
    const repoTree = await getRepoTree(repoOwner, repoName, latestCommit.sha)
    if (!repoTree.data.tree.find((file) => file.path == 'package.json')) {
      indirectDependency = true
      throw new NoPackageJsonError()
    }

    // Handle Package.json
    // TODO: account for multiple package files
    if (repoTree.data.tree.find((file) => file.path == 'package-lock.json')) {
      lockfileType = 'package-lock.json'
    } else if (repoTree.data.tree.find((file) => file.path == 'yarn.lock')) {
      lockfileType = 'yarn.lock'
    }

    const packageFile = await getFileContent(
      repoOwner,
      repoName,
      'package.json'
    )
    const packageObject = JSON.parse(packageFile.data)
    if (!('dependencies' in packageObject)) {
      indirectDependency = true
      throw new CouldntReadPackageError()
    }

    // Prototype checking
    isPrototype =
      repoTree.data.tree.find((file) => file.path == 'lib/usage_data.js') !=
        undefined || 'govuk-prototype-kit' in packageObject.dependencies
    if (isPrototype) {
      console.log(
        `${performance.now()}: ${
          repo.name
        } looks like an instance of the prototype kit. This has been noted.`
      )
    }

    // Handle indirect dependencies
    if (!('govuk-frontend' in packageObject.dependencies)) {
      indirectDependency = true
      throw new IndirectDependencyError()
    }

    frontendVersion = packageObject.dependencies['govuk-frontend']
    console.log(
      `${performance.now()}: ${
        repo.name
      } is using GOV.UK Frontend version ${frontendVersion}`
    )
    if (frontendVersion.includes('^') || frontendVersion.includes('~')) {
      frontendVersion = await getExactFrontendVersion(
        repoOwner,
        repoName,
        frontendVersion,
        lockfileType
      )
      versionDoubt =
        frontendVersion.includes('^') || frontendVersion.includes('~')
    }
  } catch (error) {
    handleError(error, repoName)
    if (error instanceof RequestError) {
      couldntAccess = true
      versionDoubt = true
    }
  }

  return {
    repoOwner,
    repoName,
    couldntAccess,
    frontendVersion,
    versionDoubt,
    builtByGovernment,
    indirectDependency,
    isPrototype,
    lastUpdated,
    repoCreated,
  }
}

async function getExactFrontendVersion(
  repoOwner,
  repoName,
  frontendVersion,
  lockfileType
) {
  try {
    if (lockfileType === 'package-lock.json') {
      const packageLockFile = await getFileContent(
        repoOwner,
        repoName,
        'package-lock.json'
      )
      const packageLockObject = JSON.parse(packageLockFile.data)
      return (
        packageLockObject.packages?.['node_modules/govuk-frontend']?.version ||
        packageLockObject.dependencies?.['govuk-frontend']?.version ||
        frontendVersion
      )
    } else if (lockfileType === 'yarn.lock') {
      const yarnLockFile = await getFileContent(
        repoOwner,
        repoName,
        'yarn.lock'
      )
      const yarnLockObject = yarnLock.default.parse(yarnLockFile.data)
      return (
        yarnLockObject.object[`govuk-frontend@${frontendVersion}`]?.version ||
        frontendVersion
      )
    }
  } catch (error) {
    console.log('There was a problem with processing the lockfile:', error)
  }
  return frontendVersion.replace('^', '').replace('~', '')
}

async function filterDeps() {
  const builtData = []
  const batchSize = 500
  let batchCounter = 0
  console.log(`${performance.now()}: Analysis BEGIN`)

  for (const repo of rawDeps.all_public_dependent_repos) {
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

    const rateLimit = await octokit.rest.rateLimit.get()
    console.log(`${rateLimit.data.rate.remaining} remaining on rate limit`)
  }
  if (batchCounter >= batchSize) {
    await writeBatchToFiles(builtData)
    builtData.length = 0
    batchCounter = 0
  }

  if (builtData.length > 0) {
    await writeBatchToFiles(builtData)
  }

  console.log(`${performance.now()}: We're done!`)
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
  console.log(`${performance.now()}: Data file updated with batch of entries`)
}

filterDeps()
