import denyList from './data/deny-list.json' with {type: 'json'}

export default (name, owner) => denyList.some(item => name === item.name && owner === item.owner)
