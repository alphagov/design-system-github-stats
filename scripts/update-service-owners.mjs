import { writeFileSync } from 'fs'

import existingOwners from '../helpers/data/service-owners.json' with { type: 'json' }

console.log('Fetching services data from xgovuk...')
const serviceDataResponse = await fetch('https://govuk-digital-services.herokuapp.com/data.json')
if (!serviceDataResponse.ok) {
  throw new Error(`Failed to fetch service data: ${serviceDataResponse.statusText}`)
}

console.log('Updating service owners...')
const services = await serviceDataResponse.json()
const newOwners = {}

// Rather than faff with writing bits of a file, we're just going to overwrite the whole thing
// Update or add information where necessary, reuse existing information otherwise
for (const service of services.services) {
  if (service.sourceCode) {
    const url = new URL(service.sourceCode[0].href)
    const owner = url.pathname.split('/')[1]
    const repoName = url.pathname.split('/')[2]

    if (!newOwners[owner]) {
      newOwners[owner] = {}
    }

    if (!existingOwners[owner] || !existingOwners[owner][repoName] || JSON.stringify(existingOwners[owner][repoName]) !== JSON.stringify(service)) {
      // Owner or repo is not in existing list, or service has changed
      newOwners[owner][repoName] = service
    } else {
      // Service is already in existing list and is unchanged
      newOwners[owner][repoName] = existingOwners[owner][repoName]
    }
  }
}

console.log('Writing updated service owners to file...')
writeFileSync(
  'helpers/data/service-owners.json',
  JSON.stringify(newOwners, null, 2)
)

console.log('Service owners updated')
