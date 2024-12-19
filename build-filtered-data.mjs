import { writeFileSync } from 'fs'
import { json2csv } from 'json-2-csv'

import { Octokit, RequestError } from 'octokit'
import { throttling } from '@octokit/plugin-throttling'
import * as yarnLock from '@yarnpkg/lockfile'
import checkDenyList from './helpers/check-deny-list.mjs'
import checkServiceOwner from './helpers/check-service-owner.mjs'

import rawDeps from './data/raw-deps.json' assert { type: 'json' }

const MyOctokit = Octokit.plugin(throttling)
const octokit = new MyOctokit({
  auth: process.env.GITHUB_AUTH_TOKEN,
  throttle: {
    onRateLimit: (retryAfter, options, octokit, retryCount) => {
      octokit.log.warn(
        `Request quota exhausted for request ${options.method} ${options.url}`
      )

      if (retryCount < 1) {
        // only retries once
        octokit.log.info(`Retrying after ${retryAfter} seconds!`)
        return true
      }
    },
    onSecondaryRateLimit: (retryAfter, options, octokit) => {
      // does not retry, only logs a warning
      octokit.log.warn(
        `SecondaryRateLimit detected for request ${options.method} ${options.url}`
      )
    },
  },
})

class NoPackageJsonError extends Error {}
class CouldntReadPackageError extends Error {}
class IndirectDependencyError extends Error {}

filterDeps()

