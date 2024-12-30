# TODOs

- [*] Handle multiple packagefiles
- [ ] Handle nested (multiple?) lock files

## Manual ports (STRETCH)

- [ ] Run get dependents for known manual ports and include them somehow on larger script
- [ ] Handle other language package managers
  - here's what GitHub supports: https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/dependency-graph-supported-package-ecosystems#supported-package-ecosystems

## Testing

- [ ] More and better

## Linting

- [*] Neostandard

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

# Notes
- Investigated using dependency graph, but there's no easy way to get dependents and trees
- Investigated using search API, but rate limit for code search is 10 per minute (and normal search is 30 per minute)