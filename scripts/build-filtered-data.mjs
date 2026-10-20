import { writeFileSync, mkdirSync } from 'fs'
import { json2csv } from 'json-2-csv'
import { fileURLToPath } from 'url'
import path from 'path'

import denyList from '../helpers/data/deny-list.json' with { type: 'json' }
import governmentServiceOwners from '../helpers/data/service-owners.json' with { type: 'json' }
import { getAllDeps, repoKey } from '../helpers/raw-deps.mjs'
import { RepoData } from '../helpers/repo-data.mjs'
import { Result } from '../helpers/result.mjs'

const __filename = fileURLToPath(import.meta.url)

// GitHub asks API consumers to stay under ~100 concurrent requests and will
// apply secondary rate limits well below that. 10 workers keeps us well
// within limits while still parallelising the bulk of the work.
const DEFAULT_CONCURRENCY = 10
const CHECKPOINT_EVERY = 200

function parseArgs (argv) {
  const options = {
    limit: null,
    shuffle: false,
    outDir: 'data',
    concurrency: Number.parseInt(process.env.CONCURRENCY || DEFAULT_CONCURRENCY, 10)
  }

  for (const arg of argv) {
    const [flag, value] = arg.split('=')
    if (flag === '--limit') {
      options.limit = Number.parseInt(value, 10)
    } else if (flag === '--out') {
      options.outDir = value
    } else if (flag === '--concurrency') {
      options.concurrency = Number.parseInt(value, 10)
    } else if (flag === '--shuffle') {
      options.shuffle = true
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }

  return options
}

async function filterDeps ({ limit, shuffle, outDir, concurrency }) {
  const startTime = performance.now()
  let repos = [...getAllDeps().values()]

  if (shuffle) {
    // Fisher-Yates, so --limit gives a representative sample rather than
    // whichever repos happen to be listed first
    for (let i = repos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [repos[i], repos[j]] = [repos[j], repos[i]]
    }
  }
  if (limit) {
    repos = repos.slice(0, limit)
  }

  const builtData = []
  const processed = new Set()
  const failed = new Set()
  let nextIndex = 0
  let finishedCount = 0

  console.log(`Beginning analysis of ${repos.length} repos (concurrency: ${concurrency})...`)

  async function worker () {
    while (nextIndex < repos.length) {
      const repo = repos[nextIndex++]
      const key = repoKey(repo)

      try {
        console.log(`${key}: Getting repo data...`)
        const repoData = await analyseRepo(repo)
        processed.add(key)
        if (repoData) {
          builtData.push(repoData)
        }
        console.log(`${key}: Analysis complete`)
      } catch (error) {
        failed.add(key)
        console.log(`${key}: ERROR: ${error.message}. Skipping.`)
      }

      finishedCount++
      console.log(`Finished ${finishedCount} of ${repos.length}`)

      if (finishedCount % CHECKPOINT_EVERY === 0) {
        writeToFiles(builtData, repos, processed, outDir)
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  if (builtData.length > 0) {
    writeToFiles(builtData, repos, processed, outDir)
  }

  const durationMinutes = ((performance.now() - startTime) / 60000).toFixed(1)
  console.log(
    `We're done! Processed ${processed.size} of ${repos.length} repos in ${durationMinutes} minutes ` +
    `(${builtData.length} results saved, ${failed.size} failed, ${repos.length - processed.size - failed.size} not attempted)`
  )
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
    const { rootFiles, ...repoInfo } = await repoData.getRepoInfo()
    Object.assign(result, repoInfo)

    // Analyse the root files we already fetched with the metadata if we can,
    // and only fall back to fetching the whole repo tree when the root files
    // aren't enough (eg monorepos with workspaces, nested package.json files)
    result.repoTree = repoData.buildTreeFromRootFiles(rootFiles) ||
      await repoData.getRepoTree(result.latestCommitSHA)

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

function writeToFiles (builtData, repos, processed, outDir) {
  mkdirSync(outDir, { recursive: true })

  // Write JSON file
  const jsonData = JSON.stringify(builtData, null, 2)
  writeFileSync(path.join(outDir, 'filtered-data.json'), jsonData)

  // Write CSV file
  const csv = json2csv(builtData)
  writeFileSync(path.join(outDir, 'filtered-data.csv'), csv)
  console.log('Data file updated with batch of entries')

  // Write Unprocessed Items file
  const unprocessedItems = repos.filter((repo) => !processed.has(repoKey(repo)))
  writeFileSync(
    path.join(outDir, 'unprocessedItems.json'),
    JSON.stringify(unprocessedItems, null, 2)
  )
}

// Only run when executed directly, not when imported (eg by tests)
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    // Load GITHUB_AUTH_TOKEN etc from a local .env file if there is one
    process.loadEnvFile()
  } catch {
    // No .env file - rely on the environment
  }

  filterDeps(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error('Analysis failed:', error)
    process.exitCode = 1
  })
}
