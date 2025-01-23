import { writeFileSync } from 'fs'

import governmentOwners from '../helpers/data/service-owners.json' with { type: 'json' }

console.log('Fetching services data from xgovuk...')
const serviceDataResponse = await fetch('https://govuk-digital-services.herokuapp.com/data.json')
if (!serviceDataResponse.ok) {
  throw new Error(`Failed to fetch service data: ${serviceDataResponse.statusText}`)
}

console.log('Updating service owners...')
const services = await serviceDataResponse.json()
const serviceOwners = {}

for (const service of services.services) {
  if (service.sourceCode) {
    const url = new URL(service.sourceCode[0].href)
    const owner = url.pathname.split('/')[1]
    const repoName = url.pathname.split('/')[2]
    serviceOwners[owner] = { [repoName]: service }
  } else {
    serviceOwners[service.name] = service
  }
}

for (const owner of governmentOwners) {
  if (!serviceOwners[owner]) {
    serviceOwners[owner] = null
  }
}

console.log('Writing updated service owners to file...')
await writeFileSync(
  'helpers/data/service-owners.json',
  JSON.stringify(serviceOwners, null, 2)
)

console.log('Service owners updated')
