import { RequestError } from 'octokit'

export class NoPackageJsonError extends Error {}
export class NoDirectDependenciesError extends Error {}
export class IndirectDependencyError extends Error {}
export class NoDataError extends Error {}

/**
 * Logs errors
 *
 * @param {Error} error - The error to log
 * @param {string} repoName - the repo name
 *
 * @throws {Error} - If the error is not an expected type
 */
export function handleError(error, repoName) {
  if (error instanceof RequestError) {
    console.log(
      `${performance.now()}: There was a problem accessing ${repoName}: ${
        error.message
      }`
    )
  } else if (error instanceof NoDataError) {
    console.log(`${performance.now()}: Couldn't fetch data for ${repoName}.`)
  } else if (error instanceof NoPackageJsonError) {
    console.log(
      `${performance.now()}: ${repoName} doesn't have a package.json at its project root. This has been noted.`
    )
  } else if (error instanceof NoDirectDependenciesError) {
    console.log(
      `${performance.now()}: Couldn't find a direct dependencies list for ${repoName}. Assuming indirect usage of GOV.UK Frontend.`
    )
  } else if (error instanceof IndirectDependencyError) {
    console.log(
      `${performance.now()}: ${repoName} doesn't list GOV.UK Frontend in its dependencies. Assuming indirect usage of GOV.UK Frontend.`
    )
  } else {
    throw error
  }
}
