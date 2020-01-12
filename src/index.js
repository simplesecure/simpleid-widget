import React, { setGlobal, getGlobal } from 'reactn';
import ReactDOM from 'react-dom';
import './index.css';
import App from './App';
import * as serviceWorker from './serviceWorker';
import connectToParent from 'penpal/lib/connectToParent';
import { handleData } from './actions/dataProcessing';

const connection = connectToParent({
  // Methods child is exposing to parent
  methods: {
    //
  }
});


connection.promise.then(parent => {
  parent.getConfig().then((config) => {
    console.log("CONFIG: ", config)
    setGlobal({ config });
  });

  parent.checkAction().then(async (action) => {
    console.log("ACTION: ", action);
    //First check if this is a sign out request
    if(action === 'sign-out') {
      await localStorage.clear();
      //window.location.reload();
      parent.completeSignOut();
      return;
    } else if(action === 'sign-in-no-sid') {
      parent.dataToProcess().then(async (userInfo) => {
        await getSidSvcs().persistNonSIDUserInfo(userInfo);
        parent.close();
        return;
      })
    } else if(action === 'process-data') {
      parent.dataToProcess().then(async (data) => {
        console.log("DATA to Process: ")
        console.log(data);
        if(data) {
          const dataToReturn = await handleData(data);
          parent.returnProcessedData(dataToReturn);
          parent.close();
        }
      })
    } else if(action === 'hosted-app') {
      //Need to check if the user is already logged into the iframe
      const wallet = getSidSvcs().getWalletAddress();
      console.log("WALLET: ", wallet);
      if(wallet) {
        //Show a blance screen with other functionality
        setGlobal({ showWallet: true });
      } else {
        setGlobal({ action: "sign-in-hosted" });
      }
      setGlobal({ hostedApp: true, action, auth: action === "transaction" || action === "message" || wallet ? false : true });
    } else  {
      //If not a sign out request, set the action appropriately
      setGlobal({ action, auth: action === "transaction" || action === "message" ? false : true });

      parent.checkType().then((type) => {
        setGlobal({ type });
      })
    }
  });
});

// Global for interfacing to SID Services
// TODO: clean up
// WARNING: cant mix import and export, hence use of require here (webpack issue
//          see https://github.com/webpack/webpack/issues/4039)
// TODO: ensure scope is window local (i.e. doesn't leak out of iframe)
const sidServices = require('./utils/sidServices')
let sidSvcs = undefined

console.log('Created global instance of SidServices')
console.log('/////////////////////////////////////////////////////////////////')

// TODO: cleanup this workaround for initialization order errors:
export const getSidSvcs = () => {
  const { config } = getGlobal();
  const { appId } = config;

  const SID_ANALYTICS_APP_ID = appId//'00000000000000000000000000000000'

  if (!sidSvcs) {
    sidSvcs = new sidServices.SidServices(SID_ANALYTICS_APP_ID)
  }

  return sidSvcs
}

setGlobal({
  auth: true,
  action: "sign-in",
  approval: false,
  pendingToken: false,
  config: {},
  email: "",
  token: "",
  password: "",
  keychain: {},
  encrypt: false,
  txDetails: {},
  error: "",
  subaction: "",
  type: "",
  nonSignInEvent: false, 
  hostedApp: false, 
  showWallet: false, 
  network: 'mainnet', 
  signUpMnemonicReveal: false, 
  walletAddr: "", 
  sid: {}
})

ReactDOM.render(<App />, document.getElementById('root'));

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
