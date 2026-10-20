import { readdirSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path, { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function repoKey (repo) {
  return `${repo.owner}/${repo.repo_name}`
}

/**
 * Reads all raw-deps*.json files and dedupes the repos they list by
 * owner/name - the same repo can appear in the dependents list of both
 * govuk-frontend and one of the ports
 *
 * @returns {Map<string, object>} - Map of owner/name keys to repo objects
 */
export function getAllDeps () {
  const dataDir = path.resolve(__dirname, '../data')
  const rawDepFiles = readdirSync(dataDir).filter(file => file.startsWith('raw-deps'))

  const allDeps = new Map()
  for (const file of rawDepFiles) {
    const rawDepData = JSON.parse(readFileSync(path.join(dataDir, file), 'utf8'))
    for (const repo of rawDepData.all_public_dependent_repos) {
      const key = repoKey(repo)
      if (!allDeps.has(key)) {
        allDeps.set(key, repo)
      }
    }
  }
  return allDeps
}
