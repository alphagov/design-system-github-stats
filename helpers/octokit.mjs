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

      if (retryCount < 1) {
        // only retries once
        octokit.log.info(
          `${performance.now()}: Retrying after ${retryAfter} seconds!`
        )
        return true
      }
    },
    onSecondaryRateLimit: (retryAfter, options, octokit) => {
      // does not retry, only logs a warning
      octokit.log.warn(
        `${performance.now()}: SecondaryRateLimit detected for request ${
          options.method
        } ${options.url}`
      )
    }
  }
})

const graphQLAuth = graphql.defaults({
  headers: {
    authorization: `token ${process.env.GITHUB_AUTH_TOKEN}`
  }
})

/**
 * Gets Repo created_at, pushed_at and latest commit SHA, as well as rate limit info
 *
 * Note that this GraphQL query is essentially FREE in terms of rate limiting as it is only 1 point cost, which won't
 * actually count against the GraphQL rate limit.
 *
 * This contrasts with the REST API which would require 2 requests to get the same information:
 *   1. Get the repo-level info like created_at and pushed_at
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
 *     pushedAt: '2023-01-01T00:00:00Z',
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
export async function getRepoInfo (owner, name) {
  const query = `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        createdAt
        pushedAt
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

  return await graphQLAuth(query, variables)
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
export async function getRepoTree (repoOwner, repoName, treeSha) {
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
