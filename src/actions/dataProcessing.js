import { getGlobal } from 'reactn';
import { closeWidget } from './postMessage';
import { walletAnalyticsDataTableGet, organizationDataTableGet } from '../utils/dynamoConveniences';
import { getSidSvcs } from '../index';
const rp = require('request-promise');
const ethers = require('ethers');
const ALETHIO_KEY = process.env.REACT_APP_ALETHIO_KEY;
const rootUrl = `https://api.aleth.io/v1`;
const headers = { Authorization: `Bearer ${ALETHIO_KEY}`, 'Content-Type': 'application/json' }
let addresses = [];

export async function handleData(dataToProcess) {
  const { data, type } = dataToProcess;
  console.log(dataToProcess);
  if(type === 'segment') {
    let results;
    //Need to fetch user list that matches segment criteria
    //TODO: AC return the entire user list here so we can use it to plug into analytics service and filter
    try {
      console.log(data.appId);
      const appData = await walletAnalyticsDataTableGet(data.appId);
      const users = Object.keys(appData.Item.analytics);
      console.log(appData);
      switch(data.filter.filter) {
        case "Smart Contract Transactions":
          results = await filterByContract(users, data.contractAddress);
          break;
        case "All Users":
          //placeholder for all users
          results = users;
          break;
        case "Last Seen":
          //placeholder for Last Seen
          results = await filterByLastSeen(appData.Item.analytics, data);
          break;
        case "Wallet Balance":
          //placeholder for Wallet Balance
          results = await filterByWalletBalance(users, data.numberRange)
          break;
        case "Total Transactions":
          //placeholder for Total Transactions
          results = await fetchTotalTransactions(users);
          break;
        default:
          break;
      }
      return results;
    } catch(e) {
      console.log("ITS BAD: ", e)
    }
  } else if(type === 'email messaging') {
    //Here we will do something similar to segment data except we will send the appropriate message
    //Data should include the following:
    //const { addresses, app_id, template, subject } = data;
    //Commented out because we don't need each individual item separately
    const uuidList = await getSidSvcs().getUuidsForWalletAddresses(data)

    //Now we need to take this list and fetch the emails for the users
    //In production we should not print this and not return this to the client


    //Once we have the emails, send them to the email service lambda with the template
    //const { template } = data;
    //When we finally finish this function, we'll need to return a success indicator rather than a list of anything
    return uuidList
  } else if(type === 'ping') {
    console.log("let's ping this bad boy")
    console.log(data);
  } else if(type === 'notifications') {
    const { appId, address } = data
    let results = undefined
    console.log("TIME TO FETCH THE NOTIFICATIONS")
    console.log(data)
    //First we need to fetch the org_id because the app doesn't have it
    //TODO: should we give the app the org id? Are there any security concerns in doing so?
    const appData = await walletAnalyticsDataTableGet(appId);
    if(appData.Item) {
      const org_id = appData.Item.org_id

      //Now with the org_id, we can fetch the notification info from the org_table
      const orgData = await organizationDataTableGet(org_id);
      console.log(orgData)
      if(orgData.Item) {
        const thisApp = orgData.Item.apps[appId]
        if(thisApp) {
          const { currentSegments, notifications } = thisApp;
          let notificationsToReturn = []
          //Check to see if there are any notifications for this app
          if(notifications && notifications.length > 0) {
            for(const notification of notifications) {
              //Check the segment for the logged in user
              const thisSegment = currentSegments.filter(a => a.id === notification.segmentId)[0]
              const users = thisSegment.users;
              const thisUser = users.filter(a => a === address)[0];
              console.log("THIS USER FOUND", thisUser);
              notification['org_id'] = org_id
              notificationsToReturn.push(notification);
            }
            results = notificationsToReturn;
          } else {
            results = "No available notifications"
          }
        } else {
          //TODO: The engagement app doesn't have any apps nested under it. We need to fix this
          //I think it's tied to the app ID we're using
        }
      } else {
        return "Error fetching org data"
      }
    } else {
      results = "Error fetching app data"
    }
    return results;
  } else if(type === 'create-project') {
    const { appObject, orgId } = data;
    const createProject = await getSidSvcs().createAppId(orgId, appObject)
    console.log(createProject)
    return createProject
  } else if (type === 'AC Terrible Test') {
    console.log('AC\'s Terrible Test:')
    console.log('  getting uuids')
    const uuids = await getSidSvcs().getUuidsForWalletAddresses(data)
    console.log('  uuids:')
    console.log(JSON.stringify(uuids, 0, 2))
    console.log('  getting emails from uuids')
    const emails = await getSidSvcs().getEmailsForUuids(uuids)
    console.log('  emails: ')
    console.log(JSON.stringify(emails, 0 , 2))
    console.log('done...')
    return 'Better return something or no tomorrow.'
  }
  closeWidget();
}

