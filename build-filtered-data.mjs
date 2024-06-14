import { writeFileSync } from 'fs'

import { Octokit } from 'octokit'
import { throttling } from '@octokit/plugin-throttling';
import * as yarnLock from '@yarnpkg/lockfile'
import checkServiceName from './helpers/check-service-name.mjs'

import rawDeps from './raw-deps.json' assert {type: 'json'}

const MyOctokit = Octokit.plugin(throttling)
const octokit = new MyOctokit({
  auth: process.env.GITHUB_AUTH_TOKEN,
  throttle: {
    onRateLimit: (retryAfter, options, octokit, retryCount) => {
      octokit.log.warn(
        `Request quota exhausted for request ${options.method} ${options.url}`,
      );

      if (retryCount < 1) {
        // only retries once
        octokit.log.info(`Retrying after ${retryAfter} seconds!`);
        return true;
      }
    },
    onSecondaryRateLimit: (retryAfter, options, octokit) => {
      // does not retry, only logs a warning
      octokit.log.warn(
        `SecondaryRateLimit detected for request ${options.method} ${options.url}`,
      );
    },
  }
})

const rejections = {
  nameOrOwner: [],
  noPackageJson: [],
  couldntReadPackage: [],
  indirectDependancy: [],
  prototypeKitDependency: []
}

class NameOrOwnerError extends Error {}
class NoPackageJsonError extends Error {}
class CouldntReadPackageError extends Error {}
class IndirectDependencyError extends Error {}
class PrototypeKitDependencyError extends Error {}

filterDeps()

