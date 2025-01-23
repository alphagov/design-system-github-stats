import { appendFileSync } from 'fs'

import builtData from '../data/filtered-data.json' with { type: 'json' }

console.log('Generating key data...')
// Extract key data
const keyData = {
  date: new Date(),
  total: builtData.length,
  totalServices: builtData.filter(result => result.service).length,
  top75: builtData.filter(result => result.service?.top75).length,
  version0: builtData.filter(result => {
    const dependencies = result.isIndirect ? result.indirectDependencies : result.directDependencies
    return dependencies?.[0]?.actualVersion?.startsWith('0.')
  }).length,
  version1: builtData.filter(result => {
    const dependencies = result.isIndirect ? result.indirectDependencies : result.directDependencies
    return dependencies?.[0]?.actualVersion?.startsWith('1.')
  }).length,
  version2: builtData.filter(result => {
    const dependencies = result.isIndirect ? result.indirectDependencies : result.directDependencies
    return dependencies?.[0]?.actualVersion?.startsWith('2.')
  }).length,
  version3: builtData.filter(result => {
    const dependencies = result.isIndirect ? result.indirectDependencies : result.directDependencies
    return dependencies?.[0]?.actualVersion?.startsWith('3.')
  }).length,
  version4: builtData.filter(result => {
    const dependencies = result.isIndirect ? result.indirectDependencies : result.directDependencies
    return dependencies?.[0]?.actualVersion?.startsWith('4.')
  }).length,
  version5: builtData.filter(result => {
    const dependencies = result.isIndirect ? result.indirectDependencies : result.directDependencies
    return dependencies?.[0]?.actualVersion?.startsWith('5.')
  }).length,
  totalGovernment: builtData.filter(result => result.builtByGovernment).length,
  totalPrototypes: builtData.filter(result => result.isPrototype).length,
  unknownLockfile: builtData.filter(result => result.unknownLockFileType).length,
  activeRepos: builtData.filter(result => {
    const updatedAt = new Date(result.updatedAt)
    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    return updatedAt > oneYearAgo
  }).length,
  activeGovRepos: builtData.filter(result => {
    const updatedAt = new Date(result.updatedAt)
    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    return result.builtByGovernment && updatedAt > oneYearAgo
  }).length
}

console.log('Writing key data to file...')
await appendFileSync(
  'data/key-data.json',
  JSON.stringify(keyData, null, 2)
)
