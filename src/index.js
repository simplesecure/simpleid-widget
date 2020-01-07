import React, { setGlobal } from 'reactn';
import ReactDOM from 'react-dom';
import './index.css';
import App from './App';
import * as serviceWorker from './serviceWorker';
import connectToParent from 'penpal/lib/connectToParent';
import { handleData } from './actions/dataProcessing';
let configuration;

// Global for interfacing to SID Services
// TODO: clean up
// WARNING: cant mix import and export, hence use of require here (webpack issue
//          see https://github.com/webpack/webpack/issues/4039)
// TODO: ensure scope is window local (i.e. doesn't leak out of iframe)
const sidServices = require('./utils/sidServices')
let sidSvcs = undefined

console.log('Created global instance of SidServices')
console.log('/////////////////////////////////////////////////////////////////')

const connection = connectToParent({
  // Methods child is exposing to parent
  methods: {
    //
  }
});

connection.promise.then(parent => {
  parent.checkAction().then((action) => {
    setGlobal({ action, auth: action === "transaction" || action === "message" ? false : true });
  });
  parent.getConfig().then((config) => {
    console.log("CONFIG: ", config)
    configuration = config;
    setGlobal({ config });
  });

  // TODO: Justin I think some code in another project is either not checked in
  //       or I didn't git pull it from the right spot--I was getting an error
  //       saying this isn't a function, so I've commented it out for now.
  //
  parent.dataToProcess().then((data) => {
    console.log("DATA to Process: ")
    console.log(data);
    if(data) {
      handleData(data)
    }
  })

  parent.checkType().then((type) => {
    setGlobal({ type });
  })
});

// TODO: cleanup this workaround for initialization order errors:
export const getSidSvcs = () => {
  const SID_ANALYTICS_APP_ID = configuration.appId//'00000000000000000000000000000000'

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
  nonSignInEvent: false
})

ReactDOM.render(<App />, document.getElementById('root'));

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
