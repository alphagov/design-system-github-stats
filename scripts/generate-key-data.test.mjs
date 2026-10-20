import { describe, it, expect } from 'vitest'
import { getMajorVersion, getRepoMajorVersions, countByVersion, buildKeyData } from './generate-key-data.mjs'

const NOW = new Date().toISOString()
const OLD = '2010-01-01T00:00:00Z'

function makeRepo (overrides = {}) {
  return {
    repoOwner: 'test-owner',
    repoName: 'test-repo',
    builtByGovernment: false,
    isPrototype: false,
    isValid: true,
    updatedAt: NOW,
    createdAt: OLD,
    directDependencies: [],
    indirectDependencies: [],
    ...overrides
  }
}

describe('getMajorVersion', () => {
  it.each([
    { version: '^5.2.0', expected: '5' },
    { version: '~4.10.1', expected: '4' },
    { version: '3.15.0', expected: '3' },
    { version: '6.0.0', expected: '6' },
    { version: 'v2.0.0', expected: '2' },
    { version: 'latest', expected: null },
    { version: 'workspace:*', expected: null },
    { version: '*', expected: null },
    { version: 'github:org/repo', expected: null },
    { version: null, expected: null },
    { version: undefined, expected: null }
  ])('returns $expected for $version', ({ version, expected }) => {
    expect(getMajorVersion(version)).toBe(expected)
  })
})

describe('getRepoMajorVersions', () => {
  it('uses actualVersion when present, falling back to specifiedVersion', () => {
    const repo = makeRepo({
      directDependencies: [
        { specifiedVersion: '^5.0.0', actualVersion: '5.4.0' },
        { specifiedVersion: '^4.0.0' }
      ]
    })
    expect([...getRepoMajorVersions(repo)].sort()).toEqual(['4', '5'])
  })

  it('includes indirect dependencies', () => {
    const repo = makeRepo({
      indirectDependencies: [[{ parent: 'node_modules/govuk-react-jsx', specifiedVersion: '4.0.1', actualVersion: '4.0.1' }]]
    })
    expect([...getRepoMajorVersions(repo)]).toEqual(['4'])
  })

  it('returns an empty set for repos with no dependencies', () => {
    expect(getRepoMajorVersions(makeRepo()).size).toBe(0)
  })

  it('ignores dependencies with unparseable versions', () => {
    const repo = makeRepo({
      directDependencies: [{ specifiedVersion: 'latest' }]
    })
    expect(getRepoMajorVersions(repo).size).toBe(0)
  })
})

describe('countByVersion', () => {
  it('counts repos for every major they use, and buckets unparseable versions as other', () => {
    const repos = [
      makeRepo({ directDependencies: [{ specifiedVersion: '^5.0.0' }, { specifiedVersion: '^4.0.0' }] }),
      makeRepo({ directDependencies: [{ specifiedVersion: '^5.0.0' }] }),
      makeRepo({ directDependencies: [{ specifiedVersion: 'latest' }] }),
      makeRepo() // no dependencies - counted nowhere
    ]
    expect(countByVersion(repos)).toEqual({ 4: 1, 5: 2, other: 1 })
  })
})

describe('buildKeyData', () => {
  it('builds stats for all cohorts with dynamic version keys', () => {
    const data = [
      // Active gov service on v5
      makeRepo({ builtByGovernment: true, directDependencies: [{ specifiedVersion: '^5.0.0' }] }),
      // Active gov prototype on v6
      makeRepo({ builtByGovernment: true, isPrototype: true, directDependencies: [{ specifiedVersion: '^6.0.0' }] }),
      // Inactive prototype on v3
      makeRepo({ isPrototype: true, updatedAt: OLD, directDependencies: [{ specifiedVersion: '^3.0.0' }] }),
      // Repo with no dependencies
      makeRepo()
    ]

    const keyData = buildKeyData({ data, totalRepos: 4, totalUnprocessed: 0 })

    expect(keyData.totalRepos).toBe(4)
    expect(keyData.totalProcessed).toBe(4)
    expect(keyData.reposWithoutDependencies).toBe(1)
    expect(keyData.builtByGovernment).toBe(2)
    expect(keyData.prototypes).toBe(2)
    expect(keyData.activePrototypes).toBe(1)
    expect(keyData.activeGovPrototypes).toBe(1)

    // Version stats are repo-based and cover every major in use
    expect(keyData.using3).toBe(1)
    expect(keyData.using5).toBe(1)
    expect(keyData.using6).toBe(1)
    expect(keyData.activeGovV5).toBe(1)
    expect(keyData.activeGovV6).toBe(1)
    expect(keyData.activeGovV3).toBe(0)
    expect(keyData.prototypesV6).toBe(1)
    expect(keyData.activeGovPrototypesV6).toBe(1)
    expect(keyData.activeGovPrototypesV3).toBe(0)

    expect(keyData.keyDataValidated).toBe(true)
  })

  it('fails validation when processed and unprocessed do not account for all repos', () => {
    const keyData = buildKeyData({ data: [makeRepo()], totalRepos: 3, totalUnprocessed: 0 })
    expect(keyData.keyDataValidated).toBe(false)
  })

  it('accounts for deny-listed repos, which are processed but produce no result', () => {
    const keyData = buildKeyData({ data: [makeRepo()], totalRepos: 3, totalUnprocessed: 1, denyListed: 1 })
    expect(keyData.denyListed).toBe(1)
    expect(keyData.keyDataValidated).toBe(true)
  })

  it('does not crash on missing indirectDependencies or versions without digits', () => {
    const repo = makeRepo({ directDependencies: [{ specifiedVersion: 'workspace:*' }] })
    delete repo.indirectDependencies

    const keyData = buildKeyData({ data: [repo], totalRepos: 1, totalUnprocessed: 0 })
    expect(keyData.usingOther).toBe(1)
    expect(keyData.keyDataValidated).toBe(true)
  })
})
