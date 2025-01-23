import { writeFileSync } from 'fs'

import governmentOwners from '../helpers/data/service-owners.json' with { type: 'json' }

console.log('Fetching services data from xgovuk...')
const serviceDataResponse = await fetch('https://govuk-digital-services.herokuapp.com/data.json')
if (!serviceDataResponse.ok) {
  throw new Error(`Failed to fetch service data: ${serviceDataResponse.statusText}`)
}

console.log('Updating service owners...')
const services = await serviceDataResponse.json()

const serviceOwnersSet = new Set()
for (const service of services.services) {
  if (service.sourceCode) {
    for (const source of service.sourceCode) {
      const url = new URL(source.href)
      const owner = url.pathname.split('/')[1]
      if (owner) {
        serviceOwnersSet.add(owner)
      }
    }
  }
}

const serviceOwners = Array.from(serviceOwnersSet)

const governmentRepoOwners = [...new Set(governmentOwners.concat(serviceOwners))]

console.log('Writing updated service owners to file...')
await writeFileSync(
  'helpers/data/service-owners.json',
  JSON.stringify(governmentRepoOwners, null, 2)
)

console.log('Service owners updated')
