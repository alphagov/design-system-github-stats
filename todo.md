# TODOs

## Optimization

- Investigate using dependency graph/SBOM instead of searching files
  - Won't need to fetch repo tree
  - Won't need to get file contents
  - ISSUE: checking for prototype
  - ISSUE: doesn't define whether dependency is indirect or not

### If that's not a goer

- Handle multiple packagefiles
- Handle other language package managers
  - here's what GitHub supports: https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/dependency-graph-supported-package-ecosystems#supported-package-ecosystems

## Manual ports

- Run get dependents for known manual ports and include them somehow on larger script

## Testing

- More and better

## Linting

- Neostandard
  - for import assertions, get rid of the problem by making the current JSON files into js files

## Presentation

- Rejig refactoring into clear commits
- Update README
