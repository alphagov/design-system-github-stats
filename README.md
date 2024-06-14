# GOV.UK Frontend GitHub statistics

Repo for the collection, storage and analysis of statistics collected from open repos using GOV.UK Frontend on github.

## What we collect

This repo contains a list of repos that we:

1. **think** are government services
2. **know** are using GOV.UK Frontend directly

We specifically collect and store the following from our list of repos:

- The name of the repo
- The owner of the repo ie: the github user or org
- The version of GOV.UK Frontend being used, as best we are able to work out

We collect the above data by filtering [GOV.UK Frontend's raw dependents data](https://github.com/alphagov/govuk-frontend/network/dependents), which we collect using the [github-dependents-info package](https://github.com/nvuillam/github-dependents-info). Whilst we filter this data, we still store repos rejected from filtering of the raw data to assess the accuracy of our filtering.

> [!NOTE]
> We **do not** use this information to calculate or collect PII (Personally Identifiable Information) from individual github user accounts

## How it works

We filter and analyse our dependents data by looping through it and doing the following per loop:

1. We cross reference the repo against an owner list of github owners we know operate government services and a words list to flag repo names that don't look like services eg: "form-prototype", "book-driving-test-beta", "apply-to-vote-tech-demo" etc. This is cross referenced against an allow and deny list which bypass name filtering.
2. We get the repo's latest file tree and look for:
    - `lib/usage_stats.js`, which indicates that the repo is an old instance of the GOV.UK Prototype Kit and is therefore unlikely to be a live service
    - a `package.json` file. The absence of this indicates that the service can't be using GOV.UK Frontend as a direct dependency
    - a lockfile. We only look for either `package-lock.json` or `yarn.lock`
3. We look for the following in `package.json`:
    - A dependency on `govuk-frontend`, which we then read the version from
    - A dependency on `govuk-prototype-kit`. This is evidence that the repo is a new instance of the Prototype Kit which again indicates that it can't be a service
4. If the version of GOV.UK Frontend we retrieved is using [semver approximation syntax](https://github.com/npm/node-semver#versions) eg "^4.7.0" or "~5.1.0" then we check the lockfile and attempt to ascertain the actual version
5. We build our data and write it to `data/filtered-data.json`
