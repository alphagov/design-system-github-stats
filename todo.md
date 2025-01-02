# TODOs

## Optimisation and behaviour

- [x] Handle multiple packagefiles
- [ ] Handle nested (multiple?) lock files
- [x] Fetch metadata and latest commit SHA in one API call (2*4600 API calls is a big saving!)
- [ ] Caching
  - we already have a huge amount of local info. I'm thinking simple caching could be storing a file which contains an object of repo name keys to latest commit/last updated values. When we initially get this info (for free!) via the initial graphql query, we can simply check if these values match. if they do, we don't do any processing, This could result in some memory issues, but the main complication would come from having to include the unprocessed repo in the end data file with all its old information, ie: how to retrieve that quickly and efficiently, because the files are big (the CSV file probably isn't THAT big, to be honest).
  - potentially could investigate storing the data in an SQLite DB instead of JSON files, then should be able to make really quick queries.
    - should consider whether we need a history of the repo data or just the current repo data, and a history of the big data points.

## Manual ports (STRETCH)

- [ ] Run get dependents for known manual ports and include them somehow on larger script
- [ ] Handle other language package managers
  - here's what GitHub supports: https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/dependency-graph-supported-package-ecosystems#supported-package-ecosystems

## Testing

- [ ] Test the build script way better - maybe even run integration tests with actual API calls on single repos?
- [ ] Rationalise repodata tests

## Linting

- [x] Neostandard

## Presentation

- [ ] Rejig refactoring into clear commits
  - Add octokit class
  - Add octokit tests
  - Add repodata class
  - Add repodata tests
  - convert data lists to JS
  - Add linting
  - Use repodata in build script
  - Add build script tests
- [ ] Update README
- [ ] Summarise key data and have tests to detect wide variance
  - Number of prototypes
  - Number of government services
  - Number updated in last year
  - Number of errored checks
  - Number of direct dependencies
  - Number of indirect dependencies
- [ ] Store history for this key data

# Notes
- Investigated using dependency graph, but there's no easy way to get dependents and trees
- Investigated using search API, but rate limit for code search is 10 per minute (and normal search is 30 per minute)
- Getting created at, pushed at and latest commit sha via graphql is a free call - no impact on graphql API limit