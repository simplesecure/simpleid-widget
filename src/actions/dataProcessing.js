import { getGlobal } from 'reactn';
import { closeWidget } from './postMessage';
import { walletAnalyticsDataTableGet } from '../utils/dynamoConveniences';
const rp = require('request-promise');
const ethers = require('ethers');
const ALETHIO_KEY = process.env.REACT_APP_ALETHIO_KEY;
const rootUrl = `https://api.aleth.io/v1`;
const headers = { Authorization: `Bearer ${ALETHIO_KEY}`, 'Content-Type': 'application/json' }
let addresses = [];

export async function handleData(dataToProcess) {
  const { data, type } = dataToProcess;
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
    //Data should include the email template to use
  }
  closeWidget();
}

export async function filterByContract(userList, contractAddress) {
  const uri = `${rootUrl}/contracts/${contractAddress}/transactions?page[limit]=100`;
  await fetchFromURL(uri, "contract");
  const uniqueAddresses = [...new Set(addresses)];
  const resultingAddresses = uniqueAddresses.filter(function(v,i,a){
    return userList.indexOf(v) > -1;
  });
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
    } else if(functionType === "some-new-function-type") {
      console.log(parsedBody);
    }
  })
  .catch(function (err) {
    console.log(err.message);
  });
}

export async function filterByLastSeen(users, data) {
  const { dateRange } = data;
  const datum = Date.parse(dateRange.date);
  let filteredList = []
  
  Object.keys(users)
  .forEach( (key) => {
    if (dateRange.rangeType === "Before" && users[key].lastSeen && users[key].lastSeen < datum) {
      filteredList.push(key);
    } else if(dateRange.rangeType === "After" && users[key].lastSeen && users[key].lastSeen > datum) {
      filteredList.push(key);
    }
  });
  return filteredList;    
}

export async function filterByWalletBalance(users, balanceCriteria) {
  const { config } = getGlobal();
  const { operatorType, amount } = balanceCriteria;
  const provider = ethers.getDefaultProvider(config.network ? config.network : 'mainnet');
  let filteredUsers = [];
  console.log(balanceCriteria);
  if(operatorType === "More Than") {
    for(const user of users) {
      const balance = await provider.getBalance(user);
      const etherString = ethers.utils.formatEther(balance);
      if(parseFloat(etherString) > parseFloat(amount)) {
        console.log("Yeah Yeah");
        filteredUsers.push(user);
      }
    }
    return filteredUsers;
  } else if(operatorType === "Less Than") {
    for(const user of users) {
      const balance = await provider.getBalance(user);
      const etherString = ethers.utils.formatEther(balance);
      if(parseFloat(etherString) < parseFloat(amount)) {
        filteredUsers.push(user);
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