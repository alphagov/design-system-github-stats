import { appendFileSync } from 'fs'
import { json2csv } from 'json-2-csv'
import { RequestError } from 'octokit'
import JSON5 from 'json5'

import denyList from './helpers/data/deny-list.json' with { type: 'json' }
import governmentServiceOwners from './helpers/data/service-owners.json' with { type: 'json' }
import { getRemainingRateLimit } from './helpers/octokit.mjs'
import { RepoData } from './helpers/repo-data.mjs'

import rawDeps from './data/raw-deps.json' with { type: 'json' }

// Set up date for file naming
const currentDate = new Date()
const yyyymmdd = currentDate.toISOString().split('T')[0]
const timestamp = currentDate.getTime()

async function filterDeps () {
  const builtData = []
  const batchSize = 500
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
  console.log("We're done!")
}

export async function analyseRepo (repo) {
  const repoOwner = repo.owner
  const repoName = repo.repo_name
  const repoData = new RepoData(repoOwner, repoName, governmentServiceOwners)

  try {
    if (repoData.checkDenyList(denyList)) {
      repoData.log('on Deny List. Will not be processed.')
      return null
    }
    repoData.log('analyzing...')

    await repoData.fetchAndValidateRepoInfo()
    repoData.log('repo metadata and latest commit details fetched and validated.')
    repoData.log(`GraphQL rate limit remaining: ${repoData.graphQLRateLimit.remaining}`)
    await repoData.fetchAndValidateRepoTree()
    repoData.log('tree fetched and validated.')

    if (repoData.builtByGovernment) {
      repoData.log('looks like a GOV.UK service.')
    } else {
      repoData.log("looks like it ISN'T a GOV.UK service. This has been noted.")
    }

    const packageFiles = await repoData.getAllFilesContent('package.json')
    let packageObjects = []
    if (packageFiles.length === 0) {
      repoData.log('no package files found.')
      repoData.versionDoubt = true
    } else {
      try {
        packageObjects = packageFiles.map((file) => {
          return {
            content: JSON5.parse(file.content),
            path: file.path
          }
        })
      } catch (error) {
        throw new Error('Problem parsing package.json. It\'s likely malformed')
      }
      repoData.log(
        `${packageObjects.length} package file${
          packageObjects.length > 1 ? 's' : ''
        } found.`
      )
    }

    if (repoData.checkPrototype(packageObjects)) {
      repoData.log('looks like an instance of the prototype kit.')
      repoData.isPrototype = true
    }
    if (!repoData.checkDirectDependency(packageObjects)) {
      repoData.log('govuk-frontend is not a direct dependency.')
    } else {
      for (const versionData of repoData.frontendVersions) {
        repoData.log(
          `${versionData.packagePath} specifies GOV.UK Frontend version ${versionData.frontendVersion}`
        )
        if (
          !!versionData.frontendVersion.startsWith('^') ||
          !!versionData.frontendVersion.startsWith('~') ||
          !!versionData.frontendVersion.startsWith('*') ||
          repoData.indirectDependency
        ) {
          repoData.log('searching for version in lockfile')
          repoData.versionDoubt = true
          const lockfileType = repoData.getLockfileType(versionData.packagePath)
          repoData.log(`using ${lockfileType}`)
          repoData.lockfileFrontendVersion = await repoData.getVersionFromLockfile(lockfileType, versionData.packagePath)
          if (repoData.lockfileFrontendVersion) {
            repoData.log(
            `using GOV.UK Frontend version ${repoData.lockfileFrontendVersion}`
            )
          } else {
            repoData.log('exact GOV.UK Frontend version could not be determined from lockfile.')
          }
        }
      }
    }
  } catch (error) {
    repoData.handleError(error)
    if (error instanceof RequestError) {
      repoData.couldntAccess = true
      repoData.versionDoubt = true
    }
  }

  return repoData.getResult()
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
