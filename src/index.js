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
    setGlobal({ action });
  });
  parent.getConfig().then((config) => {
    setGlobal({ config });
  });
});

setGlobal({
  auth: true,
  action: "sign-in", 
  approval: false, 
  pendingToken: false, 
  config: {}, 
  email: "",
  token: ""
})

ReactDOM.render(<App />, document.getElementById('root'));

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
