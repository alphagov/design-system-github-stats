import { Octokit } from 'octokit'
import { throttling } from '@octokit/plugin-throttling'

import { handleError } from './error-handling.mjs'

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
    },
  },
})

/**
 * Gets repo metadata
 *
 * @param {string} repoOwner - The owner of the repo
 * @param {string} repoName - The name of the repo
 * @returns {Promise<import('@octokit/rest').Response<import('@octokit/rest').ReposGetResponse>>}
 */
export async function getRepoMetaData(repoOwner, repoName) {
  try {
    return await octokit.rest.repos.get({
      owner: repoOwner,
      repo: repoName,
    })
  } catch (error) {
    handleError(error, repoName)
  }
}

/**
 * Gets the latest commit for a repo
 * @param {string} repoOwner - The owner of the repo
 * @param {string} repoName - The name of the repo
 * @returns {Promise<import('@octokit/rest').Response<import('@octokit/rest').ReposListCommitsResponse>>}
 */
export async function getLatestCommit(repoOwner, repoName) {
  try {
    const commits = await octokit.rest.repos.listCommits({
      owner: repoOwner,
      repo: repoName,
      per_page: 1,
    })
    return commits.data[0]
  } catch (error) {
    handleError(error, repoName)
  }
}

/**
 * Gets the tree for a repo with a given sha
 *
 * @param {string} repoOwner - The owner of the repo
 * @param {string} repoName - The name of the repo
 * @param {string} treeSha - The sha of the tree
 * @returns {Promise<import('@octokit/rest').Response<import('@octokit/rest').GitGetTreeResponse>>}
 */
export async function getRepoTree(repoOwner, repoName, treeSha) {
  try {
    return await octokit.rest.git.getTree({
      owner: repoOwner,
      repo: repoName,
      tree_sha: treeSha,
      recursive: true,
    })
  } catch (error) {
    handleError(error, repoName)
  }
}

/**
 * Gets the contents of a file in a repo
 *
 * @param {string} repoOwner - The owner of the repo
 * @param {string} repoName - The name of the repo
 * @param {string} filePath - The path to the file
 * @returns {Promise<import('@octokit/rest').Response<import('@octokit/rest').ReposGetContentResponse>>}
 */
export async function getFileContent(repoOwner, repoName, filePath) {
  try {
    return await octokit.rest.repos.getContent({
      owner: repoOwner,
      repo: repoName,
      path: filePath,
      headers: { accept: 'application/vnd.github.raw+json' },
    })
  } catch (error) {
    handleError(error, repoName)
  }
}

/**
 * Check rate limit
 *
 * @returns {number} - The number of remaining requests
 */
export async function getRemainingRateLimit() {
  try {
    const rateLimit = await octokit.rest.rateLimit.get()
    return rateLimit.data.rate.remaining
  } catch (error) {
    handleError(error, 'rate limit')
  }
}