async function filterDeps() {
  const builtData = []

  console.log('Analysis BEGIN')
  for (const repo of rawDeps.all_public_dependent_repos) {
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
      console.log(`Analysing ${repo.name}...`)

      if (checkDenyList(repoName, repoOwner)) {
        console.log(
          `${repo.name} is on the 'deny' list and will not be processed`
        )
        continue
      }

      builtByGovernment = checkServiceOwner(repoOwner)

      if (builtByGovernment) {
        console.log(`${repo.name} looks like a GOV.UK service.`)
      } else {
        console.log(
          `${repo.name} looks like it ISN'T a GOV.UK service. This has been noted.`
        )
      }

      console.log('Getting repo data...')

      const repoMetaData = await octokit.rest.repos.get({
        owner: repoOwner,
        repo: repoName,
      })

      const firstCommit = await octokit.rest.repos.listCommits({
        owner: repoOwner,
        repo: repoName,
        per_page: 1,
      })

      lastUpdated = repoMetaData.data.pushed_at
      repoCreated = repoMetaData.data.created_at

      const repoTree = await octokit.rest.git.getTree({
        owner: repoOwner,
        repo: repoName,
        tree_sha: firstCommit.data[0].sha,
        recursive: true,
      })

      if (!repoTree.data.tree.find((file) => file.path == 'package.json')) {
        throw new NoPackageJsonError()
      }

      if (repoTree.data.tree.find((file) => file.path == 'package-lock.json')) {
        lockfileType = 'package-lock.json'
      } else if (repoTree.data.tree.find((file) => file.path == 'yarn.lock')) {
        lockfileType = 'yarn.lock'
      }

      // TODO: account for multiple package files
      const packageFile = await octokit.rest.repos.getContent({
        owner: repoOwner,
        repo: repoName,
        path: 'package.json',
        headers: {
          accept: 'application/vnd.github.raw+json',
        },
      })

      const packageObject = JSON.parse(packageFile.data)

      if (!('dependencies' in packageObject)) {
        throw new CouldntReadPackageError()
      }

      isPrototype =
        repoTree.data.tree.find((file) => file.path == 'lib/usage_data.js') !=
          undefined || 'govuk-prototype-kit' in packageObject.dependencies

      if (isPrototype) {
        console.log(
          `${repo.name} looks like an instance of the prototype kit. This has been noted.`
        )
      }

      if (!('govuk-frontend' in packageObject.dependencies)) {
        throw new IndirectDependencyError()
      }

      frontendVersion = packageObject.dependencies['govuk-frontend']
      console.log(
        `${repo.name} is using GOV.UK Frontend version ${frontendVersion}`
      )

      if (
        frontendVersion.indexOf('^') != -1 ||
        frontendVersion.indexOf('~') != -1
      ) {
        console.log(
          `${repo.name} is using approximation syntax in their GOV.UK Frontend version declaration, meaning their actual version might be different to what's in their package.json. Checking their lockfile...`
        )

        if (lockfileType == 'package-lock.json') {
          const packageLockFile = await octokit.rest.repos.getContent({
            owner: repoOwner,
            repo: repoName,
            path: 'package-lock.json',
            headers: {
              accept: 'application/vnd.github.raw+json',
            },
          })

          try {
            const packageLockObject = JSON.parse(packageLockFile.data)
            if ('packages' in packageLockObject) {
              frontendVersion =
                packageLockObject.packages['node_modules/govuk-frontend']
                  ?.version || frontendVersion
            } else if ('dependencies' in packageLockObject) {
              frontendVersion =
                packageLockObject.dependencies['govuk-frontend']?.version ||
                frontendVersion
            }
          } catch (e) {
            console.log('There was a problem with processing this lockfile:', e)
          }
        } else if (lockfileType == 'yarn.lock') {
          const yarnLockFile = await octokit.rest.repos.getContent({
            owner: repoOwner,
            repo: repoName,
            path: 'yarn.lock',
            headers: {
              accept: 'application/vnd.github.raw+json',
            },
          })

          try {
            const yarnLockObject = yarnLock.default.parse(yarnLockFile.data)
            frontendVersion =
              yarnLockObject.object[`govuk-frontend@${frontendVersion}`]
                ?.version || frontendVersion
          } catch (e) {
            console.log('There was a problem with processing this lockfile:', e)
          }
        }

        if (
          frontendVersion.indexOf('^') != -1 ||
          frontendVersion.indexOf('~') != -1
        ) {
          console.log(
            `Something went wrong in lockfile processing so we'll have to assume GOV.UK Frontend version for now.`
          )
          frontendVersion = frontendVersion.replace('^', '').replace('~', '')
          versionDoubt = true
        }

        console.log(`GOV.UK Frontend version set to ${frontendVersion}`)
      }
    } catch (e) {
      if (e instanceof NoPackageJsonError) {
        console.log(`${repo.name} doesn't have a package.json at its project root. This makes it very difficult to know if this repo is using GOV.UK Frontend directly or at all.
          We will presume that this repo is using GOV.UK Frontend indirectly.`)
        indirectDependency = true
      } else if (e instanceof CouldntReadPackageError) {
        console.log(`We couldn't find a direct dependencies list for ${repo.name} and therefore can't ascertain the version of GOV.UK Frontend used by this repo.
          We will presume that this repo is using GOV.UK Frontend indirectly.`)
        indirectDependency = true
      } else if (e instanceof IndirectDependencyError) {
        console.log(`${repo.name} doesn't list GOV.UK Frontend in its dependencies and therefore isn't using GOV.UK Frontend directly.
          We will note that this repo is using GOV.UK Frontend indirectly.`)
        indirectDependency = true
      } else if (e instanceof RequestError) {
        console.log(`There was a problem accessing ${repo.name}, most likely due to security restrictions from that repo. See error for more details:
          ${e}
          We will still record this repo but we won't be able to record version`)
        couldntAccess = true
        versionDoubt = true
      } else {
        throw e
      }
    }

    builtData.push({
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
    })

    console.log(`Analysis of ${repo.name} complete`)

    const currentDate = new Date().toISOString().split('T')[0]

    // Write JSON file
    await writeFileSync(
      `data/${currentDate}-filtered-data.json`,
      JSON.stringify(builtData, null, 2)
    )
    // Write CSV file
    const csv = json2csv(builtData)
    await writeFileSync(`data/${currentDate}-filtered-data.csv`, csv)
    console.log('Data updated')

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

  console.log(`We're done!`)
}
