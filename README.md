# GOV.UK Frontend GitHub statistics

Repo for the collection, storage and analysis of statistics collected from open repos using GOV.UK Frontend on github.

## What we collect

This repo contains a list of repos that we:

1. **think** are government services
2. **know** are using GOV.UK Frontend directly
3. **think** are using GOV.UK Frontend indirectly

We specifically collect and store the following from our list of repos:

- The name of the repo
- The owner of the repo ie: the github user or org
- The versions of GOV.UK Frontend being used, as best as we can work out
- The parent dependencies of GOV.UK Frontend, if applicable
- When the repo was created
- When the repo was last updated

We collect the above data by filtering [GOV.UK Frontend's raw dependents data](https://github.com/alphagov/govuk-frontend/network/dependents), which we collect using the [github-dependents-info package](https://github.com/nvuillam/github-dependents-info).

> [!NOTE]
> We **do not** use this information to calculate or collect PII (Personally Identifiable Information) from individual github user accounts

## How it works

### The RepoData Class
The `RepoData` class manipulates and stores data related to repos. See its JSDoc.

We analyse our dependents by looping through them in `build-filtered-data.mjs` and doing the following per loop:

1. Create a new RepoData instance. This is used to check and fetch data from the repo.
2. Create a new Result instance. This is used to store and emit the result.
2. We check whether the repo is on our list of repos to ignore and skip the rest of the analysis if so.
3. We run a query on GitHub's GraphQL API to retrieve:
  - when the repo was created
  - the time of the latest commit to the repo
  - the SHA of the latest commit
4. We fetch the repo's file tree using the latest commit SHA
5. We retrieve the contents of all package.json files we can find
6. We check whether we think the repo is an instance of the GOV.UK Prototype Kit (and unlikely to be a live service) by looking for:
  - the `lib/usage_stats.js` file, which indicates that the repo is an old instance of the GOV.UK Prototype Kit, OR
  - a dependency on the GOV.UK Prototype in the package.json files
7. We look for all direct dependencies of `govuk-frontend` across the package.json files
8. If the version of GOV.UK Frontend we retrieved is using [semver approximation syntax](https://github.com/npm/node-semver#versions) eg "^4.7.0" or "~5.1.0", then we check the lockfile and attempt to ascertain the actual version.
9. If we don't find any direct dependencies, we search the lockfile for any indirect dependencies. We currently support package-lock.json or yarn.lock files.
9. We save the result of the repo analysis to our results
10. We save the results to a dated file ending `filtered-data.json`
11. If an error is thrown at any point during analysis, we log that to the result.

