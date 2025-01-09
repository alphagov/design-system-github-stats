import serviceOwners from './data/service-owners.json' with {type: 'json'}

export default (owner) => serviceOwners.includes(owner)