async function filterDeps() {
  const builtData = []

  console.log('Analysis BEGIN')
  for (const repo of rawDeps.all_public_dependent_repos) {
    try {
      const repoOwner = repo.owner
      const repoName = repo.repo_name
      let frontendVersion
      let lockfileType = null
      let versionDoubt = false

      console.log(`Analysing ${repo.name}...`)

      if (!checkServiceName(repoName, repoOwner)) {
        throw new NameOrOwnerError
      }

      console.log(`${repo.name} has a name that looks like a GOV.UK service.`)
      console.log('Getting repo data...')

      const firstCommit = await octokit.rest.repos.listCommits({
        owner: repoOwner,
        repo: repoName,
        per_page: 1
      })

      const repoTree = await octokit.rest.git.getTree({
        owner: repoOwner,
        repo: repoName,
        tree_sha: firstCommit.data[0].sha,
        recursive: true
      })

      // 
      if (repoTree.data.tree.find(file => file.path == 'lib/usage_data.js')) {
        throw new PrototypeKitDependencyError
      }

      if (!repoTree.data.tree.find(file => file.path == 'package.json')) {
        throw new NoPackageJsonError
      }

      if (repoTree.data.tree.find(file => file.path == 'package-lock.json')) {
        lockfileType = 'package-lock.json'
      } else if (repoTree.data.tree.find(file => file.path == 'yarn.lock')) {
        lockfileType = 'yarn.lock'
      }

      const packageFile = await octokit.rest.repos.getContent({
        owner: repoOwner,
        repo: repoName,
        path: 'package.json',
        headers: {
          accept: 'application/vnd.github.raw+json'
        }
      })

      const packageObject = JSON.parse(packageFile.data)
      
      if (!('dependencies' in packageObject)) {
        throw new CouldntReadPackageError
      }

      if (('govuk-prototype-kit' in packageObject.dependencies)) {
        throw new PrototypeKitDependencyError
      }
      
      if (!('govuk-frontend' in packageObject.dependencies)) {
        throw new IndirectDependencyError
      }

      frontendVersion = packageObject.dependencies['govuk-frontend']
      console.log(`${repo.name} is using GOV.UK Frontend version ${frontendVersion}`)

      if (frontendVersion.indexOf('^') != -1 || frontendVersion.indexOf('~') != -1) {
        console.log(`${repo.name} is using approximation syntax in their GOV.UK Frontend version declaration, meaning their actual version might be different to what's in their package.json. Checking their lockfile...`)

        if (lockfileType == 'package-lock.json') {
          const packageLockFile = await octokit.rest.repos.getContent({
            owner: repoOwner,
            repo: repoName,
            path: 'package-lock.json',
            headers: {
              accept: 'application/vnd.github.raw+json'
            }
          })

          try {
            const packageLockObject = JSON.parse(packageLockFile.data)
            if ('packages' in packageLockObject) {
              frontendVersion = packageLockObject.packages['node_modules/govuk-frontend']?.version || frontendVersion
            } else if ('dependencies' in packageLockObject) {
              frontendVersion = packageLockObject.dependencies['govuk-frontend']?.version || frontendVersion
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
              accept: 'application/vnd.github.raw+json'
            }
          })

          try {
            const yarnLockObject = yarnLock.default.parse(yarnLockFile.data)
            frontendVersion = yarnLockObject.object[`govuk-frontend@${frontendVersion}`]?.version || frontendVersion
          } catch (e) {
            console.log('There was a problem with processing this lockfile:', e)
          }
        }

        if (frontendVersion.indexOf('^') != -1 || frontendVersion.indexOf('~') != -1) {
          console.log(`Something went wrong in lockfile processing so we'll have to assume GOV.UK Frontend version for now.`)
          frontendVersion = frontendVersion.replace('^', '').replace('~', '')
          versionDoubt = true
        }

        console.log(`GOV.UK Frontend version set to ${frontendVersion}`)
      }

      builtData.push({
        repoOwner,
        repoName,
        frontendVersion,
        versionDoubt
      })

      console.log(`Analysis of ${repo.name} complete`)

      // await writeFileSync('data/filtered-data.json', JSON.stringify(builtData, null, 2))
      console.log('Data updated')

      reportProgress(repo)
      await reportRateLimit()
    } catch (e) {
      if (e instanceof NoPackageJsonError) {
        console.log(`${repo.name} doesn't have a package.json and therefore isn't using GOV.UK Frontend directly.`)
        logRejection('noPackageJson', repo)

        reportProgress(repo)
        await reportRateLimit()
      } else if (e instanceof NameOrOwnerError) {
        console.log(`${repo.name} has been rejected by the owner/name checker.`)
        logRejection('nameOrOwner', repo)

        reportProgress(repo)
        await reportRateLimit()
      } else if (e instanceof CouldntReadPackageError) {
        console.log(`We couldn't find a direct dependencies list for ${repo.name} and therefore can't ascertain the version of GOV.UK Frontend used by this repo`)
        logRejection('couldntReadPackage', repo)

        reportProgress(repo)
        await reportRateLimit()
      } else if (e instanceof IndirectDependencyError) {
        console.log(`${repo.name} doesn't list GOV.UK Frontend in its dependencies and therefore isn't using GOV.UK Frontend directly.`)
        logRejection('indirectDependancy', repo)

        reportProgress(repo)
        await reportRateLimit()
      } else if (e instanceof PrototypeKitDependencyError) {
        console.log(`${repo.name} appears to be either using the prototype kit or using the prototype kit as a dependency, suggesting it is a prototype and therefore not a service.`)
        logRejection('prototypeKitDependency', repo)

        reportProgress(repo)
        await reportRateLimit()
      } else {
        throw (e)
      }
    }
  }

  await writeFileSync('data/rejections.json', JSON.stringify(rejections, null, 2))
  console.log('Rejections written to file')

  console.log(`We're done!`)
  console.log(`From ${rawDeps.all_public_dependent_repos.length} repos, we extracted ${builtData.length} repos`)
}

function logRejection(type, object) {
  console.log('This repo has been added to the rejections list.')
  rejections[type].push(object)
}

function reportProgress(repo) {
  const index = rawDeps.all_public_dependent_repos.findIndex(item => item === repo)
  console.log(`This was repo number ${index + 1} of ${rawDeps.all_public_dependent_repos.length}`)
}

async function reportRateLimit() {
  const rateLimit = await octokit.rest.rateLimit.get()
  console.log(`${rateLimit.data.rate.remaining} remaining on rate limit`)
}
