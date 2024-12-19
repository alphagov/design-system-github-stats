import denyList from './data/deny-list.json' assert {type: 'json'}

export default (name, owner) => denyList.some(item => name == item.name && owner == item.owner)
