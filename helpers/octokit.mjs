import { Octokit } from 'octokit'
import { throttling } from '@octokit/plugin-throttling'
import { graphql } from '@octokit/graphql'

/**
 * Octokit functions
 *
 * We don't handle errors here, as we want to throw them up to the main script to handle.
 */

const MyOctokit = Octokit.plugin(throttling)
const octokit = new MyOctokit({
  auth: process.env.GITHUB_AUTH_TOKEN,
  throttle: {
    onRateLimit: (retryAfter, options, octokit, retryCount) => {
      octokit.log.warn(
        `${performance.now()}: Request quota exhausted for request ${
          options.method
        } ${options.url}`
      )

      if (retryCount < 2) {
        octokit.log.info(
          `${performance.now()}: Retrying after ${retryAfter} seconds!`
        )
        return true
      }
    },
    onSecondaryRateLimit: (retryAfter, options, octokit, retryCount) => {
      octokit.log.warn(
        `${performance.now()}: SecondaryRateLimit detected for request ${
          options.method
        } ${options.url}`
      )

      if (retryCount < 2) {
        octokit.log.info(
          `${performance.now()}: Retrying after ${retryAfter} seconds!`
        )
        return true
      }
    }
  }
})

// Deliberately NOT routed through the throttled octokit instance: the
// throttling plugin forces all GraphQL requests through a limiter of
// maxConcurrent 1 and minTime 1s (GraphQL counts as a "write"), which would
// cap the whole analysis at 1 repo per second.
const graphQLAuth = graphql.defaults({
  headers: {
    authorization: `token ${process.env.GITHUB_AUTH_TOKEN}`
  }
})

/**
 * GraphQL request with rate limit retries, mirroring what the throttling
 * plugin does for REST requests
 *
 * @param {string} query - The GraphQL query
 * @param {object} variables - The query variables
 * @param {number} [retries=2] - How many times to retry after a rate limit response
 * @returns {Promise<import('@octokit/graphql').GraphQlQueryResponse>}
 */
async function graphqlWithRetry (query, variables, retries = 2) {
  try {
    return await graphQLAuth(query, variables)
  } catch (error) {
    const isRateLimited = error.status === 403 || error.status === 429 ||
      (error.errors || []).some((responseError) => responseError.type === 'RATE_LIMITED')

    if (!isRateLimited || retries === 0) {
      throw error
    }

    const resetAt = Number(error.headers?.['x-ratelimit-reset']) * 1000
    const retryAfter = Number(error.headers?.['retry-after']) ||
      Math.max(Math.ceil((resetAt - Date.now()) / 1000), 0) ||
      60

    console.warn(`GraphQL rate limited. Retrying after ${retryAfter} seconds!`)
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000))
    return graphqlWithRetry(query, variables, retries - 1)
  }
}

/**
 * Gets Repo created_at, updated_at and latest commit SHA, as well as rate limit info
 *
 * Note that this GraphQL query is essentially FREE in terms of rate limiting as it is only 1 point cost, which won't
 * actually count against the GraphQL rate limit.
 *
 * This contrasts with the REST API which would require 2 requests to get the same information:
 *   1. Get the repo-level info like created_at and updated_at
 *   2. Get the latest commit SHA
 *
 * In testing, this query sped up the build script from 80 minutes to 60 minutes.
 *
 * If there are no commits, we can't get the repo tree anyway, so we'd error and skip the repo analysis, so it makes
 * sense to gather all this info at the same time.
 *
 * Repo info is returned in the format:
 * {
 *   repository: {
 *     createdAt: '2022-01-01T00:00:00Z',
 *     updatedAt: '2023-01-01T00:00:00Z',
 *     defaultBranchRef: {
 *       target: {
 *         oid: 'sha-123'
 *       }
 *     }
 *   },
 *   rateLimit: {
 *     cost: 1,
 *     remaining: 5000,
 *     resetAt: '2023-01-01T00:00:00Z'
 *   }
 * }
 *
 * @param {string} owner - the repo owners
 * @param {string} name - the repo name
 * @returns {Promise<import('@octokit/graphql').GraphQlQueryResponse>} - the repo info
 */
export async function getRepo (owner, name) {
  const query = `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        createdAt
        updatedAt
        defaultBranchRef {
          target {
            ... on Commit {
              oid
            }
          }
        }
      }
      rateLimit {
        cost
        remaining
        resetAt
      }
    }
  `

  const variables = {
    owner,
    name
  }

  return await graphqlWithRetry(query, variables)
}

/**
 * Gets the tree for a repo with a given sha
 *
 * @param {string} repoOwner - The owner of the repo
 * @param {string} repoName - The name of the repo
 * @param {string} treeSha - The sha of the tree
 * @returns {Promise<import('@octokit/rest').Response<import('@octokit/rest').GitGetTreeResponse>>}
 * @throws {RequestError} - If the request fails
 */
export async function getTree (repoOwner, repoName, treeSha) {
  return await octokit.rest.git.getTree({
    owner: repoOwner,
    repo: repoName,
    tree_sha: treeSha,
    recursive: true
  })
}

/**
 * Gets the contents of a file in a repo
 *
 * @param {string} repoOwner - The owner of the repo
 * @param {string} repoName - The name of the repo
 * @param {string} filePath - The path to the file
 * @returns {Promise<import('@octokit/rest').Response<import('@octokit/rest').ReposGetContentResponse>>} - the file content
 * @throws {RequestError} - If the request fails
 */
export async function getFileContent (repoOwner, repoName, filePath) {
  return await octokit.rest.repos.getContent({
    owner: repoOwner,
    repo: repoName,
    path: filePath,
    headers: { accept: 'application/vnd.github.raw+json' }
  })
}

/**
 * Check rate limit
 *
 * @returns {number} - The number of remaining requests
 * @throws {RequestError} - If the request fails
 */
export async function getRemainingRateLimit () {
  const rateLimit = await octokit.rest.rateLimit.get()
  return rateLimit.data.rate.remaining
}
