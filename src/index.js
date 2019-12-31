import React, { setGlobal } from 'reactn';
import ReactDOM from 'react-dom';
import './index.css';
import App from './App';
import * as serviceWorker from './serviceWorker';
import connectToParent from 'penpal/lib/connectToParent';

// Global for interfacing to SID Services
// TODO: clean up
// WARNING: cant mix import and export, hence use of require here (webpack issue
//          see https://github.com/webpack/webpack/issues/4039)
// TODO: ensure scope is window local (i.e. doesn't leak out of iframe)
const sidServices = require('./utils/sidServices')
let sidSvcs = undefined
// TODO: cleanup this workaround for initialization order errors:
export const getSidSvcs = () => {
  if (!sidSvcs) {
    sidSvcs = new sidServices.SidServices()
  }

  return sidSvcs
}

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
    setGlobal({ config });
  });

  parent.checkType().then((type) => {
    console.log("TYPE: ", type)
    setGlobal({ type });
  })
});

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
