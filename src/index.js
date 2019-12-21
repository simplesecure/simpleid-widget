import React, { setGlobal } from 'reactn';
import ReactDOM from 'react-dom';
import './index.css';
import App from './App';
import * as serviceWorker from './serviceWorker';
import connectToParent from 'penpal/lib/connectToParent';

const connection = connectToParent({
  // Methods child is exposing to parent
  methods: {
    //
  }
});

connection.promise.then(parent => {
  parent.checkAction().then((action) => {
    console.log(`DBG: simpleid-widget::index.js::penpal::parent::checkAction action=${action}`);
    setGlobal({ action, auth: action === "transaction" || action === "message" ? false : true });
  });
  parent.getConfig().then((config) => {
    console.log(`DBG: simpleid-widget::index.js::penpal::parent::getConfig config=${config}`);
    setGlobal({ config });
  });

  parent.checkType().then((type) => {
    console.log("TYPE: ", type)
    console.log(`DBG: simpleid-widget::index.js::penpal::parent::checkType type=${type}`);
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
  type: ""
})

ReactDOM.render(<App />, document.getElementById('root'));

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
