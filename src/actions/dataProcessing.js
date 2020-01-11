import { closeWidget } from './postMessage';
import { getSidSvcs } from '../index';
const rp = require('request-promise');
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
      const appData = await getSidSvcs().walletAnalyicsDataTableGet(data.appId);
      const users = Object.keys(appData.Item.analytics);
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
          console.log("Last Seen");
          break;
        case "Wallet Balance": 
          //placeholder for Wallet Balance
          console.log("Wallet Balance");
          break;
        case "Total Transactions": 
          //placeholder for Total Transactions
          console.log("Total Transactions");
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
  await fetchFromURL(uri);
  const uniqueAddresses = [...new Set(addresses)];
  const resultingAddresses = uniqueAddresses.filter(function(v,i,a){
    return userList.indexOf(v) > -1;
  });
  return resultingAddresses;
}

export function fetchFromURL(url) {
  console.log("API URL: ", url);
  const options = {
    method: 'GET',
    uri: url, 
    headers,
    json: true
  }
  return rp(options)
  .then(async function (parsedBody) {
    const transactions = parsedBody.data;
    const addressesToPush = transactions.map(a => a.relationships.from.data.id);
    addresses.push(...addressesToPush);
    if(parsedBody.meta.page.hasNext) {
      const newUrl = parsedBody.links.next;
      await fetchFromURL(newUrl);
    } else {
      return addresses;
    }
  })
  .catch(function (err) {
    console.log(err.message);
  });
}