import serviceOwners from './data/service-owners.json' assert {type: 'json'}

export default (owner) => serviceOwners.includes(owner)
