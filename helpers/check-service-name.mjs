import serviceOwners from './data/service-owners.json' assert {type: 'json'}
import notAServiceWords from './data/not-a-service-words.json' assert {type: 'json'}
import allowList from './data/allow-list.json' assert {type: 'json'}
import denyList from './data/deny-list.json' assert {type: 'json'}

export default (name, owner) => {
  // Prioritise the allow/deny lists, then check against owner and name
  if (
    !denyList.some(item => name == item) ||
    allowList.some(item => name == item)
  ) {
    return !notAServiceWords.some(word => name.toLowerCase().includes(word)) && serviceOwners.includes(owner)
  } else {
    return false
  }
}