export async function filterByContract(userList, contractAddress) {
  const uri = `${rootUrl}/contracts/${contractAddress}/transactions?page[limit]=100`;
  await fetchFromURL(uri, "contract");
  const uniqueAddresses = [...new Set(addresses)];
  console.log(uniqueAddresses);
  console.log(userList)
  let resultingAddresses = []
  for(const addr of userList) {
    const match = uniqueAddresses.indexOf(addr.toLowerCase());
    console.log(match);
    if(match > -1) {
      resultingAddresses.push(uniqueAddresses[match])
    }
  }
  return resultingAddresses;
}

export function fetchFromURL(url, functionType) {
  console.log("API URL: ", url);
  const options = {
    method: 'GET',
    uri: url,
    headers,
    json: true
  }
  return rp(options)
  .then(async function (parsedBody) {
    if(functionType === "contract") {
      const transactions = parsedBody.data;
      const addressesToPush = transactions.map(a => a.relationships.from.data.id);
      addresses.push(...addressesToPush);
      if(parsedBody.meta.page.hasNext) {
        const newUrl = parsedBody.links.next;
        await fetchFromURL(newUrl, "contract");
      } else {
        return addresses;
      }
    } else {
      console.log("FROM ALETHIO: ", parsedBody);
    }
  })
  .catch(function (err) {
    console.log(err.message);
  });
}

export async function filterByLastSeen(users, data) {
  const { dateRange } = data;
  const datum = Date.parse(dateRange.date);
  console.log(datum)
  let filteredList = []

  console.log("Users: ", users);
  console.log("Data: ", data)
  const userKeys = Object.keys(users)
  for (const userKey of userKeys) {
    if (dateRange.rangeType === "Before" && parseInt(users[userKey].last_seen, 10) && parseInt(users[userKey].last_seen, 10) < datum) {
      filteredList.push(userKey);
    } else if(dateRange.rangeType === "After" && parseInt(users[userKey].last_seen, 10) && parseInt(users[userKey].last_seen, 10) > datum) {
      filteredList.push(userKey);
    }
  }
  return filteredList;
}

export async function filterByWalletBalance(users, balanceCriteria) {
  const { config } = getGlobal();
  const { operatorType, amount } = balanceCriteria;
  const provider = ethers.getDefaultProvider(config.network ? config.network : 'mainnet');
  let filteredUsers = [];
  if(operatorType === "More Than") {
    if(balanceCriteria.tokenType === "ERC-20") {
      for(const user of users) {
        const url = `https://api.tokenbalance.com/token/${balanceCriteria.tokenAddress}/0xf1363d3d55d9e679cc6aa0a0496fd85bdfcf7464`
        const balance = await tokenFetch(url)
        const numberBal = parseFloat(balance)
        const numberAmount = parseFloat(amount)
        const matchCriteria = numberBal > numberAmount
        if(matchCriteria) {
          filteredUsers.push(user);
        }
      }
    } else {
      for(const user of users) {
        const balance = await provider.getBalance(user);
        const etherString = ethers.utils.formatEther(balance);
        const numberBal = parseFloat(etherString)
        const numberAmount = parseFloat(amount)
        const matchCriteria = numberBal > numberAmount
        if(matchCriteria) {
          console.log("Yeah Yeah");
          filteredUsers.push(user);
        }
      }
    }
    return filteredUsers;
  } else if(operatorType === "Less Than") {
    if(balanceCriteria.tokenType === "ERC-20") {
      for(const user of users) {
        const url = `https://api.tokenbalance.com/token/${balanceCriteria.tokenAddress}/0xf1363d3d55d9e679cc6aa0a0496fd85bdfcf7464`
        const balance = await tokenFetch(url)
        const numberBal = parseFloat(balance)
        const numberAmount = parseFloat(amount)
        const matchCriteria = numberBal < numberAmount
        if(matchCriteria) {
          filteredUsers.push(user);
        }
      }
    } else {
      for(const user of users) {
        const balance = await provider.getBalance(user);
        const etherString = ethers.utils.formatEther(balance);
        const numberBal = parseFloat(etherString)
        const numberAmount = parseFloat(amount)
        const matchCriteria = numberBal < numberAmount
        if(matchCriteria) {
          filteredUsers.push(user);
        }
      }
    }

    return filteredUsers;
  }
}

export async function fetchTotalTransactions(users) {
  console.log(users);
  const { config } = getGlobal();
  const provider = ethers.getDefaultProvider(config.network ? config.network : 'mainnet');
  let txCount = 0;
  for (const user of users) {
    console.log(txCount);
    const count = await provider.getTransactionCount(user);
    txCount = txCount + count;
  }
  return txCount;
}

export async function walletPDF() {
  document.title = "SimpleID Wallet";
  window.print();
}

export async function tokenFetch(url) {
  const options = {
    method: 'GET',
    uri: url,
    headers,
    json: true
  }
  return rp(options)
  .then(async function (parsedBody) {
    console.log("Token Balance Api:", parsedBody)
    if(parsedBody && parsedBody.balance) {
      return parsedBody.balance
    } else {
      return 0
    }


  })
  .catch(function (err) {
    console.log(err.message);
  });
}
